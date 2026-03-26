from app.backend.Bots.Prompts import SYSTEM_PROMPT
from app.backend.Bots.chat import ask_groq
from app.backend.services.news_service import search_news

MAX_HISTORY_ITEMS = 8


async def handle_chat(user_message, history=None):
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *build_history_messages(history),
        {"role": "user", "content": user_message},
    ]

    bot_reply = ask_groq(messages, temperature=0.6)
    return {"bot_message": bot_reply}


async def handle_news_request(user_message, history=None, decision=None):
    decision = decision or {}
    search_query = decision.get("query")
    wants_image_gallery = bool(decision.get("needs_images"))
    include_images = True
    response_style = decision.get("response_style") or "summary"

    articles = await search_news(
        query=search_query,
        limit=6,
        include_images=include_images,
    )

    if not articles:
        return {
            "bot_message": (
                "No he encontrado resultados fiables sobre ese tema ahora mismo. "
                "Prueba con una consulta más concreta o con otra categoría."
            ),
            "articles": [],
            "photos": [],
            "topic": search_query or "actualidad general",
        }

    summary_request = build_summary_request(
        user_message=user_message,
        search_query=search_query or "actualidad general",
        response_style=response_style,
        include_images=wants_image_gallery,
        articles=articles,
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *build_history_messages(history),
        {"role": "user", "content": summary_request},
    ]

    bot_reply = ask_groq(messages, temperature=0.35)
    photos = [article["image_url"] for article in articles if article.get("image_url")]

    return {
        "bot_message": bot_reply,
        "articles": articles,
        "photos": photos[:8],
        "topic": search_query or "actualidad general",
    }


async def handle_live_feed_request():
    articles = await search_news(
        query=None,
        limit=12,
        include_images=True,
    )

    return {
        "articles": articles,
        "topic": "actualidad general",
    }


def build_history_messages(history):
    messages = []

    for item in (history or [])[-MAX_HISTORY_ITEMS:]:
        role = "assistant" if item.get("role") == "assistant" else "user"
        content = (item.get("content") or "").strip()

        if not content:
            continue

        messages.append({"role": role, "content": content[:1600]})

    return messages


def build_summary_request(user_message, search_query, response_style, include_images, articles):
    formatted_articles = []

    for index, article in enumerate(articles, start=1):
        formatted_articles.append(
            "\n".join(
                [
                    f"Artículo {index}",
                    f"Titular: {article['title']}",
                    f"Fuente: {article.get('source') or 'Fuente no indicada'}",
                    f"Fecha: {article.get('published_at') or 'No disponible'}",
                    f"Extracto: {article.get('description') or 'Sin extracto disponible.'}",
                    f"URL: {article.get('url') or 'No disponible'}",
                ]
            )
        )

    image_instruction = (
        "El usuario ha pedido imágenes: menciona brevemente que se muestran en pantalla cuando existan."
        if include_images
        else "No hace falta insistir en las imágenes si no aportan valor."
    )

    return (
        f"Consulta del usuario: {user_message}\n"
        f"Consulta de búsqueda usada: {search_query}\n"
        f"Estilo deseado: {response_style}\n\n"
        "Artículos disponibles:\n"
        f"{chr(10).join(formatted_articles)}\n\n"
        "Instrucciones:\n"
        "- Responde en español.\n"
        "- Actúa como un presentador de informativos moderno y profesional.\n"
        "- Resume sin sonar robótico.\n"
        "- Usa titulares claros y después puntos clave cuando tenga sentido.\n"
        "- Si las fuentes parecen complementarias, intégralas en una sola lectura.\n"
        "- Si falta algún dato importante, dilo sin inventar.\n"
        "- No enumeres URLs en el texto principal.\n"
        f"- {image_instruction}\n"
    )
