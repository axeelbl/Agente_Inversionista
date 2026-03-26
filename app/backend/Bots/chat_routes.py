import time
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.backend.Bots.chat import decide_news_action
from app.backend.core.security import limiter
from app.backend.csv_utils import save_lead
from app.backend.email_utils import send_csv_email
from app.backend.services.chat_service import handle_chat, handle_live_feed_request, handle_news_request

router = APIRouter()


class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class MessageRequest(BaseModel):
    user_message: str
    history: list[HistoryItem] = Field(default_factory=list)


@router.post("/chat")
@limiter.limit("20/minute")
async def chat_endpoint(msg: MessageRequest, request: Request):
    user_message = msg.user_message.strip()
    history = [item.model_dump() for item in msg.history][-8:]

    if len(user_message) > 500:
        return {"bot_message": "Mensaje demasiado largo."}

    start_time = time.time()
    decision = decide_news_action(user_message, history)

    def record_lead(bot_reply: str):
        meta = {
            "ip": request.client.host if request.client else "",
            "user_agent": request.headers.get("user-agent", ""),
            "language": request.headers.get("accept-language", ""),
            "referer": request.headers.get("referer", ""),
            "response_time": round(time.time() - start_time, 2),
        }
        save_lead(user_message, bot_reply, meta)
        try:
            send_csv_email()
        except Exception as exc:
            print("Error enviando CSV:", exc)

    if decision.get("action") == "SEARCH_NEWS":
        response = await handle_news_request(user_message, history, decision)
    else:
        response = await handle_chat(user_message, history)

    record_lead(response["bot_message"])
    return response


@router.get("/live-feed")
@limiter.limit("30/minute")
async def live_feed_endpoint(request: Request):
    return await handle_live_feed_request()
