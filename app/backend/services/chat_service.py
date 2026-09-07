import asyncio
from typing import Any

from app.backend.Bots.Prompts import SYSTEM_PROMPT
from app.backend.Bots.chat import ask_groq
from app.backend.services.market_service import (
    analyze_asset_outlook,
    build_investment_plan,
    compare_assets,
    format_percentage_label,
    format_price_label,
    get_asset_chart,
    get_asset_quote,
    get_market_overview,
    search_market_news,
)

MAX_HISTORY_ITEMS = 8


async def handle_chat(user_message, history=None):
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *build_history_messages(history),
        {"role": "user", "content": user_message},
    ]

    bot_reply = await asyncio.to_thread(ask_groq, messages, temperature=0.55)
    return build_response(bot_message=bot_reply)


async def handle_market_request(user_message, history=None, decision=None):
    decision = decision or {}
    action = decision.get("action") or "CHAT"

    if action == "GET_ASSET":
        return await handle_asset_request(user_message, history, decision)
    if action == "COMPARE_ASSETS":
        return await handle_comparison_request(user_message, history, decision)
    if action == "INVESTMENT_PLAN":
        return await handle_investment_plan_request(user_message, history, decision)
    if action == "SEARCH_MARKET":
        return await handle_market_search_request(user_message, history, decision)

    return await handle_chat(user_message, history)


async def handle_market_search_request(user_message, history=None, decision=None):
    decision = decision or {}
    search_query = decision.get("query") or user_message
    primary_asset = decision.get("primary_asset")
    time_range = decision.get("time_range") or "1M"
    response_style = decision.get("response_style") or "summary"

    articles_task = search_market_news(search_query, limit=6, include_images=True)
    asset_task = get_asset_quote(primary_asset) if primary_asset else _return_none()
    chart_task = (
        get_asset_chart(primary_asset, time_range)
        if primary_asset and decision.get("needs_chart")
        else _return_none()
    )

    articles, asset, chart = await asyncio.gather(articles_task, asset_task, chart_task)

    if not articles and not asset:
        return build_response(
            bot_message=(
                "No he encontrado suficiente contexto de mercado fiable ahora mismo. "
                "Prueba con un activo, sector o tema económico más concreto."
            ),
            topic=search_query,
        )

    summary_request = build_market_summary_request(
        user_message=user_message,
        search_query=search_query,
        response_style=response_style,
        articles=articles,
        asset=asset,
        chart=chart,
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *build_history_messages(history),
        {"role": "user", "content": summary_request},
    ]
    bot_reply = await asyncio.to_thread(ask_groq, messages, temperature=0.35)

    channels = []
    if asset:
        channels.append(
            build_asset_channel(
                asset=asset,
                chart=chart,
                body=build_asset_snapshot_body(asset, chart),
            )
        )

    channels.extend(build_article_channels(articles))

    return build_response(
        bot_message=bot_reply,
        topic=search_query,
        articles=articles,
        asset=asset,
        chart=chart,
        channels=channels,
    )


async def handle_asset_request(user_message, history=None, decision=None):
    decision = decision or {}
    primary_asset = decision.get("primary_asset") or decision.get("query") or user_message
    time_range = decision.get("time_range") or "6M"
    response_style = decision.get("response_style") or "bull_bear"

    analysis = await analyze_asset_outlook(primary_asset, range_key=time_range)

    if not analysis:
        return build_response(
            bot_message=(
                "No he podido identificar ese activo con suficiente seguridad. "
                "Si quieres, escribe el ticker o el nombre exacto para analizarlo mejor."
            ),
            topic=primary_asset,
        )

    summary_request = build_asset_analysis_request(
        user_message=user_message,
        analysis=analysis,
        response_style=response_style,
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *build_history_messages(history),
        {"role": "user", "content": summary_request},
    ]
    asset = analysis["asset"]
    chart = analysis.get("chart")
    articles = analysis.get("articles") or []
    outlook = analysis.get("outlook") or {}

    if decision.get("needs_chart") and chart:
        bot_reply = (
            f"Aquí tienes la gráfica de {asset.get('name') or asset.get('symbol')} "
            f"({asset.get('symbol')}) para el rango {chart.get('range')}."
        )
    else:
        try:
            bot_reply = await asyncio.to_thread(ask_groq, messages, temperature=0.35)
        except Exception:
            bot_reply = build_asset_outlook_body(asset, chart, outlook)

    channels = [
        build_asset_channel(
            asset=asset,
            chart=chart,
            body=build_asset_outlook_body(asset, chart, outlook),
        )
    ]
    channels.extend(build_article_channels(articles))

    return build_response(
        bot_message=bot_reply,
        topic=asset.get("symbol") or primary_asset,
        articles=articles,
        asset=asset,
        chart=chart,
        outlook=outlook,
        channels=channels,
    )


