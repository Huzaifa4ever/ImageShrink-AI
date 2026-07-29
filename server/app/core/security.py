

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_TOKEN_BYTES = 32

MAX_PASSWORD_BYTES = 72
MIN_PASSWORD_LENGTH = 8

_ephemeral_secret: str | None = None


class InvalidToken(Exception):
    """Raised when a token is missing, malformed, expired or signed with another key."""


def _secret() -> str:
    global _ephemeral_secret

    configured = get_settings().JWT_SECRET
    if configured:
        return configured

    if _ephemeral_secret is None:
        _ephemeral_secret = secrets.token_urlsafe(48)
        logger.warning(
            "JWT_SECRET is not set - using a random per-process secret. Every restart "
            "will log all users out. Set JWT_SECRET in server/.env."
        )
    return _ephemeral_secret


def password_problem(password: str) -> str | None:
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        return f"Password must be at most {MAX_PASSWORD_BYTES} bytes"
    return None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False

def new_opaque_token() -> str:
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tokens_match(presented: str, stored_hash: str) -> bool:
    return secrets.compare_digest(hash_token(presented), stored_hash)


def create_access_token(user_id: str, session_id: str) -> tuple[str, int]:
    settings = get_settings()
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    now = datetime.now(timezone.utc)

    token = jwt.encode(
        {
            "sub": user_id,
            "sid": session_id,
            "iat": now,
            "exp": now + timedelta(seconds=expires_in),
            "typ": "access",
        },
        _secret(),
        algorithm=settings.JWT_ALGORITHM,
    )
    return token, expires_in


def read_access_token(token: str) -> tuple[str, str]:
    settings = get_settings()
    try:
        payload = jwt.decode(token, _secret(), algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as e:
        raise InvalidToken("Session expired") from e
    except jwt.PyJWTError as e:
        raise InvalidToken("Invalid session token") from e

    subject = payload.get("sub")
    session_id = payload.get("sid")
    if not subject or payload.get("typ") != "access":
        raise InvalidToken("Invalid session token")
    if not session_id:
        raise InvalidToken("Please sign in again")
    return subject, session_id
