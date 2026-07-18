# Variables globales, carga de .env y constantes

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(override=True)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
SENDGRID_FROM = os.getenv("SENDGRID_FROM")
SENDGRID_TO = os.getenv("SENDGRID_TO")
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
RESEND_FROM = os.getenv("RESEND_FROM") or os.getenv("SENDGRID_FROM")
RESEND_TO = os.getenv("RESEND_TO") or os.getenv("SENDGRID_TO")
NEWSAPI_API_KEY = os.getenv("NEWSAPI_API_KEY")
NEWS_LANGUAGE = os.getenv("NEWS_LANGUAGE", "es")
NEWS_COUNTRY = os.getenv("NEWS_COUNTRY", "ES")
LEADS_FILE = str(BASE_DIR / "leads.csv")
INVESTMENT_PLANS_FILE = str(BASE_DIR / "investment_plans.csv")
