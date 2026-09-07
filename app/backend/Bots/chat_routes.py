import asyncio
import time
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field

from app.backend.Bots.chat import decide_investment_action
from app.backend.core.security import limiter
from app.backend.csv_utils import save_investment_plan_lead, save_lead
from app.backend.email_utils import send_csv_email, send_investment_plan_emails
from app.backend.services.chat_service import (
    handle_chat,
    handle_live_feed_request,
    handle_market_request,
)
from app.backend.services.market_service import get_asset_chart, get_asset_quote, search_assets

router = APIRouter()


class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=500)


class MessageRequest(BaseModel):
    user_message: str = Field(min_length=1, max_length=500)
    history: list[HistoryItem] = Field(default_factory=list, max_length=8)


class AllocationItem(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=32)
    name: str = Field(default="", max_length=120)
    type: str = Field(default="", max_length=40)
    weight_percent: float = Field(ge=0, le=100)
    monthly_amount: float = Field(ge=0, le=1_000_000_000)
    initial_amount: float = Field(ge=0, le=1_000_000_000)


class InvestmentPlanLeadRequest(BaseModel):
    name: str = Field(default="", max_length=120)
    email: EmailStr
    consent: bool
    risk_profile: str = Field(default="", max_length=40)
    monthly_contribution: float = Field(default=0, ge=0, le=1_000_000_000)
    initial_capital: float = Field(default=0, ge=0, le=1_000_000_000)
    horizon_years: float = Field(default=0, ge=0, le=100)
    total_weight: float = Field(default=0, ge=0, le=100)
    scenario_rates: dict[str, float] = Field(default_factory=dict, max_length=10)
    allocations: list[AllocationItem] = Field(default_factory=list, max_length=50)
    notes: str = Field(default="", max_length=500)


@router.post("/chat")
@limiter.limit("20/minute")
async def chat_endpoint(msg: MessageRequest, request: Request):
    user_message = msg.user_message.strip()
    history = [item.model_dump() for item in msg.history][-8:]

    start_time = time.time()
    decision = await asyncio.to_thread(decide_investment_action, user_message, history)

    def record_lead(bot_reply: str):
        meta = {
            "ip": request.client.host if request.client else "",
            "user_agent": request.headers.get("user-agent", ""),
            "language": request.headers.get("accept-language", ""),
            "referer": request.headers.get("referer", ""),
            "response_time": round(time.time() - start_time, 2),
            "action": decision.get("action", "CHAT"),
        }
        save_lead(user_message, bot_reply, meta)
        try:
            send_csv_email()
        except Exception as exc:
            print("Error enviando CSV:", exc)

    try:
        if decision.get("action") == "CHAT":
            response = await handle_chat(user_message, history)
        else:
            response = await handle_market_request(user_message, history, decision)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail="El servicio de análisis no está configurado.",
        ) from exc

    record_lead(response["bot_message"])
    return response


@router.get("/live-feed")
@limiter.limit("30/minute")
async def live_feed_endpoint(request: Request):
    return await handle_live_feed_request()


@router.get("/asset-chart")
@limiter.limit("60/minute")
async def asset_chart_endpoint(
    request: Request,
    ticker: str = Query(..., min_length=1, max_length=32),
    range_key: str = Query("1M", alias="range"),
):
    chart = await get_asset_chart(ticker, range_key)
    if not chart:
        raise HTTPException(status_code=404, detail="No chart data available")
    return chart


@router.get("/asset-search")
@limiter.limit("60/minute")
async def asset_search_endpoint(
    request: Request,
    q: str = Query(..., min_length=1, max_length=80),
):
    return {
        "items": await search_assets(q, limit=6),
    }


@router.get("/asset-quote")
@limiter.limit("60/minute")
async def asset_quote_endpoint(
    request: Request,
    ticker: str = Query(..., min_length=1, max_length=80),
):
    quote = await get_asset_quote(ticker)
    if not quote:
        raise HTTPException(status_code=404, detail="No quote data available")
    return quote


@router.post("/investment-plan-lead")
@limiter.limit("12/minute")
async def investment_plan_lead_endpoint(payload: InvestmentPlanLeadRequest, request: Request):
    if not payload.consent:
        raise HTTPException(
            status_code=400,
            detail="Es necesario el consentimiento del usuario antes de enviar el plan de inversión.",
        )

    if not payload.allocations:
        raise HTTPException(
            status_code=400,
            detail="Hace falta al menos una asignación antes de enviar el plan de inversión.",
        )

    meta = {
        "ip": request.client.host if request.client else "",
        "user_agent": request.headers.get("user-agent", ""),
        "language": request.headers.get("accept-language", ""),
        "referer": request.headers.get("referer", ""),
    }

    save_investment_plan_lead(payload.model_dump(), meta)

    try:
        send_investment_plan_emails(payload.model_dump())
    except Exception as exc:
        print("Error enviando emails del plan:", exc)

    try:
        send_csv_email()
    except Exception as exc:
        print("Error enviando CSV de planes:", exc)

    return {"ok": True}
