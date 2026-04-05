import asyncio
import csv
import html
import math
import re
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from io import StringIO
from statistics import pstdev
from typing import Any
from urllib.parse import quote, urljoin

import httpx

from app.backend.config import NEWSAPI_API_KEY, NEWS_COUNTRY, NEWS_LANGUAGE

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    )
}

YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"
YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
STOOQ_DAILY_URL = "https://stooq.com/q/d/l/"

MARKET_FEED_SYMBOLS = ["SPY", "VOO", "QQQ", "AAPL", "MSFT", "NVDA"]
GENERIC_MARKET_QUERIES = {
    "",
    "mercado",
    "mercados",
    "mercados hoy",
    "bolsa",
    "economia",
    "actualidad economica",
    "noticias economicas",
    "noticias financieras",
}

ASSET_ALIASES = {
    "apple": "AAPL",
    "microsoft": "MSFT",
    "tesla": "TSLA",
    "nvidia": "NVDA",
    "amazon": "AMZN",
    "google": "GOOGL",
    "alphabet": "GOOGL",
    "meta": "META",
    "facebook": "META",
    "berkshire": "BRK-B",
    "coca cola": "KO",
    "cocacola": "KO",
    "netflix": "NFLX",
    "palantir": "PLTR",
    "spotify": "SPOT",
    "sp500": "SPY",
    "s&p 500": "SPY",
    "s and p 500": "SPY",
    "nasdaq": "QQQ",
    "dow jones": "DIA",
    "russell 2000": "IWM",
    "oro": "GLD",
    "gold": "GLD",
    "petroleo": "USO",
    "oil": "USO",
    "bitcoin": "BTC-USD",
    "btc": "BTC-USD",
    "ethereum": "ETH-USD",
    "eth": "ETH-USD",
    "spy": "SPY",
    "voo": "VOO",
    "qqq": "QQQ",
    "iwm": "IWM",
    "dia": "DIA",
}

POSITIVE_NEWS_KEYWORDS = {
    "beat",
    "beats",
    "surge",
    "growth",
    "record",
    "strong",
    "upgrade",
    "expands",
    "profit",
    "gain",
    "gains",
    "sube",
    "mejora",
    "supera",
    "record",
    "crece",
    "beneficio",
    "solido",
    "alcista",
}

NEGATIVE_NEWS_KEYWORDS = {
    "miss",
    "misses",
    "drop",
    "falls",
    "fall",
    "downgrade",
    "lawsuit",
    "probe",
    "cuts",
    "warning",
    "cae",
    "recorta",
    "demanda",
    "investigacion",
    "debil",
    "bajista",
    "riesgo",
    "multa",
    "desacelera",
}

QUOTE_TYPE_LABELS = {
    "EQUITY": "Accion",
    "ETF": "ETF",
    "INDEX": "Indice",
    "CRYPTOCURRENCY": "Cripto",
    "MUTUALFUND": "Fondo",
}

CHART_RANGE_CONFIG = {
    "1D": {"range": "1d", "interval": "5m"},
    "5D": {"range": "5d", "interval": "15m"},
    "1M": {"range": "1mo", "interval": "1d"},
    "6M": {"range": "6mo", "interval": "1d"},
    "1Y": {"range": "1y", "interval": "1wk"},
    "5Y": {"range": "5y", "interval": "1mo"},
}

STOOQ_RANGE_DAYS = {
    "1D": 2,
    "5D": 5,
    "1M": 22,
    "6M": 132,
    "1Y": 252,
    "5Y": 1260,
}


async def search_market_news(
    query: str | None = None,
    limit: int = 5,
    include_images: bool = False,
    client: httpx.AsyncClient | None = None,
) -> list[dict[str, Any]]:
    normalized_query = normalize_query(query)

    if client is not None:
        return await _search_market_news_with_client(
            client,
            normalized_query,
            limit,
            include_images,
        )

    timeout = httpx.Timeout(10.0, connect=5.0)
    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
    ) as owned_client:
        return await _search_market_news_with_client(
            owned_client,
            normalized_query,
            limit,
            include_images,
        )


async def _search_market_news_with_client(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
    include_images: bool,
) -> list[dict[str, Any]]:
    articles: list[dict[str, Any]] = []

    if NEWSAPI_API_KEY:
        articles = await _fetch_newsapi_articles(client, query, limit)

    if not articles:
        articles = await _fetch_google_news_articles(client, query, limit, include_images)

    return articles[:limit]


async def search_assets(
    query: str,
    limit: int = 6,
    client: httpx.AsyncClient | None = None,
) -> list[dict[str, Any]]:
    cleaned_query = normalize_query(query)
    if not cleaned_query:
        return []

    if client is not None:
        return await _search_assets_with_client(client, cleaned_query, limit)

    timeout = httpx.Timeout(10.0, connect=5.0)
    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
    ) as owned_client:
        return await _search_assets_with_client(owned_client, cleaned_query, limit)


async def search_asset_symbol(
    query: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any] | None:
    matches = await search_assets(query, limit=1, client=client)
    return matches[0] if matches else None


