"""Outbound email through Azure Communication Services.

Raises rather than quietly succeeding when unconfigured — a flow that reports success while
sending nothing looks identical to a broken inbox. The Azure SDK is synchronous, so sends run
in a worker thread.
"""

from __future__ import annotations

import logging

from fastapi.concurrency import run_in_threadpool

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class EmailNotConfigured(Exception):
    """No ACS connection string or sender address is set."""


class EmailSendFailed(Exception):
    """The provider accepted the request and then failed, or rejected it outright."""


def is_configured() -> bool:
    settings = get_settings()
    return bool(settings.ACS_CONNECTION_STRING and settings.ACS_SENDER_ADDRESS)


def _send_blocking(to: str, subject: str, html: str, text: str) -> str:
    from azure.communication.email import EmailClient

    settings = get_settings()
    client = EmailClient.from_connection_string(settings.ACS_CONNECTION_STRING)

    message = {
        "senderAddress": settings.ACS_SENDER_ADDRESS,
        "recipients": {"to": [{"address": to}]},
        "content": {"subject": subject, "plainText": text, "html": html},
    }

    poller = client.begin_send(message)
    result = poller.result()
    return str(result.get("id", "")) if isinstance(result, dict) else str(result)


async def send(to: str, subject: str, html: str, text: str) -> None:
    if not is_configured():
        raise EmailNotConfigured(
            "Email is not configured. Set ACS_CONNECTION_STRING and ACS_SENDER_ADDRESS."
        )

    try:
        message_id = await run_in_threadpool(_send_blocking, to, subject, html, text)
    except ImportError as e:
        raise EmailNotConfigured(
            "azure-communication-email is not installed. Reinstall requirements.txt."
        ) from e
    except Exception as e:
        # The address itself is deliberately not logged at error level alongside the failure
        # reason — logs get shared, and this pairs an address with a failed delivery.
        logger.error("email send failed (subject=%r): %s", subject, e)
        raise EmailSendFailed("Could not send the email. Please try again shortly.") from e

    logger.info("email sent (subject=%r, id=%s)", subject, message_id)


# ─── Templates ───
#
# Inline styles only, and a plain-text copy of every message. Mail clients strip <style>
# blocks, and some people read plain text by choice.

_WRAP = (
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;'
    'margin:0 auto;padding:24px;color:#1a1a1a">'
    '<h2 style="font-size:20px;font-weight:500;margin:0 0 16px">{heading}</h2>'
    '<p style="font-size:15px;line-height:1.6;margin:0 0 20px">{body}</p>'
    '<p style="margin:0 0 24px"><a href="{link}" style="display:inline-block;'
    'background:#1d9e75;color:#fff;text-decoration:none;padding:11px 20px;'
    'border-radius:6px;font-size:15px">{cta}</a></p>'
    '<p style="font-size:13px;color:#666;line-height:1.6;margin:0 0 8px">'
    "Or paste this into your browser:<br>{link}</p>"
    '<p style="font-size:13px;color:#666;line-height:1.6;margin:0">{footer}</p>'
    "</div>"
)


def verification_email(username: str, link: str, hours: int) -> tuple[str, str, str]:
    subject = "Confirm your ImageShrink email"
    html = _WRAP.format(
        heading=f"Welcome, {username}",
        body="Confirm this address to finish setting up your ImageShrink account.",
        link=link,
        cta="Confirm my email",
        footer=(
            f"This link works for {hours} hours. "
            "If you did not create this account you can ignore this email."
        ),
    )
    text = (
        f"Welcome, {username}\n\n"
        "Confirm your email address to finish setting up your ImageShrink account:\n\n"
        f"{link}\n\n"
        f"This link works for {hours} hours. If you did not create this account, ignore this "
        "email.\n"
    )
    return subject, html, text


def password_reset_email(username: str, link: str, minutes: int) -> tuple[str, str, str]:
    subject = "Reset your ImageShrink password"
    html = _WRAP.format(
        heading="Reset your password",
        body=f"Someone asked to reset the password for <strong>{username}</strong>.",
        link=link,
        cta="Choose a new password",
        footer=(
            f"This link works for {minutes} minutes and can only be used once. "
            "If this was not you, nothing has changed and you can ignore this email."
        ),
    )
    text = (
        "Reset your password\n\n"
        f"Someone asked to reset the password for {username}. Use this link:\n\n"
        f"{link}\n\n"
        f"It works for {minutes} minutes and only once. If this was not you, nothing has "
        "changed and you can ignore this email.\n"
    )
    return subject, html, text
