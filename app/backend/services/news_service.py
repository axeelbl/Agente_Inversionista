import asyncio
import html
import re
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin

import httpx

from app.backend.config import NEWSAPI_API_KEY, NEWS_COUNTRY, NEWS_LANGUAGE

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    )
}

GENERIC_NEWS_QUERIES = {
    "",
    "noticias",
    "noticias de hoy",
    "ultimas noticias",
    "ultimas noticias del dia",
    "noticias del dia",
    "titulares",
    "titulares del dia",
}


async def search_news(query=None, limit=5, include_images=False):
    normalized_query = normalize_query(query)

    timeout = httpx.Timeout(10.0, connect=5.0)

    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
    ) as client:
        articles = []

        if NEWSAPI_API_KEY:
            articles = await _fetch_newsapi_articles(client, normalized_query, limit)

        if not articles:
            articles = await _fetch_google_news_articles(
                client,
                normalized_query,
                limit,
                include_images,
            )

        return articles[:limit]


def normalize_query(query):
    return re.sub(r"\s+", " ", (query or "")).strip()


def fold_text(value):
    normalized = normalize_query(value).lower()
    decomposed = unicodedata.normalize("NFD", normalized)
    return "".join(char for char in decomposed if unicodedata.category(char) != "Mn")


def is_generic_news_query(query):
    return fold_text(query) in GENERIC_NEWS_QUERIES


async def _fetch_newsapi_articles(client, query, limit):
    endpoint = "https://newsapi.org/v2/everything"
    params = {
        "language": NEWS_LANGUAGE,
        "pageSize": limit,
        "sortBy": "publishedAt",
        "apiKey": NEWSAPI_API_KEY,
    }

    if query and not is_generic_news_query(query):
        params["q"] = query
    else:
        endpoint = "https://newsapi.org/v2/top-headlines"
        params = {
            "country": NEWS_COUNTRY.lower(),
            "pageSize": limit,
            "apiKey": NEWSAPI_API_KEY,
        }

    try:
        response = await client.get(endpoint, params=params)
        response.raise_for_status()
    except httpx.HTTPError:
        return []

    payload = response.json()
    raw_articles = payload.get("articles") or []
    articles = []

    for item in raw_articles[:limit]:
        title = clean_text(item.get("title"))
        url = clean_text(item.get("url"))

        if not title or not url:
            continue

        articles.append(
            {
                "title": title,
                "source": clean_text((item.get("source") or {}).get("name")) or "Fuente no indicada",
                "published_at": normalize_published_at(item.get("publishedAt")),
                "url": url,
                "image_url": clean_text(item.get("urlToImage")),
                "description": clean_text(item.get("description"))
                or clean_text(item.get("content"))
                or "Sin extracto disponible.",
            }
        )

    return articles


async def _fetch_google_news_articles(client, query, limit, include_images):
    params = {
        "hl": f"{NEWS_LANGUAGE}-{NEWS_COUNTRY.upper()}",
        "gl": NEWS_COUNTRY.upper(),
        "ceid": f"{NEWS_COUNTRY.upper()}:{NEWS_LANGUAGE}",
    }

    is_generic_query = is_generic_news_query(query)
    endpoint = "https://news.google.com/rss"

    if not is_generic_query:
        endpoint = "https://news.google.com/rss/search"
        params["q"] = query

    try:
        response = await client.get(endpoint, params=params)
        response.raise_for_status()
    except httpx.HTTPError:
        return []

    try:
        root = ET.fromstring(response.text)
    except ET.ParseError:
        return []

    articles = []

    for item in root.findall(".//item")[:limit]:
        raw_title = clean_text(item.findtext("title"))
        link = clean_text(item.findtext("link"))
        description_html = item.findtext("description") or ""
        source_element = item.find("source")
        source = clean_text(source_element.text if source_element is not None else "")
        title = raw_title

        if not source:
            title, source = split_title_and_source(raw_title)
        else:
            title = strip_known_source(raw_title, source)

        image_url = absolute_url(extract_first_image(description_html), link)
        description = strip_html(description_html) or "Sin extracto disponible."

        if not title or not link:
            continue

        articles.append(
            {
                "title": title,
                "source": source or "Fuente no indicada",
                "published_at": normalize_published_at(item.findtext("pubDate")),
                "url": link,
                "image_url": image_url,
                "description": description,
            }
        )

    return await enrich_articles(client, articles, include_images)