async def _search_assets_with_client(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
) -> list[dict[str, Any]]:
    seed_matches: list[dict[str, Any]] = []
    alias_symbol = find_alias_symbol(query)

    if alias_symbol:
        seed_matches.append(build_search_match(alias_symbol, alias_symbol))

    direct_tickers = detect_tickers_from_user_message(query)
    if direct_tickers:
        seed_matches.extend(build_search_match(symbol, symbol) for symbol in direct_tickers)

    try:
        response = await client.get(
            YAHOO_SEARCH_URL,
            params={
                "q": query,
                "quotesCount": 6,
                "newsCount": 0,
                "enableFuzzyQuery": False,
            },
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return dedupe_assets(seed_matches)[:limit]

    payload = response.json()
    quotes = payload.get("quotes") or []
    matches: list[dict[str, Any]] = []

    for item in quotes:
        parsed_match = parse_search_match(item)
        if parsed_match:
            matches.append(parsed_match)

    return dedupe_assets(matches + seed_matches)[:limit]


async def get_asset_quote(
    ticker_or_query: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any] | None:
    cleaned_value = normalize_query(ticker_or_query)
    if not cleaned_value:
        return None

    if client is not None:
        return await _get_asset_quote_with_client(client, cleaned_value)

    timeout = httpx.Timeout(10.0, connect=5.0)
    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
    ) as owned_client:
        return await _get_asset_quote_with_client(owned_client, cleaned_value)


async def _get_asset_quote_with_client(
    client: httpx.AsyncClient,
    ticker_or_query: str,
) -> dict[str, Any] | None:
    asset_ref = await resolve_asset_reference(ticker_or_query, client)
    if not asset_ref:
        return None

    results = await _fetch_quotes_batch(client, [asset_ref["symbol"]])
    if not results:
        quote_from_chart = await _get_asset_quote_from_chart(
            client,
            asset_ref["symbol"],
            asset_ref,
        )
        if quote_from_chart:
            return quote_from_chart
        return await _get_asset_quote_with_stooq(client, asset_ref["symbol"], asset_ref)

    quote_data = results[0]
    quote_data["symbol"] = asset_ref["symbol"]

    if asset_ref.get("name") and quote_data["name"] == quote_data["symbol"]:
        quote_data["name"] = asset_ref["name"]

    if not quote_data.get("quote_type") and asset_ref.get("quote_type"):
        quote_data["quote_type"] = asset_ref["quote_type"]
        quote_data["quote_type_label"] = quote_type_label(asset_ref["quote_type"])

    if not quote_data.get("exchange") and asset_ref.get("exchange"):
        quote_data["exchange"] = asset_ref["exchange"]

    return quote_data


