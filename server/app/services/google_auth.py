"""Verifying the ID token the browser gets from Google Sign-In.

Signature, audience, issuer and expiry are all checked before any claim is believed. Getting
one of those wrong turns "sign in with Google" into "sign in as anybody", so the checks are
delegated to google-auth rather than hand-rolled. No client secret is involved.
"""

from __future__ import annotations

import logging

from fastapi.concurrency import run_in_threadpool

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_ISSUERS = ("accounts.google.com", "https://accounts.google.com")


class GoogleAuthUnavailable(Exception):
    """GOOGLE_CLIENT_ID is not configured, or the library is missing."""


class GoogleAuthInvalid(Exception):
    """The credential was not a valid ID token for this application."""


def is_configured() -> bool:
    return bool(get_settings().GOOGLE_CLIENT_ID)


def _verify_blocking(credential: str, client_id: str) -> dict:
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    # Checks signature, audience, issuer and expiry, and fetches Google's signing keys
    # (cached between calls).
    return id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)


async def verify(credential: str) -> dict:
    """Return {email, email_verified, name, picture, sub} from a valid Google ID token."""
    settings = get_settings()
    if not settings.GOOGLE_CLIENT_ID:
        raise GoogleAuthUnavailable("Google sign-in is not configured on this server")
    if not credential:
        raise GoogleAuthInvalid("No Google credential was supplied")

    try:
        claims = await run_in_threadpool(
            _verify_blocking, credential, settings.GOOGLE_CLIENT_ID
        )
    except ImportError as e:
        raise GoogleAuthUnavailable(
            "google-auth is not installed. Reinstall requirements.txt."
        ) from e
    except ValueError as e:
        # google-auth raises ValueError for every rejection: bad signature, wrong audience,
        # expired. The reason is logged but not returned — it is not the user's problem, and a
        # detailed rejection message helps someone probing the endpoint.
        logger.info("google sign-in rejected: %s", e)
        raise GoogleAuthInvalid("That Google sign-in could not be verified") from e

    if claims.get("iss") not in _ISSUERS:
        raise GoogleAuthInvalid("That Google sign-in could not be verified")

    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise GoogleAuthInvalid("That Google account has no email address")

    # Google tells us whether it has verified the address itself. An unverified Google account
    # is not proof of ownership, so we refuse rather than trusting it and skipping our own
    # verification step.
    if not claims.get("email_verified"):
        raise GoogleAuthInvalid(
            "That Google account's email is not verified with Google"
        )

    return {
        "sub": claims.get("sub", ""),
        "email": email,
        "email_verified": True,
        "name": (claims.get("name") or "").strip(),
        "picture": (claims.get("picture") or "").strip() or None,
    }