async def enrich_articles(client, articles, include_images):
    tasks = []
    article_indexes = []

    for index, article in enumerate(articles):
        needs_metadata = (
            include_images
            or article["url"].startswith("https://news.google.com/")
            or not article.get("image_url")
            or len(article.get("description") or "") < 80
        )

        if needs_metadata and article.get("url"):
            article_indexes.append(index)
            tasks.append(fetch_article_metadata(client, article["url"]))

    if not tasks:
        return articles

    results = await asyncio.gather(*tasks, return_exceptions=True)

    for index, metadata in zip(article_indexes, results):
        if isinstance(metadata, Exception) or not metadata:
            continue

        article = articles[index]
        article["url"] = metadata.get("final_url") or article["url"]
        article["image_url"] = article.get("image_url") or metadata.get("image_url")

        if len(article.get("description") or "") < 80:
            article["description"] = metadata.get("description") or article["description"]

        if article.get("source") == "Fuente no indicada" and metadata.get("source"):
            article["source"] = metadata["source"]

    return articles


async def fetch_article_metadata(client, url):
    try:
        response = await client.get(url)
        response.raise_for_status()
    except httpx.HTTPError:
        return {}

    html_text = response.text[:350000]
    final_url = str(response.url)

    image_url = extract_meta_content(
        html_text,
        ("og:image", "twitter:image", "twitter:image:src"),
    )
    description = extract_meta_content(
        html_text,
        ("og:description", "description", "twitter:description"),
    )
    source = extract_meta_content(html_text, ("og:site_name",))

    return {
        "final_url": final_url,
        "image_url": absolute_url(image_url, final_url),
        "description": clean_text(description),
        "source": clean_text(source),
    }


def split_title_and_source(raw_title):
    parts = raw_title.rsplit(" - ", 1)

    if len(parts) == 2:
        return clean_text(parts[0]), clean_text(parts[1])

    return raw_title, ""


def strip_known_source(raw_title, source):
    suffix = f" - {source}"

    if raw_title.endswith(suffix):
        return raw_title[: -len(suffix)].strip()

    return raw_title


def extract_first_image(fragment):
    match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', fragment or "", re.IGNORECASE)
    return html.unescape(match.group(1)) if match else None


def strip_html(fragment):
    if not fragment:
        return ""

    without_images = re.sub(r"<img\b[^>]*>", " ", fragment, flags=re.IGNORECASE)
    without_tags = re.sub(r"<[^>]+>", " ", without_images)
    normalized = re.sub(r"\s+", " ", html.unescape(without_tags)).strip()

    return normalized


def extract_meta_content(html_text, keys):
    for key in keys:
        escaped_key = re.escape(key)
        patterns = (
            rf'<meta[^>]+(?:property|name)=["\']{escaped_key}["\'][^>]+content=["\']([^"\']+)["\']',
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{escaped_key}["\']',
        )

        for pattern in patterns:
            match = re.search(pattern, html_text, re.IGNORECASE)
            if match:
                return html.unescape(match.group(1))

    return None


def absolute_url(url, base_url):
    if not url:
        return None

    if url.startswith("//"):
        return f"https:{url}"

    if url.startswith("http://") or url.startswith("https://"):
        return url

    if base_url:
        return urljoin(base_url, url)

    return url


def clean_text(value):
    if value is None:
        return ""

    return re.sub(r"\s+", " ", html.unescape(str(value))).strip()


def normalize_published_at(value):
    if not value:
        return None

    text = clean_text(value)

    try:
        if text.endswith("Z"):
            return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()

        return datetime.fromisoformat(text).astimezone(timezone.utc).isoformat()
    except ValueError:
        pass

    try:
        return parsedate_to_datetime(text).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, IndexError):
        return text