async def _get_asset_quote_from_chart(
    client: httpx.AsyncClient,
    symbol: str,
    asset_ref: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    result = await _fetch_yahoo_chart_result(
        client,
        symbol,
        {"range": "5d", "interval": "1d"},
    )
    if not result:
        return None

    return _build_quote_from_chart_result(result, symbol, asset_ref)


def _build_quote_from_chart_result(
    result: dict[str, Any],
    symbol: str,
    asset_ref: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    asset_ref = asset_ref or {}
    meta = result.get("meta") or {}
    indicators = result.get("indicators") or {}
    quote_indicator = ((indicators.get("quote") or [None])[0]) or {}

    closes = quote_indicator.get("close") or []
    opens = quote_indicator.get("open") or []
    highs = quote_indicator.get("high") or []
    lows = quote_indicator.get("low") or []
    volumes = quote_indicator.get("volume") or []

    last_close = _find_last_series_number(closes)
    price = _safe_number(meta.get("regularMarketPrice")) or last_close
    if price is None:
        return None

    latest_open = _find_last_series_number(opens)
    latest_high = _safe_number(meta.get("regularMarketDayHigh")) or _find_last_series_number(highs)
    latest_low = _safe_number(meta.get("regularMarketDayLow")) or _find_last_series_number(lows)
    latest_volume = _safe_number(meta.get("regularMarketVolume")) or _find_last_series_number(volumes)
    previous_close = _safe_number(meta.get("chartPreviousClose"))

    if previous_close is None and len(closes) >= 2:
        previous_close = _find_last_series_number(closes[:-1])

    change = round(price - previous_close, 4) if previous_close not in (None, 0) else None
    change_percent = (
        round((change / previous_close) * 100, 2)
        if change is not None and previous_close not in (None, 0)
        else None
    )
    day_range_percent = (
        round(((latest_high - latest_low) / latest_low) * 100, 2)
        if latest_high is not None and latest_low not in (None, 0)
        else None
    )

    quote_type = clean_text(meta.get("instrumentType")) or asset_ref.get("quote_type") or None
    resolved_symbol = clean_text(meta.get("symbol")) or symbol

    return {
        "symbol": resolved_symbol,
        "name": clean_text(meta.get("longName"))
        or clean_text(meta.get("shortName"))
        or asset_ref.get("name")
        or resolved_symbol,
        "quote_type": quote_type,
        "quote_type_label": quote_type_label(quote_type) or "Activo",
        "exchange": clean_text(meta.get("fullExchangeName"))
        or clean_text(meta.get("exchangeName"))
        or asset_ref.get("exchange")
        or None,
        "currency": clean_text(meta.get("currency")) or None,
        "price": price,
        "previous_close": previous_close,
        "open": latest_open,
        "day_low": latest_low,
        "day_high": latest_high,
        "change": change,
        "change_percent": change_percent,
        "market_cap": None,
        "volume": latest_volume,
        "fifty_two_week_low": _safe_number(meta.get("fiftyTwoWeekLow")),
        "fifty_two_week_high": _safe_number(meta.get("fiftyTwoWeekHigh")),
        "day_range_percent": day_range_percent,
        "market_state": "REGULAR",
        "asset_link": build_asset_link(resolved_symbol),
    }


async def get_asset_chart(
    ticker_or_query: str,
    range_key: str = "1M",
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any] | None:
    cleaned_value = normalize_query(ticker_or_query)
    if not cleaned_value:
        return None

    normalized_range = normalize_chart_range(range_key)

    if client is not None:
        return await _get_asset_chart_with_client(client, cleaned_value, normalized_range)

    timeout = httpx.Timeout(10.0, connect=5.0)
    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
    ) as owned_client:
        return await _get_asset_chart_with_client(owned_client, cleaned_value, normalized_range)


async def _get_asset_chart_with_client(
    client: httpx.AsyncClient,
    ticker_or_query: str,
    range_key: str,
) -> dict[str, Any] | None:
    asset_ref = await resolve_asset_reference(ticker_or_query, client)
    if not asset_ref:
        return None

    symbol = asset_ref["symbol"]
    chart_config = CHART_RANGE_CONFIG[range_key]
    result = await _fetch_yahoo_chart_result(client, symbol, chart_config)
    if not result:
        return await _get_asset_chart_with_stooq(client, symbol, range_key, asset_ref)

    meta = result.get("meta") or {}
    timestamps = result.get("timestamp") or []
    indicators = result.get("indicators") or {}
    quote_indicator = ((indicators.get("quote") or [None])[0]) or {}
    adjclose_indicator = ((indicators.get("adjclose") or [None])[0]) or {}

    closes = adjclose_indicator.get("adjclose") or quote_indicator.get("close") or []
    opens = quote_indicator.get("open") or []
    highs = quote_indicator.get("high") or []
    lows = quote_indicator.get("low") or []
    volumes = quote_indicator.get("volume") or []

    points: list[dict[str, Any]] = []

    for index, timestamp in enumerate(timestamps):
        close_value = _safe_number(closes[index]) if index < len(closes) else None
        if close_value is None:
            continue

        point_time = datetime.fromtimestamp(timestamp, tz=timezone.utc)
        points.append(
            {
                "timestamp": point_time.isoformat(),
                "label": format_chart_label(point_time, range_key),
                "value": close_value,
                "open": _safe_number(opens[index]) if index < len(opens) else None,
                "high": _safe_number(highs[index]) if index < len(highs) else None,
                "low": _safe_number(lows[index]) if index < len(lows) else None,
                "volume": _safe_number(volumes[index]) if index < len(volumes) else None,
            }
        )

    if len(points) < 2:
        return await _get_asset_chart_with_stooq(client, symbol, range_key, asset_ref)

    values = [point["value"] for point in points]
    start_value = values[0]
    end_value = values[-1]
    change = round(end_value - start_value, 4)
    change_percent = round((change / start_value) * 100, 2) if start_value else None
    daily_returns = []

    for previous, current in zip(values, values[1:]):
        if previous:
            daily_returns.append(((current - previous) / previous) * 100)

    volatility = round(pstdev(daily_returns), 2) if len(daily_returns) >= 2 else None

    return {
        "symbol": clean_text(meta.get("symbol")) or symbol,
        "name": clean_text(meta.get("shortName"))
        or clean_text(meta.get("longName"))
        or asset_ref.get("name")
        or symbol,
        "currency": clean_text(meta.get("currency")) or None,
        "exchange": clean_text(meta.get("exchangeName")) or None,
        "instrument_type": clean_text(meta.get("instrumentType")) or asset_ref.get("quote_type"),
        "range": range_key,
        "available_ranges": list(CHART_RANGE_CONFIG.keys()),
        "points": points,
        "summary": {
            "start": round(start_value, 4),
            "end": round(end_value, 4),
            "change": change,
            "change_percent": change_percent,
            "high": round(max(values), 4),
            "low": round(min(values), 4),
            "volatility": volatility,
        },
    }


async def _fetch_yahoo_chart_result(
    client: httpx.AsyncClient,
    symbol: str,
    params: dict[str, Any],
) -> dict[str, Any] | None:
    try:
        response = await client.get(
            YAHOO_CHART_URL.format(symbol=quote(symbol, safe="")),
            params=params,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return None

    payload = response.json()
    return ((payload.get("chart") or {}).get("result") or [None])[0]


async def compare_assets(
    asset_inputs: list[str],
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    normalized_inputs = [normalize_query(value) for value in asset_inputs if normalize_query(value)]
    if not normalized_inputs:
        return {"items": [], "summary": {}}

    if client is not None:
        return await _compare_assets_with_client(client, normalized_inputs)

    timeout = httpx.Timeout(10.0, connect=5.0)
    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
    ) as owned_client:
        return await _compare_assets_with_client(owned_client, normalized_inputs)


async def _compare_assets_with_client(
    client: httpx.AsyncClient,
    asset_inputs: list[str],
) -> dict[str, Any]:
    resolved_assets = await asyncio.gather(
        *(get_asset_quote(asset_input, client=client) for asset_input in asset_inputs),
        return_exceptions=True,
    )

    items = [item for item in resolved_assets if isinstance(item, dict)]
    items = dedupe_assets(items)

    return {
        "items": items,
        "summary": build_comparison_summary(items),
    }


def build_investment_plan(profile_input: str) -> dict[str, Any]:
    normalized = fold_text(profile_input)
    amount = extract_monthly_amount(profile_input)
    horizon = extract_horizon(profile_input)
    risk_profile = infer_risk_profile(normalized)
    is_beginner = any(token in normalized for token in ("principiante", "novato", "empez", "facil"))

    templates = {
        "conservador": {
            "allocation": [
                {
                    "label": "ETF global diversificado",
                    "percentage": 35,
                    "rationale": "Da exposición amplia sin depender de una sola empresa o sector.",
                    "examples": ["MSCI World", "FTSE All-World"],
                },
                {
                    "label": "Bonos de alta calidad",
                    "percentage": 40,
                    "rationale": "Reduce la volatilidad total y ayuda en escenarios de caídas.",
                    "examples": ["bonos globales cubiertos", "bonos gobierno corto plazo"],
                },
                {
                    "label": "Liquidez o monetario",
                    "percentage": 25,
                    "rationale": "Aporta estabilidad y margen para imprevistos o futuras compras.",
                    "examples": ["fondo monetario", "cuenta remunerada"],
                },
            ],
            "focus": "priorizar estabilidad, disciplina y una subida de riesgo muy gradual",
        },
        "moderado": {
            "allocation": [
                {
                    "label": "ETF global diversificado",
                    "percentage": 60,
                    "rationale": "Es el núcleo de largo plazo para capturar crecimiento global.",
                    "examples": ["MSCI World", "FTSE All-World"],
                },
                {
                    "label": "Bonos o monetario",
                    "percentage": 20,
                    "rationale": "Suaviza caídas y da flexibilidad para rebalancear.",
                    "examples": ["bonos agregados", "monetario euro"],
                },
                {
                    "label": "Factor calidad o dividendo",
                    "percentage": 10,
                    "rationale": "Aporta sesgo a negocios estables sin alejarse mucho del plan.",
                    "examples": ["quality ETF", "dividend ETF"],
                },
                {
                    "label": "Tematica limitada",
                    "percentage": 10,
                    "rationale": "Permite algo de convicción sin convertir la cartera en especulativa.",
                    "examples": ["tecnologia amplia", "salud", "semiconductores"],
                },
            ],
            "focus": "equilibrar crecimiento y control de riesgo con una cartera sencilla",
        },
        "agresivo": {
            "allocation": [
                {
                    "label": "ETF global diversificado",
                    "percentage": 65,
                    "rationale": "Sigue siendo la base más robusta para acumular patrimonio.",
                    "examples": ["MSCI World", "FTSE All-World"],
                },
                {
                    "label": "Nasdaq o growth amplio",
                    "percentage": 20,
                    "rationale": "Introduce mayor sensibilidad a crecimiento y tecnologia.",
                    "examples": ["QQQ", "Nasdaq 100 UCITS"],
                },
                {
                    "label": "Emergentes o small caps",
                    "percentage": 10,
                    "rationale": "Aumenta potencial de retorno, pero tambien volatilidad.",
                    "examples": ["emerging markets ETF", "small cap ETF"],
                },
                {
                    "label": "Liquidez tactica",
                    "percentage": 5,
                    "rationale": "Evita quedarse sin margen para rebalancear o cubrir gastos.",
                    "examples": ["monetario", "cuenta remunerada"],
                },
            ],
            "focus": "buscar más crecimiento aceptando caídas más amplias y períodos difíciles",
        },
    }

    template = templates[risk_profile]
    allocation = []

    for item in template["allocation"]:
        monthly_eur = round((amount or 0) * item["percentage"] / 100, 2) if amount else None
        allocation.append({**item, "monthly_amount": monthly_eur})

    assumptions = []
    if amount is None:
        assumptions.append("No has indicado una aportación mensual exacta; he planteado el plan por porcentajes.")
    if not horizon:
        assumptions.append("Asumo un horizonte de al menos 5 años, porque suele encajar mejor con inversión diversificada.")
    if risk_profile == "moderado" and not any(
        token in normalized for token in ("conservador", "moderado", "agresivo")
    ):
        assumptions.append("Como no has marcado tu perfil de riesgo, he partido de un perfil moderado.")

    return {
        "risk_profile": risk_profile,
        "monthly_amount": amount,
        "horizon": horizon or "5+ años",
        "is_beginner_friendly": is_beginner,
        "focus": template["focus"],
        "allocation": allocation,
        "principles": [
            "Mantener 1 a 4 posiciones principales suele ser suficiente para empezar.",
            "Invertir de forma periódica reduce la dependencia de acertar el mejor momento.",
            "Revisar la cartera una o dos veces al año suele ser más sano que tocarla cada semana.",
        ],
        "assumptions": assumptions,
        "disclaimer": (
            "Esto es una orientacion general, no asesoramiento financiero profesional. "
            "Toda inversión implica riesgo y conviene adaptarla a tu situación real."
        ),
    }


async def analyze_asset_outlook(
    ticker_or_query: str,
    range_key: str = "6M",
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any] | None:
    cleaned_value = normalize_query(ticker_or_query)
    if not cleaned_value:
        return None

    normalized_range = normalize_chart_range(range_key)

    if client is not None:
        return await _analyze_asset_outlook_with_client(client, cleaned_value, normalized_range)

    timeout = httpx.Timeout(10.0, connect=5.0)
    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
    ) as owned_client:
        return await _analyze_asset_outlook_with_client(owned_client, cleaned_value, normalized_range)


async def _analyze_asset_outlook_with_client(
    client: httpx.AsyncClient,
    ticker_or_query: str,
    range_key: str,
) -> dict[str, Any] | None:
    asset = await get_asset_quote(ticker_or_query, client=client)
    if not asset:
        return None

    search_query = build_asset_news_query(asset)
    chart, articles = await asyncio.gather(
        get_asset_chart(asset["symbol"], range_key, client=client),
        search_market_news(search_query, limit=4, include_images=True, client=client),
    )

    score = 0
    reasons = []

    if asset.get("change_percent") is not None:
        if asset["change_percent"] >= 2:
            score += 1
            reasons.append("el precio reciente mantiene una inercia positiva")
        elif asset["change_percent"] <= -2:
            score -= 1
            reasons.append("el precio reciente refleja presión vendedora")

    chart_change = (((chart or {}).get("summary") or {}).get("change_percent"))
    if chart_change is not None:
        if chart_change >= 8:
            score += 1
            reasons.append(f"la tendencia de {range_key} sigue positiva")
        elif chart_change <= -8:
            score -= 1
            reasons.append(f"la tendencia de {range_key} sigue débil")

    news_score = estimate_news_score(articles)
    if news_score >= 2:
        score += 1
        reasons.append("las noticias recientes tienen tono mayoritariamente favorable")
    elif news_score <= -2:
        score -= 1
        reasons.append("las noticias recientes introducen presión o cautela")

    if score >= 2:
        bias = "sesgo_alcista"
        label = "Sesgo alcista prudente"
        risk_level = "medio"
    elif score <= -2:
        bias = "sesgo_bajista"
        label = "Sesgo bajista prudente"
        risk_level = "alto"
    else:
        bias = "mixto"
        label = "Señales mixtas"
        risk_level = "medio-alto"

    if not reasons:
        reasons.append("faltan suficientes señales concluyentes para una lectura fuerte")

    return {
        "asset": asset,
        "chart": chart,
        "articles": articles,
        "outlook": {
            "bias": bias,
            "label": label,
            "risk_level": risk_level,
            "score": score,
            "reasons": reasons,
            "disclaimer": (
                "No hay garantías de movimiento. La lectura debe entenderse como un escenario probable, "
                "no como una certeza."
            ),
        },
    }


async def get_market_overview() -> dict[str, Any]:
    timeout = httpx.Timeout(10.0, connect=5.0)
    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
    ) as client:
        quotes_task = _fetch_quotes_batch(client, MARKET_FEED_SYMBOLS)
        charts_task = asyncio.gather(
            *(get_asset_chart(symbol, "1M", client=client) for symbol in MARKET_FEED_SYMBOLS[:4]),
            return_exceptions=True,
        )
        news_task = search_market_news(
            "mercados financieros bolsa economia tipos de interes",
            limit=3,
            include_images=True,
            client=client,
        )

        quotes, charts, articles = await asyncio.gather(quotes_task, charts_task, news_task)

    chart_map = {
        chart["symbol"]: chart
        for chart in charts
        if isinstance(chart, dict) and chart.get("symbol")
    }

    channels = []

    for quote_item in quotes[:4]:
        symbol = quote_item["symbol"]
        chart = chart_map.get(symbol)
        change_percent = quote_item.get("change_percent")
        bias_copy = "positiva" if (change_percent or 0) >= 0 else "presión"
        body_parts = [
            f"**Precio:** {format_price_label(quote_item.get('price'), quote_item.get('currency'))}",
            f"**Cambio diario:** {format_percentage_label(change_percent)}",
            f"**Lectura rápida:** momentum {bias_copy} con vigilancia sobre volatilidad y noticias.",
        ]

        channels.append(
            {
                "eyebrow": f"{quote_item.get('quote_type_label') or 'Activo'} | {quote_item.get('exchange') or 'Mercado'}",
                "title": f"{quote_item['symbol']} | {quote_item.get('name') or quote_item['symbol']}",
                "body": "\n\n".join(body_parts),
                "linkUrl": build_asset_link(symbol),
                "linkLabel": "Ver activo",
                "asset": quote_item,
                "chart": chart,
            }
        )

    for article in articles:
        channels.append(
            {
                "eyebrow": article.get("source") or "Mercado",
                "title": article.get("title") or "Contexto de mercado",
                "body": article.get("description") or "Sigue el mercado para más contexto.",
                "imageUrl": article.get("image_url") or "",
                "linkUrl": article.get("url") or "",
                "linkLabel": "Abrir fuente",
            }
        )

    return {
        "channels": channels,
        "articles": articles,
        "topic": "mercado global",
    }


