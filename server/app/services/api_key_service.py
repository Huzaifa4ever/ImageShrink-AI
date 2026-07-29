

from __future__ import annotations

import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ASCENDING

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import hash_token, new_opaque_token

logger = logging.getLogger(__name__)

KEY_PREFIX = "isk_"

_DISPLAY_CHARS = 6


class ApiKeyError(Exception):
    """The request cannot be satisfied - too many keys, or a bad name."""


def _keys():
    return get_db()["apiKeys"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes() -> None:
    try:
        await _keys().create_index([("keyHash", ASCENDING)], unique=True, name="uniq_key")
        await _keys().create_index([("userId", ASCENDING)], name="owner")
        logger.info("api keys: indexes ensured")
    except Exception as e: 
        logger.warning("api keys: could not ensure indexes: %s", e)


async def create(user_id: str, name: str) -> tuple[dict, str]:
    """Mint a key. Returns ``(public_record, plaintext_key)``.

    The plaintext is available here and never again.
    """
    settings = get_settings()
    clean_name = (name or "").strip()[:60] or "Untitled key"

    live = await _keys().count_documents({"userId": user_id, "revokedAt": None})
    if live >= settings.MAX_API_KEYS_PER_USER:
        raise ApiKeyError(
            f"You already have {settings.MAX_API_KEYS_PER_USER} active keys. "
            "Revoke one before creating another."
        )

    secret = new_opaque_token()
    plaintext = f"{KEY_PREFIX}{secret}"

    doc = {
        "_id": ObjectId(),
        "userId": user_id,
        "name": clean_name,
        "keyHash": hash_token(plaintext),
        "display": f"{KEY_PREFIX}{secret[:_DISPLAY_CHARS]}",
        "createdAt": _now(),
        "lastUsedAt": None,
        "revokedAt": None,
    }
    await _keys().insert_one(doc)
    return public_key(doc), plaintext


async def resolve(plaintext: str) -> dict | None:
    """The owning key record for a presented key, or None. Updates ``lastUsedAt``."""
    if not plaintext.startswith(KEY_PREFIX):
        return None

    doc = await _keys().find_one({"keyHash": hash_token(plaintext), "revokedAt": None})
    if doc is None:
        return None

    try:
        await _keys().update_one({"_id": doc["_id"]}, {"$set": {"lastUsedAt": _now()}})
    except Exception as e:  # noqa: BLE001
        logger.warning("api keys: could not record use of %s: %s", doc["_id"], e)

    return doc


async def list_for_user(user_id: str) -> list[dict]:
    cursor = _keys().find({"userId": user_id, "revokedAt": None}).sort("createdAt", -1)
    return [public_key(doc) async for doc in cursor]


async def revoke(key_id: str, user_id: str) -> bool:
    try:
        oid = ObjectId(key_id)
    except (InvalidId, TypeError):
        return False

    result = await _keys().update_one(
        {"_id": oid, "userId": user_id, "revokedAt": None},
        {"$set": {"revokedAt": _now()}},
    )
    return result.modified_count > 0


async def delete_all_for_user(user_id: str) -> int:
    result = await _keys().delete_many({"userId": user_id})
    return result.deleted_count


def public_key(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "name": doc.get("name", ""),
        "display": doc.get("display", ""),
        "createdAt": doc.get("createdAt"),
        "lastUsedAt": doc.get("lastUsedAt"),
    }
