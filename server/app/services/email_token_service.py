"""Single-use, expiring tokens for email confirmation and password reset.

These travel in a URL, so only a SHA-256 hash is stored and each token works exactly once.
Issuing a new one invalidates the outstanding one, so a forwarded old email stops working.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from pymongo import ASCENDING

from app.core.database import get_db
from app.core.security import hash_token, new_opaque_token

logger = logging.getLogger(__name__)

PURPOSE_VERIFY = "verify"
PURPOSE_RESET = "reset"


def _tokens():
    return get_db()["emailTokens"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes() -> None:
    try:
        await _tokens().create_index(
            [("tokenHash", ASCENDING)], unique=True, name="uniq_token"
        )
        await _tokens().create_index(
            [("userId", ASCENDING), ("purpose", ASCENDING)], name="owner_purpose"
        )
        await _tokens().create_index(
            [("expiresAt", ASCENDING)], expireAfterSeconds=0, name="ttl"
        )
        logger.info("email tokens: indexes ensured")
    except Exception as e:
        logger.warning("email tokens: could not ensure indexes: %s", e)


async def issue(user_id: str, purpose: str, lifetime: timedelta) -> str:
    """Create a token, invalidating any outstanding ones for the same purpose."""
    await _tokens().delete_many({"userId": user_id, "purpose": purpose})

    token = new_opaque_token()
    await _tokens().insert_one(
        {
            "_id": ObjectId(),
            "userId": user_id,
            "purpose": purpose,
            "tokenHash": hash_token(token),
            "createdAt": _now(),
            "expiresAt": _now() + lifetime,
            "usedAt": None,
        }
    )
    return token


async def consume(token: str, purpose: str) -> str | None:
    """Spend a token. Returns the user id, or None if invalid, used or expired.

    find_one_and_update makes it single-use: matching and stamping are one server-side
    operation, so a double-click cannot use it twice.
    """
    if not token:
        return None

    doc = await _tokens().find_one_and_update(
        {
            "tokenHash": hash_token(token),
            "purpose": purpose,
            "usedAt": None,
            "expiresAt": {"$gt": _now()},
        },
        {"$set": {"usedAt": _now()}},
    )
    if doc is None:
        return None
    return str(doc["userId"])


async def revoke_all(user_id: str, purpose: str) -> None:
    await _tokens().delete_many({"userId": user_id, "purpose": purpose})
