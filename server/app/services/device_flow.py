
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import hash_token, new_opaque_token
from app.models.session import ClientInfo

logger = logging.getLogger(__name__)

_ALPHABET = "BCDFGHJKMNPQRSTVWXYZ23456789"
_USER_CODE_HALF = 4

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_DENIED = "denied"


class DeviceFlowError(Exception):
    """The code is unknown, expired, already used, or was denied."""


class DevicePending(Exception):
    """Not approved yet. The client should keep polling."""


class DeviceSlowDown(Exception):
    """The client is polling faster than the advertised interval."""

    def __init__(self, interval: int) -> None:
        self.interval = interval
        super().__init__(f"Polling too fast - wait at least {interval}s between attempts.")


def _codes():
    return get_db()["deviceCodes"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_user_code() -> str:
    pick = lambda n: "".join(secrets.choice(_ALPHABET) for _ in range(n))  # noqa: E731
    return f"{pick(_USER_CODE_HALF)}-{pick(_USER_CODE_HALF)}"


def normalize_user_code(value: str) -> str:
    cleaned = "".join(c for c in (value or "").upper() if c.isalnum())
    if len(cleaned) != _USER_CODE_HALF * 2:
        return cleaned
    return f"{cleaned[:_USER_CODE_HALF]}-{cleaned[_USER_CODE_HALF:]}"


async def ensure_indexes() -> None:
    try:
        await _codes().create_index([("deviceCodeHash", ASCENDING)], unique=True, name="uniq_device")
        await _codes().create_index([("userCode", ASCENDING)], name="user_code")
        await _codes().create_index(
            [("expiresAt", ASCENDING)], expireAfterSeconds=0, name="ttl"
        )
        logger.info("device flow: indexes ensured")
    except Exception as e: 
        logger.warning("device flow: could not ensure indexes: %s", e)


async def start(client: ClientInfo) -> dict:
    """Issue a code pair. Returns what the extension needs to show and to poll with."""
    settings = get_settings()
    device_code = new_opaque_token()

    for _ in range(5):
        user_code = _new_user_code()
        clash = await _codes().find_one(
            {"userCode": user_code, "status": STATUS_PENDING, "expiresAt": {"$gt": _now()}}
        )
        if clash is None:
            break
    else: 
        raise DeviceFlowError("Could not allocate a login code. Please try again.")

    expires_at = _now() + timedelta(minutes=settings.DEVICE_CODE_EXPIRE_MINUTES)
    await _codes().insert_one(
        {
            "deviceCodeHash": hash_token(device_code),
            "userCode": user_code,
            "status": STATUS_PENDING,
            "client": client.model_dump(by_alias=True),
            "userId": None,
            "createdAt": _now(),
            "expiresAt": expires_at,
            "approvedAt": None,
            "consumedAt": None,
            "lastPolledAt": None,
        }
    )

    base = settings.WEB_APP_URL.rstrip("/")
    return {
        "deviceCode": device_code,
        "userCode": user_code,
        "verificationUri": f"{base}/activate",
        "verificationUriComplete": f"{base}/activate?code={user_code}",
        "expiresIn": settings.DEVICE_CODE_EXPIRE_MINUTES * 60,
        "interval": settings.DEVICE_CODE_POLL_INTERVAL_SECONDS,
    }


async def describe(user_code: str) -> dict:
    doc = await _codes().find_one(
        {"userCode": normalize_user_code(user_code), "expiresAt": {"$gt": _now()}}
    )
    if doc is None:
        raise DeviceFlowError("That code is not valid, or it has expired. Start again in VS Code.")
    if doc["status"] != STATUS_PENDING or doc.get("consumedAt"):
        raise DeviceFlowError("That code has already been used.")

    client = doc.get("client") or {}
    return {
        "userCode": doc["userCode"],
        "client": {
            "kind": client.get("kind", "unknown"),
            "name": client.get("name", ""),
            "version": client.get("version", ""),
            "platform": client.get("platform", ""),
        },
        "requestedAt": doc.get("createdAt"),
        "expiresAt": doc.get("expiresAt"),
    }


async def approve(user_code: str, user_id: str) -> dict:
    result = await _codes().find_one_and_update(
        {
            "userCode": normalize_user_code(user_code),
            "status": STATUS_PENDING,
            "consumedAt": None,
            "expiresAt": {"$gt": _now()},
        },
        {"$set": {"status": STATUS_APPROVED, "userId": user_id, "approvedAt": _now()}},
        return_document=True,
    )
    if result is None:
        raise DeviceFlowError(
            "That code is no longer valid. It may have expired or already been used - "
            "start the sign-in again in VS Code."
        )
    return await describe_approved(result)


async def describe_approved(doc: dict) -> dict:
    client = doc.get("client") or {}
    return {
        "userCode": doc["userCode"],
        "client": {"kind": client.get("kind", "unknown"), "name": client.get("name", "")},
    }


async def deny(user_code: str) -> None:
    """Reject a code, so the extension stops polling and says so."""
    result = await _codes().update_one(
        {"userCode": normalize_user_code(user_code), "status": STATUS_PENDING},
        {"$set": {"status": STATUS_DENIED}},
    )
    if result.modified_count == 0:
        raise DeviceFlowError("That code is no longer pending.")


async def claim(device_code: str) -> tuple[str, ClientInfo]:
    settings = get_settings()
    presented = hash_token(device_code)
    now = _now()

    doc = await _codes().find_one({"deviceCodeHash": presented})
    if doc is None:
        raise DeviceFlowError("Unknown login code. Start the sign-in again.")

    if doc.get("consumedAt"):
        raise DeviceFlowError("This login code has already been used.")
    if doc["expiresAt"] <= now:
        raise DeviceFlowError("This login code expired. Start the sign-in again.")
    if doc["status"] == STATUS_DENIED:
        raise DeviceFlowError("The sign-in request was declined.")

    if doc["status"] == STATUS_PENDING:
        last = doc.get("lastPolledAt")
        floor = settings.DEVICE_CODE_POLL_INTERVAL_SECONDS / 2
        await _codes().update_one({"_id": doc["_id"]}, {"$set": {"lastPolledAt": now}})
        if last is not None and (now - last).total_seconds() < floor:
            raise DeviceSlowDown(settings.DEVICE_CODE_POLL_INTERVAL_SECONDS)
        raise DevicePending("Waiting for approval in the browser.")

    claimed = await _codes().find_one_and_update(
        {"_id": doc["_id"], "status": STATUS_APPROVED, "consumedAt": None},
        {"$set": {"consumedAt": now}},
        return_document=True,
    )
    if claimed is None:
        raise DeviceFlowError("This login code has already been used.")

    user_id = claimed.get("userId")
    if not user_id: 
        raise DeviceFlowError("This login could not be completed. Start the sign-in again.")

    return user_id, ClientInfo(**(claimed.get("client") or {}))