async def _get_asset_quote_with_stooq(
    client: httpx.AsyncClient,
    symbol: str,
    asset_ref: dict[str, Any],
) -> dict[str, Any] | None:
    rows = await _fetch_stooq_rows(client, symbol)
    if len(rows) < 1:
        return None

    latest = rows[-1]
    previous = rows[-2] if len(rows) >= 2 else None
    price = latest.get("close")
    previous_close = previous.get("close") if previous else None
    change = round(price - previous_close, 4) if price is not None and previous_close is not None else None
    change_percent = (
        round((change / previous_close) * 100, 2)
        if change is not None and previous_close not in (None, 0)
        else None
    )

    return {
        "symbol": symbol,
        "name": asset_ref.get("name") or symbol,
        "quote_type": asset_ref.get("quote_type"),
        "quote_type_label": quote_type_label(asset_ref.get("quote_type")) or "Activo",
        "exchange": asset_ref.get("exchange") or "Stooq",
        "currency": "USD",
        "price": price,
        "previous_close": previous_close,
        "open": latest.get("open"),
        "day_low": latest.get("low"),
        "day_high": latest.get("high"),
        "change": change,
        "change_percent": change_percent,
        "market_cap": None,
        "volume": latest.get("volume"),
        "fifty_two_week_low": min((row.get("low") for row in rows[-252:] if row.get("low") is not None), default=None),
        "fifty_two_week_high": max((row.get("high") for row in rows[-252:] if row.get("high") is not None), default=None),
        "day_range_percent": (
            round(((latest["high"] - latest["low"]) / latest["low"]) * 100, 2)
            if latest.get("high") is not None and latest.get("low") not in (None, 0)
            else None
        ),
        "market_state": "REGULAR",
        "asset_link": build_asset_link(symbol),
    }