async def handle_comparison_request(user_message, history=None, decision=None):
    decision = decision or {}
    asset_inputs = decision.get("assets") or []
    if len(asset_inputs) < 2 and decision.get("primary_asset"):
        asset_inputs = [decision["primary_asset"]]

    comparison = await compare_assets(asset_inputs)
    items = comparison.get("items") or []

    if len(items) < 2:
        return build_response(
            bot_message=(
                "Necesito al menos dos activos reconocibles para compararlos bien. "
                "Prueba algo como `VOO vs QQQ` o `Apple frente a Microsoft`."
            ),
            topic="comparación",
        )

    summary_request = build_comparison_request(
        user_message=user_message,
        comparison=comparison,
        response_style=decision.get("response_style") or "comparison",
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *build_history_messages(history),
        {"role": "user", "content": summary_request},
    ]
    bot_reply = await asyncio.to_thread(ask_groq, messages, temperature=0.35)

    channels = [
        build_asset_channel(
            asset=item,
            chart=None,
            body=build_asset_snapshot_body(item, None),
        )
        for item in items[:4]
    ]

    return build_response(
        bot_message=bot_reply,
        topic="comparación",
        comparison=comparison,
        channels=channels,
    )


async def handle_investment_plan_request(user_message, history=None, decision=None):
    plan = build_investment_plan(user_message)

    summary_request = build_plan_request(user_message=user_message, plan=plan)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *build_history_messages(history),
        {"role": "user", "content": summary_request},
    ]
    bot_reply = await asyncio.to_thread(ask_groq, messages, temperature=0.35)

    channels = [
        {
            "eyebrow": f"Plan {plan['risk_profile']}",
            "title": "Plan orientativo de inversión",
            "body": build_plan_channel_body(plan),
            "linkUrl": "",
            "linkLabel": "",
        }
    ]

    return build_response(
        bot_message=bot_reply,
        topic="plan de inversión",
        investment_plan=plan,
        channels=channels,
    )


async def handle_live_feed_request():
    overview = await get_market_overview()
    return build_response(
        bot_message="",
        topic=overview.get("topic"),
        articles=overview.get("articles") or [],
        channels=overview.get("channels") or [],
    )


def build_history_messages(history):
    messages = []

    for item in (history or [])[-MAX_HISTORY_ITEMS:]:
        role = "assistant" if item.get("role") == "assistant" else "user"
        content = (item.get("content") or "").strip()

        if not content:
            continue

        messages.append({"role": role, "content": content[:1600]})

    return messages


def build_response(
    *,
    bot_message: str,
    topic: str | None = None,
    articles: list[dict[str, Any]] | None = None,
    channels: list[dict[str, Any]] | None = None,
    asset: dict[str, Any] | None = None,
    chart: dict[str, Any] | None = None,
    comparison: dict[str, Any] | None = None,
    investment_plan: dict[str, Any] | None = None,
    outlook: dict[str, Any] | None = None,
):
    return {
        "bot_message": bot_message,
        "topic": topic,
        "articles": articles or [],
        "channels": channels or [],
        "asset": asset,
        "chart": chart,
        "comparison": comparison,
        "investment_plan": investment_plan,
        "outlook": outlook,
    }


def build_market_summary_request(
    *,
    user_message: str,
    search_query: str,
    response_style: str,
    articles: list[dict[str, Any]],
    asset: dict[str, Any] | None,
    chart: dict[str, Any] | None,
) -> str:
    return (
        f"Consulta del usuario: {user_message}\n"
        f"Consulta de mercado usada: {search_query}\n"
        f"Estilo deseado: {response_style}\n\n"
        f"Activo relacionado:\n{serialize_asset(asset)}\n\n"
        f"Resumen de gráfica:\n{serialize_chart(chart)}\n\n"
        f"Noticias disponibles:\n{serialize_articles(articles)}\n\n"
        "Instrucciones:\n"
        "- Responde en español.\n"
        "- Resume el contexto de mercado con orden.\n"
        "- Si procede, conecta las noticias con posibles efectos sobre el activo o sector.\n"
        "- Si hay dudas o falta de datos, dilo sin inventar.\n"
        "- No prometas rentabilidades ni certezas.\n"
        "- Si el usuario parece principiante, simplifica el lenguaje.\n"
    )


