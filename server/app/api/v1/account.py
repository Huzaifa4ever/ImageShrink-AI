

from __future__ import annotations

import base64
import binascii
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import Principal, get_current_principal
from app.core.database import get_db
from app.core.security import verify_password
from app.models.session import public_session
from app.models.user import public_user
from app.services import api_key_service, session_service
from app.services.api_key_service import ApiKeyError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/account", tags=["Account"])

MAX_AVATAR_BYTES = 256 * 1024
_ALLOWED_AVATAR_TYPES = ("image/png", "image/jpeg", "image/webp")


class CreateApiKeyRequest(BaseModel):
    name: str = Field(default="", max_length=60)


class AvatarRequest(BaseModel):
    avatar: str | None = Field(default=None, max_length=MAX_AVATAR_BYTES * 2)


class DeleteAccountRequest(BaseModel):

    password: str = Field(min_length=1, max_length=200)
    confirmUsername: str = Field(min_length=1, max_length=32)

@router.get("/sessions")
async def list_sessions(principal: Principal = Depends(get_current_principal)):
    """Every signed-in device, browser and editor on this account."""
    docs = await session_service.list_for_user(principal.user_id)
    return {
        "success": True,
        "data": [public_session(d, principal.session_id or None) for d in docs],
    }


@router.delete("/sessions/{session_id}")
async def revoke_session(session_id: str, principal: Principal = Depends(get_current_principal)):
    """Sign one device out. Takes effect on that device's next request."""
    revoked = await session_service.revoke(
        session_id, principal.user_id, "revoked from another device"
    )
    if not revoked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="That session no longer exists"
        )

    is_self = session_id == principal.session_id
    return {
        "success": True,
        "data": {"signedOutSelf": is_self},
        "message": "You have been signed out" if is_self else "Device signed out",
    }


@router.post("/sessions/revoke-others")
async def revoke_other_sessions(principal: Principal = Depends(get_current_principal)):
    """Sign out everywhere except here."""
    count = await session_service.revoke_all(
        principal.user_id,
        except_session_id=principal.session_id or None,
        reason="revoked from another device",
    )
    return {
        "success": True,
        "data": {"revoked": count},
        "message": f"{count} device(s) signed out" if count else "No other devices were signed in",
    }


@router.get("/api-keys")
async def list_api_keys(principal: Principal = Depends(get_current_principal)):
    return {"success": True, "data": await api_key_service.list_for_user(principal.user_id)}


@router.post("/api-keys", status_code=status.HTTP_201_CREATED)
async def create_api_key(
    body: CreateApiKeyRequest, principal: Principal = Depends(get_current_principal)
):
    """Mint a key. The plaintext is in this response and nowhere else, ever."""
    try:
        record, plaintext = await api_key_service.create(principal.user_id, body.name)
    except ApiKeyError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    return {
        "success": True,
        "data": {**record, "key": plaintext},
        "message": "Copy this key now — it cannot be shown again.",
    }


@router.delete("/api-keys/{key_id}")
async def revoke_api_key(key_id: str, principal: Principal = Depends(get_current_principal)):
    if not await api_key_service.revoke(key_id, principal.user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That key no longer exists")
    return {"success": True, "data": None, "message": "Key revoked"}


def _validate_avatar(data_url: str) -> str:
    if not data_url.startswith("data:"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Send the picture as a data URL, e.g. data:image/png;base64,...",
        )

    try:
        header, encoded = data_url.split(",", 1)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That picture could not be read"
        ) from None

    mime = header[5:].split(";")[0].lower()
    if mime not in _ALLOWED_AVATAR_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Use a PNG, JPEG or WebP image (got {mime or 'an unknown type'})",
        )
    if "base64" not in header:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The picture must be base64-encoded"
        )

    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That picture is not valid base64"
        ) from None

    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Keep the picture under {MAX_AVATAR_BYTES // 1024} KB",
        )
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That picture is empty"
        )

    signatures = {
        "image/png": (b"\x89PNG\r\n\x1a\n",),
        "image/jpeg": (b"\xff\xd8\xff",),
        "image/webp": (b"RIFF",),
    }
    if not any(raw.startswith(sig) for sig in signatures[mime]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"That file does not look like a {mime.split('/')[1].upper()} image",
        )

    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


@router.put("/avatar")
async def set_avatar(body: AvatarRequest, principal: Principal = Depends(get_current_principal)):
    """Set or clear the profile picture."""
    normalized = _validate_avatar(body.avatar) if body.avatar else None

    await get_db()["users"].update_one(
        {"_id": principal.user["_id"]}, {"$set": {"avatar": normalized}}
    )
    updated = {**principal.user, "avatar": normalized}
    return {
        "success": True,
        "data": public_user(updated),
        "message": "Picture updated" if normalized else "Picture removed",
    }


@router.post("/delete")
async def delete_account(
    body: DeleteAccountRequest, principal: Principal = Depends(get_current_principal)
):
    if principal.method != "token":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Delete your account from a signed-in browser session, not with an API key.",
        )

    user = principal.user
    if body.confirmUsername.strip().lower() != str(user["username"]).lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The username you typed does not match this account",
        )
    if not verify_password(body.password, user["passwordHash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="That password is incorrect"
        )

    user_id = principal.user_id
    db = get_db()

    await session_service.delete_all_for_user(user_id)
    await api_key_service.delete_all_for_user(user_id)
    analyses = await db["analyses"].delete_many({"userId": user_id})
    await db["deviceCodes"].delete_many({"userId": user_id})
    await db["users"].delete_one({"_id": user["_id"]})

    logger.info("account %s deleted (%d analyses removed)", user_id, analyses.deleted_count)
    return {
        "success": True,
        "data": {"deletedAnalyses": analyses.deleted_count},
        "message": "Your account and all of its data have been deleted",
    }