async def _get_asset_chart_with_stooq(
    client: httpx.AsyncClient,
    symbol: str,
    range_key: str,
    asset_ref: dict[str, Any],
) -> dict[str, Any] | None:
    rows = await _fetch_stooq_rows(client, symbol)
    filtered_rows = filter_stooq_rows(rows, range_key)
    if len(filtered_rows) < 2:
        return None

    points = []
    for row in filtered_rows:
        point_time = datetime.combine(row["date"], datetime.min.time(), tzinfo=timezone.utc)
        points.append(
            {
                "timestamp": point_time.isoformat(),
                "label": format_chart_label(point_time, range_key),
                "value": row["close"],
                "open": row.get("open"),
                "high": row.get("high"),
                "low": row.get("low"),
                "volume": row.get("volume"),
            }
        )

    values = [point["value"] for point in points]
    start_value = values[0]
    end_value = values[-1]
    change = round(end_value - start_value, 4)
    change_percent = round((change / start_value) * 100, 2) if start_value else None
    returns = []

    for previous, current in zip(values, values[1:]):
        if previous:
            returns.append(((current - previous) / previous) * 100)

    return {
        "symbol": symbol,
        "name": asset_ref.get("name") or symbol,
        "currency": "USD",
        "exchange": asset_ref.get("exchange") or "Stooq",
        "instrument_type": asset_ref.get("quote_type"),
        "range": range_key,
        "available_ranges": list(CHART_RANGE_CONFIG.keys()),
        "points": points,
        "summary": {
            "start": round(start_value, 4),
            "end": round(end_value, 4),
            "change": change,
            "change_percent": change_percent,
            "high": round(max(values), 4),
            "low": round(min(values), 4),
            "volatility": round(pstdev(returns), 2) if len(returns) >= 2 else None,
        },
    }


