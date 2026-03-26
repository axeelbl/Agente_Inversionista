import base64
import os

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import (
    Attachment,
    Disposition,
    FileContent,
    FileName,
    FileType,
    Mail,
)

from .config import LEADS_FILE, SENDGRID_API_KEY, SENDGRID_FROM, SENDGRID_TO
from .csv_utils import get_last_modified

LAST_SENT = 0


def send_csv_email():
    global LAST_SENT

    if not os.path.exists(LEADS_FILE):
        return

    mtime = get_last_modified()
    if mtime <= LAST_SENT:
        print("No hay leads nuevos, no se envía email")
        return

    try:
        with open(LEADS_FILE, "rb") as file_handle:
            encoded_file = base64.b64encode(file_handle.read()).decode()

        attachment = Attachment(
            file_content=FileContent(encoded_file),
            file_type=FileType("text/csv"),
            file_name=FileName("leads.csv"),
            disposition=Disposition("attachment"),
        )

        message = Mail(
            from_email=SENDGRID_FROM,
            to_emails=SENDGRID_TO,
            subject="AI News Anchor - Leads nuevos",
            plain_text_content="Hay nuevos leads desde el último envío.",
        )
        message.attachment = attachment

        client = SendGridAPIClient(SENDGRID_API_KEY)
        response = client.send(message)
        print("CSV enviado, status:", response.status_code)

        LAST_SENT = mtime
    except Exception as exc:
        print("Error enviando CSV:", exc)
