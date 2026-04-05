import json
import re

from groq import Groq

from app.backend.config import GROQ_API_KEY
from app.backend.services.market_service import detect_tickers_from_user_message, fold_text

from .Prompts import INVESTMENT_ROUTING_PROMPT

client = Groq(api_key=GROQ_API_KEY)

VALID_ACTIONS = {"SEARCH_MARKET", "GET_ASSET", "COMPARE_ASSETS", "INVESTMENT_PLAN", "CHAT"}
VALID_RANGES = {"1D", "5D", "1M", "6M", "1Y", "5Y"}
VALID_RESPONSE_STYLES = {"summary", "explain", "bull_bear", "plan", "comparison", "education"}


def ask_groq(messages, temperature=0.7):
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=messages,
        temperature=temperature,
    )
    return response.choices[0].message.content


def decide_investment_action(user_message, history=None):
    history_excerpt = _build_history_excerpt(history)

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": INVESTMENT_ROUTING_PROMPT},
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
    parsed = _parse_routing_json(content)

    if not parsed:
        return _fallback_decision(user_message, history)

    action = parsed.get("action")
    if action not in VALID_ACTIONS:
        return _fallback_decision(user_message, history)

    response_style = parsed.get("response_style")
    time_range = parsed.get("time_range")
    assets = [normalize_asset_label(item) for item in parsed.get("assets") or [] if normalize_asset_label(item)]

    primary_asset = normalize_asset_label(parsed.get("primary_asset"))
    if primary_asset and primary_asset not in assets:
        assets.insert(0, primary_asset)

    return {
        "action": action,
        "query": normalize_query(parsed.get("query")),
        "primary_asset": primary_asset,
        "assets": assets,
        "needs_chart": bool(parsed.get("needs_chart")),
        "time_range": time_range if time_range in VALID_RANGES else None,
        "response_style": response_style if response_style in VALID_RESPONSE_STYLES else "summary",
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


def _parse_routing_json(content):
    raw = (content or "").strip()
    if not raw:
        return None

    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _fallback_decision(user_message, history=None):
    normalized = fold_text(user_message)
    history_tickers = extract_tickers_from_history(history)
    message_tickers = detect_tickers_from_user_message(user_message)
    all_tickers = list(dict.fromkeys(message_tickers + history_tickers))

    compare_tokens = (" vs ", " versus ", "frente a", "contra", "compar", "mejor que")
    market_tokens = (
        "noticias",
        "mercado",
        "mercados",
        "economia",
        "inflacion",
        "fed",
        "tipos",
        "sector",
        "sectores",
        "macro",
        "resultados",
    )
    plan_tokens = (
        "plan",
        "cartera",
        "invertir",
        "inversion",
        "al mes",
        "mensual",
        "diversific",
        "conservador",
        "moderado",
        "agresivo",
        "riesgo",
    )
    asset_tokens = (
        "accion",
        "acciones",
        "etf",
        "indice",
        "ticker",
        "grafica",
        "grafico",
        "chart",
        "precio",
        "cotizacion",
        "ves",
        "opinas",
        "subir",
        "bajar",
    )

    if any(token in normalized for token in compare_tokens) and len(all_tickers) >= 2:
        return {
            "action": "COMPARE_ASSETS",
            "query": normalize_query(user_message),
            "primary_asset": all_tickers[0],
            "assets": all_tickers[:4],
            "needs_chart": "graf" in normalized or "chart" in normalized,
            "time_range": infer_time_range(normalized),
            "response_style": "comparison",
        }

    if any(token in normalized for token in plan_tokens) and not (
        len(all_tickers) == 1 and any(token in normalized for token in asset_tokens)
    ):
        return {
            "action": "INVESTMENT_PLAN",
            "query": normalize_query(user_message),
            "primary_asset": None,
            "assets": [],
            "needs_chart": False,
            "time_range": None,
            "response_style": "plan",
        }

    if all_tickers and (
        any(token in normalized for token in asset_tokens) or len(all_tickers) == 1
    ):
        return {
            "action": "GET_ASSET",
            "query": normalize_query(user_message),
            "primary_asset": all_tickers[0],
            "assets": all_tickers[:1],
            "needs_chart": any(token in normalized for token in ("graf", "chart", "precio", "cotizacion", "evolucion")),
            "time_range": infer_time_range(normalized),
            "response_style": infer_response_style(normalized, default="bull_bear"),
        }

    if any(token in normalized for token in market_tokens):
        return {
            "action": "SEARCH_MARKET",
            "query": normalize_query(user_message),
            "primary_asset": all_tickers[0] if all_tickers else None,
            "assets": all_tickers[:2],
            "needs_chart": False,
            "time_range": infer_time_range(normalized),
            "response_style": infer_response_style(normalized, default="summary"),
        }

    return {
        "action": "CHAT",
        "query": None,
        "primary_asset": all_tickers[0] if all_tickers else None,
        "assets": all_tickers[:2],
        "needs_chart": False,
        "time_range": None,
        "response_style": infer_response_style(normalized, default="education"),
    }


def infer_response_style(normalized_message, default="summary"):
    if any(token in normalized_message for token in ("facil", "sencill", "explica", "principiante")):
        return "explain"
    if any(token in normalized_message for token in ("subir", "bajar", "alcista", "bajista", "ves", "opinas")):
        return "bull_bear"
    if any(token in normalized_message for token in ("compar", "vs", "frente", "contra")):
        return "comparison"
    if any(token in normalized_message for token in ("plan", "cartera", "riesgo", "diversific")):
        return "plan"
    return default


def infer_time_range(normalized_message):
    compact = normalized_message.replace(" ", "")
    for value in VALID_RANGES:
        if value.lower() in compact:
            return value
    return None


def extract_tickers_from_history(history):
    if not history:
        return []

    collected = []
    for item in history[-4:]:
        collected.extend(detect_tickers_from_user_message(item.get("content") or ""))

    return list(dict.fromkeys(collected))


def normalize_query(value):
    cleaned = re.sub(r"\s+", " ", str(value or "")).strip()
    return cleaned or None


def normalize_asset_label(value):
    cleaned = normalize_query(value)
    return cleaned