def build_asset_analysis_request(
    *,
    user_message: str,
    analysis: dict[str, Any],
    response_style: str,
) -> str:
    return (
        f"Consulta del usuario: {user_message}\n"
        f"Estilo deseado: {response_style}\n\n"
        f"Activo:\n{serialize_asset(analysis.get('asset'))}\n\n"
        f"Gráfica seleccionada:\n{serialize_chart(analysis.get('chart'))}\n\n"
        f"Lectura cuantitativa:\n{serialize_outlook(analysis.get('outlook'))}\n\n"
        f"Noticias recientes:\n{serialize_articles(analysis.get('articles') or [])}\n\n"
        "Instrucciones:\n"
        "- Da una opinion razonada, nunca una certeza.\n"
        "- Usa expresiones como sesgo alcista, sesgo bajista o señales mixtas cuando encaje.\n"
        "- Explica riesgos y catalizadores principales.\n"
        "- Si faltan datos, marca la incertidumbre.\n"
        "- Cierra con una nota breve de prudencia financiera natural, sin exagerar.\n"
    )


def build_comparison_request(
    *,
    user_message: str,
    comparison: dict[str, Any],
    response_style: str,
) -> str:
    items = comparison.get("items") or []
    formatted_items = []

    for index, item in enumerate(items, start=1):
        formatted_items.append(
            "\n".join(
                [
                    f"Activo {index}",
                    f"Nombre: {item.get('name') or item.get('symbol')}",
                    f"Ticker: {item.get('symbol')}",
                    f"Tipo: {item.get('quote_type_label') or item.get('quote_type') or 'Activo'}",
                    f"Precio: {format_price_label(item.get('price'), item.get('currency'))}",
                    f"Cambio diario: {format_percentage_label(item.get('change_percent'))}",
                    f"52 semanas: {format_price_label(item.get('fifty_two_week_low'), item.get('currency'))} - {format_price_label(item.get('fifty_two_week_high'), item.get('currency'))}",
                ]
            )
        )

    return (
        f"Consulta del usuario: {user_message}\n"
        f"Estilo deseado: {response_style}\n\n"
        "Activos a comparar:\n"
        f"{chr(10).join(formatted_items)}\n\n"
        "Instrucciones:\n"
        "- Compara con lenguaje claro y útil.\n"
        "- Destaca diferencias prácticas: diversificación, coste implícito de concentración, sesgo sectorial o volatilidad si aplica.\n"
        "- No conviertas la comparación en una recomendación absoluta.\n"
        "- Si un activo parece más estable o más agresivo, exprésalo como tendencia general.\n"
    )


def build_plan_request(*, user_message: str, plan: dict[str, Any]) -> str:
    allocation_lines = []

    for item in plan["allocation"]:
        monthly_amount = (
            f" | Aporte mensual aprox.: {item['monthly_amount']:.2f} EUR"
            if item.get("monthly_amount") is not None
            else ""
        )
        allocation_lines.append(
            f"- {item['percentage']}% {item['label']}: {item['rationale']}{monthly_amount}"
        )

    return (
        f"Consulta del usuario: {user_message}\n"
        f"Perfil inferido: {plan['risk_profile']}\n"
        f"Horizonte: {plan['horizon']}\n"
        f"Aporte mensual: {plan.get('monthly_amount') or 'No indicado'}\n"
        f"Foco del plan: {plan['focus']}\n\n"
        "Asignacion propuesta:\n"
        f"{chr(10).join(allocation_lines)}\n\n"
        "Suposiciones:\n"
        f"{serialize_lines(plan.get('assumptions') or ['Sin supuestos adicionales'])}\n\n"
        "Instrucciones:\n"
        "- Presenta el plan como orientativo y prudente.\n"
        "- Explica por qué puede encajar con ese perfil.\n"
        "- Menciona riesgo, horizonte temporal y diversificación.\n"
        "- Si el usuario parece principiante, simplifícalo aún más.\n"
        f"- Incluye esta idea de fondo de forma natural: {plan['disclaimer']}\n"
    )


def serialize_asset(asset: dict[str, Any] | None) -> str:
    if not asset:
        return "Sin activo relacionado."

    return "\n".join(
        [
            f"Nombre: {asset.get('name') or asset.get('symbol')}",
            f"Ticker: {asset.get('symbol') or 'No disponible'}",
            f"Tipo: {asset.get('quote_type_label') or asset.get('quote_type') or 'Activo'}",
            f"Precio: {format_price_label(asset.get('price'), asset.get('currency'))}",
            f"Cambio diario: {format_percentage_label(asset.get('change_percent'))}",
            f"52 semanas: {format_price_label(asset.get('fifty_two_week_low'), asset.get('currency'))} - {format_price_label(asset.get('fifty_two_week_high'), asset.get('currency'))}",
            f"Mercado: {asset.get('exchange') or 'No disponible'}",
        ]
    )


