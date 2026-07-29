
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ASCENDING, DESCENDING

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import hash_token, new_opaque_token
from app.models.session import ClientInfo, SessionDocument

logger = logging.getLogger(__name__)


class SessionInvalid(Exception):
    """The presented refresh token is unusable, and the client must sign in again."""


def _sessions():
    return get_db()["sessions"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes() -> None:
    try:
        await _sessions().create_index([("refreshTokenHash", ASCENDING)], name="refresh_lookup")
        await _sessions().create_index([("previousTokenHash", ASCENDING)], name="replay_lookup")
        # Backs the devices list.
        await _sessions().create_index(
            [("userId", ASCENDING), ("lastSeenAt", DESCENDING)], name="owner_recent"
        )
        await _sessions().create_index([("expiresAt", ASCENDING)], expireAfterSeconds=0, name="ttl")
        logger.info("sessions: indexes ensured")
    except Exception as e: 
        logger.warning("sessions: could not ensure indexes: %s", e)


def _is_live(doc: dict | None) -> bool:
    if doc is None or doc.get("revokedAt") is not None:
        return False
    expires = doc.get("expiresAt")
    return not (expires and expires <= _now())


async def get_active(session_id: str) -> dict | None:
    try:
        oid = ObjectId(session_id)
    except (InvalidId, TypeError):
        return None

    doc = await _sessions().find_one({"_id": oid})
    return doc if _is_live(doc) else None


async def list_for_user(user_id: str) -> list[dict]:
    """Live sessions for the devices list, most recently used first."""
    cursor = (
        _sessions()
        .find({"userId": user_id, "revokedAt": None, "expiresAt": {"$gt": _now()}})
        .sort("lastSeenAt", -1)
        .limit(50)
    )
    return [doc async for doc in cursor]


async def create_session(
    user_id: str,
    client: ClientInfo | None = None,
    ip: str = "",
    user_agent: str = "",
) -> tuple[str, str]:
    settings = get_settings()
    refresh_token = new_opaque_token()

    doc = SessionDocument(
        user_id=user_id,
        refresh_token_hash=hash_token(refresh_token),
        client=client or ClientInfo(),
        ip=ip,
        user_agent=user_agent[:400],
        expires_at=_now() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    await _sessions().insert_one(doc.to_mongo())
    return doc.id, refresh_token


async def rotate(refresh_token: str) -> tuple[dict, str]:
    presented = hash_token(refresh_token)

    doc = await _sessions().find_one({"refreshTokenHash": presented})

    if doc is None:
        replayed = await _sessions().find_one({"previousTokenHash": presented})
        if replayed is not None:
            logger.warning(
                "sessions: refresh token reuse on session %s (user %s) - revoking",
                replayed["_id"],
                replayed.get("userId"),
            )
            await _sessions().update_one(
                {"_id": replayed["_id"]},
                {"$set": {"revokedAt": _now(), "revokedReason": "token reuse detected"}},
            )
            raise SessionInvalid(
                "This session was ended because its refresh token was reused. "
                "Sign in again, and revoke any device you do not recognise."
            )
        raise SessionInvalid("Session expired. Please sign in again.")

    if not _is_live(doc):
        raise SessionInvalid("Session expired. Please sign in again.")

    settings = get_settings()
    next_token = new_opaque_token()
    now = _now()

    await _sessions().update_one(
        {"_id": doc["_id"]},
        {
            "$set": {
                "refreshTokenHash": hash_token(next_token),
                "previousTokenHash": presented,
                "lastSeenAt": now,
                "expiresAt": now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            }
        },
    )

    refreshed = await _sessions().find_one({"_id": doc["_id"]})
    return refreshed or doc, next_token


async def touch(session_id: str) -> None:
    try:
        oid = ObjectId(session_id)
    except (InvalidId, TypeError):
        return
    await _sessions().update_one({"_id": oid}, {"$set": {"lastSeenAt": _now()}})


async def revoke(session_id: str, user_id: str, reason: str = "signed out") -> bool:
    try:
        oid = ObjectId(session_id)
    except (InvalidId, TypeError):
        return False

    result = await _sessions().update_one(
        {"_id": oid, "userId": user_id, "revokedAt": None},
        {"$set": {"revokedAt": _now(), "revokedReason": reason}},
    )
    return result.modified_count > 0


async def revoke_all(
    user_id: str, except_session_id: str | None = None, reason: str = "revoked"
) -> int:
    """End every session for a user, optionally sparing the one making the request."""
    query: dict = {"userId": user_id, "revokedAt": None}
    if except_session_id:
        try:
            query["_id"] = {"$ne": ObjectId(except_session_id)}
        except (InvalidId, TypeError):
            pass

    result = await _sessions().update_many(
        query, {"$set": {"revokedAt": _now(), "revokedReason": reason}}
    )
    return result.modified_count


async def delete_all_for_user(user_id: str) -> int:
    result = await _sessions().delete_many({"userId": user_id})
    return result.deleted_count
