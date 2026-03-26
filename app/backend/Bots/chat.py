import json
import re
import unicodedata

from groq import Groq

from ..config import GROQ_API_KEY
from .Prompts import NEWS_ROUTING_PROMPT

client = Groq(api_key=GROQ_API_KEY)


def ask_groq(messages, temperature=0.7):
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=messages,
        temperature=temperature,
    )
    return response.choices[0].message.content


def decide_news_action(user_message, history=None):
    history_excerpt = _build_history_excerpt(history)

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": NEWS_ROUTING_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Historial reciente:\n{history_excerpt}\n\n"
                    f"Mensaje actual:\n{user_message}"
                ),
            },
        ],
        temperature=0,
    )

    content = response.choices[0].message.content

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return _fallback_decision(user_message)

    if parsed.get("action") not in {"SEARCH_NEWS", "CHAT"}:
        return _fallback_decision(user_message)

    return {
        "action": parsed.get("action", "CHAT"),
        "query": parsed.get("query"),
        "needs_images": bool(parsed.get("needs_images")),
        "response_style": parsed.get("response_style", "summary"),
    }


def _build_history_excerpt(history):
    if not history:
        return "Sin historial relevante."

    chunks = []

    for item in history[-6:]:
        role = "Usuario" if item.get("role") == "user" else "Asistente"
        content = re.sub(r"\s+", " ", (item.get("content") or "")).strip()
        if not content:
            continue
        chunks.append(f"{role}: {content[:220]}")

    return "\n".join(chunks) or "Sin historial relevante."


def _fallback_decision(user_message):
    normalized = fold_text(user_message)

    image_keywords = ("imagen", "imagenes", "foto", "fotos", "visual")
    news_keywords = (
        "noticia",
        "noticias",
        "actualidad",
        "titular",
        "titulares",
        "hoy",
        "ayer",
        "ultim",
        "recient",
        "resumen",
        "contexto",
        "explica",
        "openai",
        "ia",
        "inteligencia artificial",
        "tecnologia",
        "economia",
        "deportes",
        "politica",
        "internacional",
        "espana",
        "mundo",
        "mercado",
        "bolsa",
    )

    if any(keyword in normalized for keyword in news_keywords) or any(
        keyword in normalized for keyword in image_keywords
    ):
        return {
            "action": "SEARCH_NEWS",
            "query": None if any(token in normalized for token in ("dia", "titulares")) else user_message,
            "needs_images": any(keyword in normalized for keyword in image_keywords),
            "response_style": _infer_response_style(normalized),
        }

    return {
        "action": "CHAT",
        "query": None,
        "needs_images": False,
        "response_style": _infer_response_style(normalized),
    }


def _infer_response_style(normalized_message):
    if any(token in normalized_message for token in ("15", "facil", "fasil", "sencill", "explica")):
        return "explain"
    if any(token in normalized_message for token in ("contexto", "significa", "por que")):
        return "context"
    if any(token in normalized_message for token in ("titular", "mas importantes", "importantes del dia")):
        return "headlines"
    return "summary"


def fold_text(value):
    normalized = re.sub(r"\s+", " ", (value or "").lower()).strip()
    decomposed = unicodedata.normalize("NFD", normalized)
    return "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
