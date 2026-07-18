import base64
import html
import os

import httpx

from .config import (
    INVESTMENT_PLANS_FILE,
    LEADS_FILE,
    RESEND_API_KEY,
    RESEND_FROM,
    RESEND_TO,
)
from .csv_utils import get_last_modified

LAST_SENT_BY_FILE = {}

RESEND_EMAILS_URL = "https://api.resend.com/emails"


def _parse_recipients(recipients):
    if not recipients:
        return []
    return [email.strip() for email in recipients.split(",") if email.strip()]


def can_send_email():
    return bool(RESEND_API_KEY and RESEND_FROM and RESEND_TO)


def _post_resend(payload):
    response = httpx.post(
        RESEND_EMAILS_URL,
        headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
        json=payload,
        timeout=30,
    )
    if response.is_error:
        print("Error de Resend:", response.status_code, response.text)
        response.raise_for_status()
    return response


def send_csv_email():
    if not can_send_email():
        print("Falta configuracion de Resend, no se envia email")
        return

    attachment_sources = [(LEADS_FILE, "leads.csv"), (INVESTMENT_PLANS_FILE, "investment_plans.csv")]

    changed_sources = []
    for file_path, attachment_name in attachment_sources:
        if not os.path.exists(file_path):
            continue
        mtime = get_last_modified(file_path)
        if mtime > LAST_SENT_BY_FILE.get(file_path, 0):
            changed_sources.append((file_path, attachment_name, mtime))

    if not changed_sources:
        return

    attachments = []
    for file_path, attachment_name, _mtime in changed_sources:
        with open(file_path, "rb") as file_handle:
            encoded_file = base64.b64encode(file_handle.read()).decode()
        attachments.append({"filename": attachment_name, "content": encoded_file})

    payload = {
        "from": RESEND_FROM,
        "to": _parse_recipients(RESEND_TO),
        "subject": 'AI Inversionista - Nuevos registros',
        "text": 'Hay nuevos registros de chat y/o planes de inversion enviados desde la app.',
        "attachments": attachments,
    }
    response = _post_resend(payload)
    print("CSV enviado, status:", response.status_code)

    for file_path, _attachment_name, mtime in changed_sources:
        LAST_SENT_BY_FILE[file_path] = mtime


def send_investment_plan_emails(payload: dict):
    user_email = (payload.get("email") or "").strip()
    if not user_email:
        return

    _post_resend({
        "from": RESEND_FROM,
        "to": [user_email],
        "subject": "Tu plan de inversion IA",
        "text": build_plan_plain_text(payload),
        "html": build_plan_html(payload, audience="user"),
    })
    _post_resend({
        "from": RESEND_FROM,
        "to": _parse_recipients(RESEND_TO),
        "subject": f"Nuevo plan de inversion enviado por {user_email}",
        "text": build_plan_plain_text(payload, include_admin_note=True),
        "html": build_plan_html(payload, audience="admin"),
    })


