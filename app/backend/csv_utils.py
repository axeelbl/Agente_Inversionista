# Guardar leads, leer CSV, comprobar cambios

import csv, os
from datetime import datetime
from .config import LEADS_FILE

def save_lead(user_message, bot_message, meta):
    file_exists = os.path.isfile(LEADS_FILE)

    with open(LEADS_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)

        if not file_exists:
            writer.writerow([
                "timestamp", "ip", "user_agent",
                "language", "referer", "response_time",
                "user_message", "bot_message"
            ])

        writer.writerow([
            datetime.now().isoformat(),
            meta["ip"], meta["user_agent"],
            meta["language"], meta["referer"],
            meta["response_time"], user_message, bot_message
        ])

def get_last_modified():
    if os.path.exists(LEADS_FILE):
        return os.path.getmtime(LEADS_FILE)
    return 0