async def _fetch_stooq_rows(
    client: httpx.AsyncClient,
    symbol: str,
) -> list[dict[str, Any]]:
    stooq_symbol = to_stooq_symbol(symbol)
    if not stooq_symbol:
        return []

    try:
        response = await client.get(
            STOOQ_DAILY_URL,
            params={"s": stooq_symbol, "i": "d"},
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return []

    content = response.text.replace("\r", "").strip()
    if not content or content.startswith("No data"):
        return []

    reader = csv.DictReader(StringIO(content))
    rows = []

    for row in reader:
        date_text = clean_text(row.get("Date"))
        if not date_text:
            continue

        try:
            parsed_date = datetime.strptime(date_text, "%Y-%m-%d").date()
        except ValueError:
            continue

        rows.append(
            {
                "date": parsed_date,
                "open": _safe_number(row.get("Open")),
                "high": _safe_number(row.get("High")),
                "low": _safe_number(row.get("Low")),
                "close": _safe_number(row.get("Close")),
                "volume": _safe_number(row.get("Volume")),
            }
        )

    return [row for row in rows if row.get("close") is not None]


async def resolve_asset_reference(
    ticker_or_query: str,
    client: httpx.AsyncClient,
) -> dict[str, Any] | None:
    cleaned_value = normalize_query(ticker_or_query)
    if not cleaned_value:
        return None

    alias_symbol = find_alias_symbol(cleaned_value)
    if alias_symbol:
        return {
            "symbol": alias_symbol,
            "name": alias_symbol,
            "quote_type": None,
            "exchange": None,
        }

    direct_tickers = detect_tickers_from_user_message(cleaned_value)
    if direct_tickers:
        return {
            "symbol": direct_tickers[0],
            "name": direct_tickers[0],
            "quote_type": None,
            "exchange": None,
        }

    return await search_asset_symbol(cleaned_value, client=client)


async def _fetch_quotes_batch(
    client: httpx.AsyncClient,
    symbols: list[str],
) -> list[dict[str, Any]]:
    unique_symbols = [symbol for symbol in dict.fromkeys(symbols) if symbol]
    if not unique_symbols:
        return []

    try:
        response = await client.get(
            YAHOO_QUOTE_URL,
            params={"symbols": ",".join(unique_symbols)},
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return await _fetch_quotes_from_chart_batch(client, unique_symbols)

    payload = response.json()
    results = (payload.get("quoteResponse") or {}).get("result") or []
    parsed_results = []

    for item in results:
        symbol = clean_text(item.get("symbol"))
        if not symbol:
            continue

        day_low = _safe_number(item.get("regularMarketDayLow"))
        day_high = _safe_number(item.get("regularMarketDayHigh"))
        day_range_percent = None
        if day_low not in (None, 0) and day_high is not None:
            day_range_percent = round(((day_high - day_low) / day_low) * 100, 2)

        parsed_results.append(
            {
                "symbol": symbol,
                "name": clean_text(item.get("longName"))
                or clean_text(item.get("shortName"))
                or symbol,
                "quote_type": clean_text(item.get("quoteType")) or None,
                "quote_type_label": quote_type_label(item.get("quoteType")),
                "exchange": clean_text(item.get("fullExchangeName"))
                or clean_text(item.get("exchange"))
                or None,
                "currency": clean_text(item.get("currency")) or None,
                "price": _safe_number(item.get("regularMarketPrice")),
                "previous_close": _safe_number(item.get("regularMarketPreviousClose")),
                "open": _safe_number(item.get("regularMarketOpen")),
                "day_low": day_low,
                "day_high": day_high,
                "change": _safe_number(item.get("regularMarketChange")),
                "change_percent": _safe_number(item.get("regularMarketChangePercent")),
                "market_cap": _safe_number(item.get("marketCap")),
                "volume": _safe_number(item.get("regularMarketVolume")),
                "fifty_two_week_low": _safe_number(item.get("fiftyTwoWeekLow")),
                "fifty_two_week_high": _safe_number(item.get("fiftyTwoWeekHigh")),
                "day_range_percent": day_range_percent,
                "market_state": clean_text(item.get("marketState")) or None,
                "asset_link": build_asset_link(symbol),
            }
        )

    if len(parsed_results) == len(unique_symbols):
        return parsed_results

    missing_symbols = [
        symbol for symbol in unique_symbols if symbol not in {item["symbol"] for item in parsed_results}
    ]
    if not missing_symbols:
        return parsed_results

    fallback_results = await _fetch_quotes_from_chart_batch(client, missing_symbols)
    return dedupe_assets(parsed_results + fallback_results)


async def _fetch_quotes_from_chart_batch(
    client: httpx.AsyncClient,
    symbols: list[str],
) -> list[dict[str, Any]]:
    fallback_results = await asyncio.gather(
        *(_get_asset_quote_from_chart(client, symbol) for symbol in symbols),
        return_exceptions=True,
    )

    return [
        item
        for item in fallback_results
        if isinstance(item, dict) and item.get("symbol")
    ]


def detect_tickers_from_user_message(message: str) -> list[str]:
    normalized = normalize_query(message)
    if not normalized:
        return []

    candidates = []

    for token in re.findall(r"(?<![A-Z0-9^.-])(\^?[A-Z][A-Z0-9.-]{0,5})(?![A-Z0-9.-])", normalized):
        cleaned = token.strip(".")
        if cleaned in {"ETF", "ETFS", "USD", "EUR", "IA"}:
            continue
        if len(cleaned.replace("^", "").replace("-", "")) < 2:
            continue
        candidates.append(cleaned)

    for alias_key, alias_symbol in ASSET_ALIASES.items():
        if alias_key in fold_text(normalized):
            candidates.append(alias_symbol)

    return list(dict.fromkeys(candidates))


def normalize_query(query: str | None) -> str:
    return re.sub(r"\s+", " ", (query or "")).strip()


def fold_text(value: str | None) -> str:
    normalized = normalize_query(value).lower()
    decomposed = unicodedata.normalize("NFD", normalized)
    return "".join(char for char in decomposed if unicodedata.category(char) != "Mn")


def normalize_chart_range(range_key: str | None) -> str:
    candidate = normalize_query(range_key).upper()
    return candidate if candidate in CHART_RANGE_CONFIG else "1M"


def to_stooq_symbol(symbol: str) -> str | None:
    cleaned = clean_text(symbol).lower()
    if not cleaned:
        return None

    if cleaned.endswith(".us"):
        return cleaned

    if cleaned.endswith("-usd"):
        return None

    if cleaned.startswith("^"):
        index_map = {
            "^gspc": "spx",
            "^ixic": "ndq",
            "^dji": "dji",
        }
        return index_map.get(cleaned)

    return f"{cleaned}.us"


def filter_stooq_rows(rows: list[dict[str, Any]], range_key: str) -> list[dict[str, Any]]:
    if not rows:
        return []

    max_points = STOOQ_RANGE_DAYS.get(range_key, STOOQ_RANGE_DAYS["1M"])
    return rows[-max_points:]


def is_generic_market_query(query: str) -> bool:
    return fold_text(query) in GENERIC_MARKET_QUERIES


def find_alias_symbol(value: str) -> str | None:
    folded = fold_text(value)
    for alias_key, alias_symbol in ASSET_ALIASES.items():
        if alias_key in folded:
            return alias_symbol
    return None


def extract_monthly_amount(value: str) -> float | None:
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:eur|euros?)", value, re.IGNORECASE)
    if not match and "\u20ac" in value:
        match = re.search(r"(\d+(?:[.,]\d+)?)\s*\u20ac", value, re.IGNORECASE)
    if not match:
        match = re.search(
            r"(\d+(?:[.,]\d+)?)\s*(?:al mes|mensuales|mensual)",
            value,
            re.IGNORECASE,
        )
    if not match:
        return None

    try:
        return round(float(match.group(1).replace(",", ".")), 2)
    except ValueError:
        return None


def extract_horizon(value: str) -> str | None:
    match = re.search(r"(\d+)\s*(anos|meses)", fold_text(value))
    if not match:
        if "largo plazo" in fold_text(value):
            return "7+ años"
        if "corto plazo" in fold_text(value):
            return "1-3 años"
        return None

    amount = match.group(1)
    unit = match.group(2)
    if "mes" in unit:
        return f"{amount} meses"
    return f"{amount} años"


def infer_risk_profile(normalized_message: str) -> str:
    if any(token in normalized_message for token in ("conservador", "prudente", "bajo riesgo")):
        return "conservador"
    if any(token in normalized_message for token in ("agresivo", "alto riesgo", "mas riesgo")):
        return "agresivo"
    return "moderado"


def build_comparison_summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    if not items:
        return {}

    lowest_volatility = None
    highest_change = None

    for item in items:
        if highest_change is None or (item.get("change_percent") or -math.inf) > (
            highest_change.get("change_percent") or -math.inf
        ):
            highest_change = item

        if lowest_volatility is None or (item.get("day_range_percent") or math.inf) < (
            lowest_volatility.get("day_range_percent") or math.inf
        ):
            lowest_volatility = item

    return {
        "leader": highest_change["symbol"] if highest_change else None,
        "most_stable": lowest_volatility["symbol"] if lowest_volatility else None,
    }


def dedupe_assets(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped = []
    seen = set()

    for item in items:
        symbol = item.get("symbol")
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        deduped.append(item)

    return deduped


def build_search_match(
    symbol: str,
    name: str,
    quote_type: str | None = None,
    exchange: str | None = None,
) -> dict[str, Any]:
    cleaned_symbol = clean_text(symbol)
    cleaned_name = clean_text(name) or cleaned_symbol
    cleaned_quote_type = clean_text(quote_type) or None
    cleaned_exchange = clean_text(exchange) or None
    return {
        "symbol": cleaned_symbol,
        "name": cleaned_name,
        "quote_type": cleaned_quote_type,
        "quote_type_label": quote_type_label(cleaned_quote_type),
        "exchange": cleaned_exchange,
    }


def parse_search_match(item: dict[str, Any]) -> dict[str, Any] | None:
    symbol = clean_text(item.get("symbol"))
    if not symbol:
        return None

    quote_type = clean_text(item.get("quoteType"))
    if quote_type and quote_type not in {"EQUITY", "ETF", "INDEX", "CRYPTOCURRENCY"}:
        return None

    return build_search_match(
        symbol=symbol,
        name=clean_text(item.get("shortname")) or clean_text(item.get("longname")) or symbol,
        quote_type=quote_type or None,
        exchange=clean_text(item.get("exchDisp")) or None,
    )


def estimate_news_score(articles: list[dict[str, Any]]) -> int:
    score = 0

    for article in articles:
        text = fold_text(
            f"{article.get('title') or ''} {article.get('description') or ''}"
        )

        if any(keyword in text for keyword in POSITIVE_NEWS_KEYWORDS):
            score += 1
        if any(keyword in text for keyword in NEGATIVE_NEWS_KEYWORDS):
            score -= 1

    return score


def build_asset_news_query(asset: dict[str, Any]) -> str:
    symbol = asset.get("symbol") or ""
    name = asset.get("name") or symbol
    return normalize_query(f"{name} {symbol} stock earnings market")


def quote_type_label(value: str | None) -> str | None:
    if not value:
        return None
    return QUOTE_TYPE_LABELS.get(clean_text(value).upper(), clean_text(value))


def build_asset_link(symbol: str) -> str:
    return f"https://finance.yahoo.com/quote/{quote(symbol, safe='')}"


def format_price_label(value: float | None, currency: str | None) -> str:
    if value is None:
        return "Dato no disponible"
    suffix = f" {currency}" if currency else ""
    return f"{value:,.2f}{suffix}".replace(",", "_").replace(".", ",").replace("_", ".")


def format_percentage_label(value: float | None) -> str:
    if value is None:
        return "Dato no disponible"
    prefix = "+" if value > 0 else ""
    return f"{prefix}{value:.2f}%"


def format_chart_label(point_time: datetime, range_key: str) -> str:
    if range_key in {"1D", "5D"}:
        return point_time.strftime("%d %b %H:%M")
    if range_key in {"1M", "6M"}:
        return point_time.strftime("%d %b")
    return point_time.strftime("%b %Y")


async def _fetch_newsapi_articles(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
) -> list[dict[str, Any]]:
    endpoint = "https://newsapi.org/v2/everything"
    params = {
        "language": NEWS_LANGUAGE,
        "pageSize": limit,
        "sortBy": "publishedAt",
        "apiKey": NEWSAPI_API_KEY,
    }

    if query and not is_generic_market_query(query):
        params["q"] = query
    else:
        endpoint = "https://newsapi.org/v2/top-headlines"
        params = {
            "country": NEWS_COUNTRY.lower(),
            "category": "business",
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


async def _fetch_google_news_articles(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
    include_images: bool,
) -> list[dict[str, Any]]:
    search_query = build_market_news_query(query)

    params = {
        "hl": f"{NEWS_LANGUAGE}-{NEWS_COUNTRY.upper()}",
        "gl": NEWS_COUNTRY.upper(),
        "ceid": f"{NEWS_COUNTRY.upper()}:{NEWS_LANGUAGE}",
        "q": search_query,
    }

    try:
        response = await client.get("https://news.google.com/rss/search", params=params)
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


def build_market_news_query(query: str) -> str:
    if is_generic_market_query(query):
        return "mercados financieros bolsa economia tipos de interes"

    if detect_tickers_from_user_message(query):
        return f"{query} stock earnings market"

    return f"{query} bolsa economia finanzas"


async def enrich_articles(
    client: httpx.AsyncClient,
    articles: list[dict[str, Any]],
    include_images: bool,
) -> list[dict[str, Any]]:
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


async def fetch_article_metadata(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
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


def split_title_and_source(raw_title: str) -> tuple[str, str]:
    parts = raw_title.rsplit(" - ", 1)
    if len(parts) == 2:
        return clean_text(parts[0]), clean_text(parts[1])
    return raw_title, ""


def strip_known_source(raw_title: str, source: str) -> str:
    suffix = f" - {source}"
    if raw_title.endswith(suffix):
        return raw_title[: -len(suffix)].strip()
    return raw_title


def extract_first_image(fragment: str) -> str | None:
    match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', fragment or "", re.IGNORECASE)
    return html.unescape(match.group(1)) if match else None


def strip_html(fragment: str) -> str:
    if not fragment:
        return ""

    without_images = re.sub(r"<img\b[^>]*>", " ", fragment, flags=re.IGNORECASE)
    without_tags = re.sub(r"<[^>]+>", " ", without_images)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def extract_meta_content(html_text: str, keys: tuple[str, ...]) -> str | None:
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


def absolute_url(url: str | None, base_url: str | None) -> str | None:
    if not url:
        return None
    if url.startswith("//"):
        return f"https:{url}"
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if base_url:
        return urljoin(base_url, url)
    return url


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", html.unescape(str(value))).strip()


def normalize_published_at(value: Any) -> str | None:
    if not value:
        return None

    text = clean_text(value)

    try:
        if text.endswith("Z"):
            return (
                datetime.fromisoformat(text.replace("Z", "+00:00"))
                .astimezone(timezone.utc)
                .isoformat()
            )
        return datetime.fromisoformat(text).astimezone(timezone.utc).isoformat()
    except ValueError:
        pass

    try:
        return parsedate_to_datetime(text).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, IndexError):
        return text


def _find_last_series_number(values: list[Any]) -> float | None:
    for value in reversed(values):
        number = _safe_number(value)
        if number is not None:
            return number
    return None


def _safe_number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None