def build_plan_html(payload: dict, audience: str = "user") -> str:
    allocations_rows = "".join(
        [
            (
                "<tr>"
                f"<td style=\"padding:12px 14px;border-bottom:1px solid #d8e4dd;\">{escape(item.get('symbol'))}</td>"
                f"<td style=\"padding:12px 14px;border-bottom:1px solid #d8e4dd;\">{escape(item.get('name'))}</td>"
                f"<td style=\"padding:12px 14px;border-bottom:1px solid #d8e4dd;\">{escape(item.get('type'))}</td>"
                f"<td style=\"padding:12px 14px;border-bottom:1px solid #d8e4dd;\">{format_number(item.get('weight_percent'))}%</td>"
                f"<td style=\"padding:12px 14px;border-bottom:1px solid #d8e4dd;\">{format_eur(item.get('monthly_amount'))}</td>"
                f"<td style=\"padding:12px 14px;border-bottom:1px solid #d8e4dd;\">{format_eur(item.get('initial_amount'))}</td>"
                "</tr>"
            )
            for item in (payload.get("allocations") or [])
        ]
    )

    scenario_rows = "".join(
        [
            (
                "<tr>"
                f"<td style=\"padding:10px 14px;border-bottom:1px solid #d8e4dd;\">{escape(label_from_key(key))}</td>"
                f"<td style=\"padding:10px 14px;border-bottom:1px solid #d8e4dd;\">{format_number(value)}%</td>"
                "</tr>"
            )
            for key, value in (payload.get("scenario_rates") or {}).items()
        ]
    )

    intro = (
        "Aquí tienes tu plan orientativo generado desde AI Inversionista."
        if audience == "user"
        else "Se ha enviado un nuevo plan de inversión desde AI Inversionista."
    )

    admin_notice = (
        ""
        if audience == "user"
        else (
            "<p style=\"margin:16px 0 0;color:#4a5f55;font-size:13px;line-height:1.6;\">"
            "Este correo es una copia de seguimiento enviada al buzón de administración."
            "</p>"
        )
    )

    return f"""
    <div style="margin:0;padding:24px;background:#f2f7f4;font-family:Arial,sans-serif;color:#11231a;">
        <div style="max-width:820px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #d8e4dd;">
            <div style="padding:28px 32px;background:linear-gradient(135deg,#0d2419,#1f5f41);color:#f4fff9;">
                <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.78;">AI Inversionista</div>
                <h1 style="margin:12px 0 8px;font-size:30px;line-height:1.05;">Plan de inversión</h1>
                <p style="margin:0;font-size:15px;line-height:1.7;color:#d7f6e7;">{escape(intro)}</p>
            </div>

            <div style="padding:28px 32px;">
                <div style="display:block;margin-bottom:24px;padding:18px;border-radius:18px;background:#f6fbf8;border:1px solid #d8e4dd;">
                    <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#4a5f55;">Resumen</p>
                    <h2 style="margin:0 0 10px;font-size:24px;line-height:1.1;color:#11231a;">{escape(payload.get('risk_profile') or 'Plan orientativo')}</h2>
                    <p style="margin:0;color:#4a5f55;line-height:1.7;">
                        Aportación mensual: <strong>{format_eur(payload.get('monthly_contribution'))}</strong> |
                        Capital inicial: <strong>{format_eur(payload.get('initial_capital'))}</strong> |
                        Horizonte: <strong>{format_number(payload.get('horizon_years'))} años</strong>
                    </p>
                </div>

                <div style="margin-bottom:24px;">
                    <h3 style="margin:0 0 12px;font-size:18px;color:#11231a;">Asignación objetivo</h3>
                    <div style="overflow:hidden;border-radius:18px;border:1px solid #d8e4dd;">
                        <table style="width:100%;border-collapse:collapse;background:#ffffff;">
                            <thead style="background:#eff7f2;color:#4a5f55;">
                                <tr>
                                    <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Ticker</th>
                                    <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Activo</th>
                                    <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Tipo</th>
                                    <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Peso</th>
                                    <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Mensual</th>
                                    <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Inicial</th>
                                </tr>
                            </thead>
                            <tbody>{allocations_rows}</tbody>
                        </table>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px;">
                    <div style="padding:18px;border-radius:18px;background:#f6fbf8;border:1px solid #d8e4dd;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#4a5f55;">Peso total</p>
                        <strong style="font-size:24px;color:#11231a;">{format_number(payload.get('total_weight'))}%</strong>
                    </div>
                    <div style="padding:18px;border-radius:18px;background:#f6fbf8;border:1px solid #d8e4dd;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#4a5f55;">Correo</p>
                        <strong style="font-size:18px;color:#11231a;">{escape(payload.get('email'))}</strong>
                    </div>
                </div>

                <div style="margin-bottom:24px;">
                    <h3 style="margin:0 0 12px;font-size:18px;color:#11231a;">Escenarios orientativos</h3>
                    <div style="overflow:hidden;border-radius:18px;border:1px solid #d8e4dd;">
                        <table style="width:100%;border-collapse:collapse;background:#ffffff;">
                            <thead style="background:#eff7f2;color:#4a5f55;">
                                <tr>
                                    <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Escenario</th>
                                    <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Tasa anual</th>
                                </tr>
                            </thead>
                            <tbody>{scenario_rows}</tbody>
                        </table>
                    </div>
                </div>

                <div style="padding:18px;border-radius:18px;background:#fff8ea;border:1px solid #f0d89d;">
                    <strong style="display:block;margin-bottom:8px;color:#4f3d0b;">Nota importante</strong>
                    <p style="margin:0;color:#6b5a28;line-height:1.7;">
                        Este contenido es orientativo, no constituye asesoramiento financiero profesional y no garantiza resultados.
                        Toda inversión implica riesgo y conviene contrastar cualquier decisión con tu perfil y horizonte temporal.
                    </p>
                </div>
                {admin_notice}
            </div>
        </div>
    </div>
    """


def build_plan_plain_text(payload: dict, include_admin_note: bool = False) -> str:
    lines = [
        "Plan de inversión - AI Inversionista",
        "",
        f"Perfil: {payload.get('risk_profile') or 'No indicado'}",
        f"Aportación mensual: {format_eur(payload.get('monthly_contribution'))}",
        f"Capital inicial: {format_eur(payload.get('initial_capital'))}",
        f"Horizonte: {format_number(payload.get('horizon_years'))} años",
        f"Peso total: {format_number(payload.get('total_weight'))}%",
        "",
        "Asignación objetivo:",
    ]

    for item in payload.get("allocations") or []:
        lines.append(
            (
                f"- {item.get('symbol')}: {item.get('name')} | {item.get('type')} | "
                f"{format_number(item.get('weight_percent'))}% | "
                f"Mensual {format_eur(item.get('monthly_amount'))} | "
                f"Inicial {format_eur(item.get('initial_amount'))}"
            )
        )

    lines.extend(["", "Escenarios orientativos:"])
    for key, value in (payload.get("scenario_rates") or {}).items():
        lines.append(f"- {label_from_key(key)}: {format_number(value)}%")

    lines.extend(
        [
            "",
            "Nota importante: este contenido es orientativo y no constituye asesoramiento financiero profesional.",
            "Toda inversión implica riesgo.",
        ]
    )

    if include_admin_note:
        lines.extend(["", "Copia enviada al buzón de seguimiento."])

    return "\n".join(lines)


def escape(value) -> str:
    return html.escape(str(value or ""))


def format_eur(value) -> str:
    try:
        numeric = float(value or 0)
    except (TypeError, ValueError):
        numeric = 0.0
    return f"{numeric:,.2f} EUR".replace(",", "_").replace(".", ",").replace("_", ".")


def format_number(value) -> str:
    try:
        numeric = float(value or 0)
    except (TypeError, ValueError):
        numeric = 0.0

    if numeric.is_integer():
        return str(int(numeric))
    return f"{numeric:.2f}".replace(".", ",")


def label_from_key(key: str) -> str:
    labels = {
        "prudente": "Escenario prudente",
        "base": "Escenario base",
        "dinamico": "Escenario dinámico",
    }
    return labels.get(key, key)