def serialize_chart(chart: dict[str, Any] | None) -> str:
    if not chart:
        return "Sin gráfica disponible."

    summary = chart.get("summary") or {}
    return "\n".join(
        [
            f"Ticker: {chart.get('symbol')}",
            f"Rango: {chart.get('range')}",
            f"Precio inicial: {summary.get('start')}",
            f"Precio final: {summary.get('end')}",
            f"Variación: {summary.get('change_percent')}%",
            f"Máximo: {summary.get('high')}",
            f"Mínimo: {summary.get('low')}",
            f"Volatilidad aprox.: {summary.get('volatility')}",
        ]
    )


def serialize_outlook(outlook: dict[str, Any] | None) -> str:
    if not outlook:
        return "Sin lectura adicional."

    return "\n".join(
        [
            f"Sesgo: {outlook.get('label')}",
            f"Riesgo: {outlook.get('risk_level')}",
            "Motivos:",
            serialize_lines(outlook.get("reasons") or []),
            f"Nota: {outlook.get('disclaimer')}",
        ]
    )


def serialize_articles(articles: list[dict[str, Any]]) -> str:
    if not articles:
        return "No hay noticias disponibles."

    blocks = []
    for index, article in enumerate(articles, start=1):
        blocks.append(
            "\n".join(
                [
                    f"Noticia {index}",
                    f"Titular: {article.get('title') or 'Sin titular'}",
                    f"Fuente: {article.get('source') or 'Fuente no indicada'}",
                    f"Fecha: {article.get('published_at') or 'No disponible'}",
                    f"Extracto: {article.get('description') or 'Sin extracto disponible'}",
                ]
            )
        )

    return "\n\n".join(blocks)


def serialize_lines(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items)


def build_article_channels(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    channels = []

    for article in articles:
        channels.append(
            {
                "eyebrow": article.get("source") or "Mercado",
                "title": article.get("title") or "Noticia financiera",
                "body": article.get("description") or "Sin extracto disponible.",
                "imageUrl": article.get("image_url") or "",
                "linkUrl": article.get("url") or "",
                "linkLabel": "Abrir fuente",
            }
        )

    return channels


def build_asset_channel(*, asset: dict[str, Any], chart: dict[str, Any] | None, body: str) -> dict[str, Any]:
    return {
        "eyebrow": f"{asset.get('quote_type_label') or 'Activo'} | {asset.get('exchange') or 'Mercado'}",
        "title": f"{asset.get('symbol')} | {asset.get('name') or asset.get('symbol')}",
        "body": body,
        "linkUrl": asset.get("asset_link") or "",
        "linkLabel": "Ver activo",
        "asset": asset,
        "chart": chart,
    }


def build_asset_snapshot_body(asset: dict[str, Any], chart: dict[str, Any] | None) -> str:
    body_lines = [
        f"**Precio:** {format_price_label(asset.get('price'), asset.get('currency'))}",
        f"**Cambio diario:** {format_percentage_label(asset.get('change_percent'))}",
        f"**Rango 52 semanas:** {format_price_label(asset.get('fifty_two_week_low'), asset.get('currency'))} - {format_price_label(asset.get('fifty_two_week_high'), asset.get('currency'))}",
    ]

    if chart and chart.get("summary"):
        body_lines.append(
            f"**Tendencia {chart.get('range')}:** {format_percentage_label(chart['summary'].get('change_percent'))}"
        )

    body_lines.append("Toda lectura de mercado es probabilistica y conviene contrastarla con tu perfil.")
    return "\n\n".join(body_lines)


def build_asset_outlook_body(asset: dict[str, Any], chart: dict[str, Any] | None, outlook: dict[str, Any]) -> str:
    body_lines = [
        f"**Precio:** {format_price_label(asset.get('price'), asset.get('currency'))}",
        f"**Cambio diario:** {format_percentage_label(asset.get('change_percent'))}",
        f"**Lectura:** {outlook.get('label') or 'Sin lectura concluyente'}",
    ]

    if chart and chart.get("summary"):
        body_lines.append(
            f"**Tendencia {chart.get('range')}:** {format_percentage_label(chart['summary'].get('change_percent'))}"
        )

    reasons = outlook.get("reasons") or []
    if reasons:
        body_lines.append("**Claves:**\n" + "\n".join(f"- {reason}" for reason in reasons))

    body_lines.append(outlook.get("disclaimer") or "No hay garantías de movimiento.")
    return "\n\n".join(body_lines)


def build_plan_channel_body(plan: dict[str, Any]) -> str:
    allocation_lines = [
        f"- {item['percentage']}% {item['label']}" for item in plan.get("allocation") or []
    ]

    body_lines = [
        f"**Perfil:** {plan.get('risk_profile')}",
        f"**Horizonte:** {plan.get('horizon')}",
        f"**Foco:** {plan.get('focus')}",
        "**Asignacion:**\n" + "\n".join(allocation_lines),
        plan.get("disclaimer") or "",
    ]

    return "\n\n".join(line for line in body_lines if line)


async def _return_none():
    return None
