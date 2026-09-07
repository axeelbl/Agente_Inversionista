import csv
import json
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import INVESTMENT_PLANS_FILE, LEADS_FILE


_CSV_LOCK = threading.Lock()
_DANGEROUS_CSV_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def save_lead(user_message, bot_message, meta):
    _append_csv_row(
        LEADS_FILE,
        [
            "timestamp",
            "ip",
            "user_agent",
            "language",
            "referer",
            "response_time",
            "user_message",
            "bot_message",
            "action",
        ],
        [
            datetime.now().isoformat(),
            meta.get("ip", ""),
            meta.get("user_agent", ""),
            meta.get("language", ""),
            meta.get("referer", ""),
            meta.get("response_time", ""),
            user_message,
            bot_message,
            meta.get("action", "CHAT"),
        ],
    )


def save_investment_plan_lead(payload: dict[str, Any], meta: dict[str, Any]):
    _append_csv_row(
        INVESTMENT_PLANS_FILE,
        [
            "timestamp",
            "name",
            "email",
            "consent",
            "risk_profile",
            "monthly_contribution",
            "initial_capital",
            "horizon_years",
            "total_weight",
            "allocations_json",
            "scenario_rates_json",
            "notes",
            "ip",
            "user_agent",
            "language",
            "referer",
        ],
        [
            datetime.now().isoformat(),
            payload.get("name", ""),
            payload.get("email", ""),
            "yes" if payload.get("consent") else "no",
            payload.get("risk_profile", ""),
            payload.get("monthly_contribution", ""),
            payload.get("initial_capital", ""),
            payload.get("horizon_years", ""),
            payload.get("total_weight", ""),
            json.dumps(payload.get("allocations", []), ensure_ascii=True),
            json.dumps(payload.get("scenario_rates", {}), ensure_ascii=True),
            payload.get("notes", ""),
            meta.get("ip", ""),
            meta.get("user_agent", ""),
            meta.get("language", ""),
            meta.get("referer", ""),
        ],
    )


def get_last_modified(file_path: str):
    if os.path.exists(file_path):
        return os.path.getmtime(file_path)
    return 0


def _append_csv_row(file_path: str, headers: list[str], row: list[Any]):
    path = Path(file_path)
    sanitized_row = [_safe_csv_cell(value) for value in row]

    with _CSV_LOCK:
        file_exists = path.is_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", newline="", encoding="utf-8") as file_handle:
            writer = csv.writer(file_handle)

            if not file_exists:
                writer.writerow(headers)

            writer.writerow(sanitized_row)


def _safe_csv_cell(value: Any) -> str:
    text = str(value)
    return f"'{text}" if text.startswith(_DANGEROUS_CSV_PREFIXES) else text
