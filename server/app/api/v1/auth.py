from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.deps import Principal, client_info, client_ip, get_current_principal, get_current_user
from app.core.security import create_access_token
from app.models.user import public_user
from app.services import auth_service, session_service
from app.services.auth_service import AuthConflict, AuthFailed, AuthInvalid
from app.services.session_service import SessionInvalid

router = APIRouter(prefix="/auth", tags=["Auth"])


class SignupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class LoginRequest(BaseModel):
    # Accepts either the username or the email, so users don't have to remember which.
    identifier: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class RefreshRequest(BaseModel):
    refreshToken: str = Field(min_length=1, max_length=500)


class UpdateProfileRequest(BaseModel):
    username: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=254)


class ChangePasswordRequest(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=200)
    newPassword: str = Field(min_length=1, max_length=200)
    revokeOtherSessions: bool = True


async def _start_session(user: dict, request: Request) -> dict:
    session_id, refresh_token = await session_service.create_session(
        str(user["_id"]),
        client=client_info(request),
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent") or "",
    )
    token, expires_in = create_access_token(str(user["_id"]), session_id)
    return {
        "token": token,
        "tokenType": "bearer",
        "expiresIn": expires_in,
        "refreshToken": refresh_token,
        "sessionId": session_id,
        "user": public_user(user),
    }


def _as_http(e: Exception) -> HTTPException:
    """Map a service-layer error onto the right status code."""
    if isinstance(e, AuthConflict):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    if isinstance(e, AuthInvalid):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, request: Request):
    try:
        user = await auth_service.create_user(body.username, body.email, body.password)
    except (AuthConflict, AuthInvalid, AuthFailed) as e:
        raise _as_http(e) from e

    return {"success": True, "data": await _start_session(user, request)}


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    try:
        user = await auth_service.authenticate(body.identifier, body.password)
    except AuthFailed as e:
        raise _as_http(e) from e

    return {"success": True, "data": await _start_session(user, request)}


@router.post("/refresh")
async def refresh(body: RefreshRequest):
    try:
        session, next_refresh = await session_service.rotate(body.refreshToken)
    except SessionInvalid as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e

    user = await auth_service.get_user_by_id(session["userId"])
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="This account no longer exists"
        )

    token, expires_in = create_access_token(str(user["_id"]), str(session["_id"]))
    return {
        "success": True,
        "data": {
            "token": token,
            "tokenType": "bearer",
            "expiresIn": expires_in,
            "refreshToken": next_refresh,
            "sessionId": str(session["_id"]),
            "user": public_user(user),
        },
    }


@router.post("/logout")
async def logout(principal: Principal = Depends(get_current_principal)):
    """End this session server-side, so its refresh token stops working immediately."""
    if principal.session_id:
        await session_service.revoke(principal.session_id, principal.user_id, "signed out")
    return {"success": True, "data": None, "message": "Signed out"}


@router.get("/me")
async def read_me(principal: Principal = Depends(get_current_principal)):
    """Used on page load to turn a stored token back into a session."""
    if principal.session_id:
        await session_service.touch(principal.session_id)
    return {"success": True, "data": public_user(principal.user)}


@router.patch("/me")
async def update_me(body: UpdateProfileRequest, user: dict = Depends(get_current_user)):
    if body.username is None and body.email is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Provide a username or email to update"
        )
    try:
        updated = await auth_service.update_profile(str(user["_id"]), body.username, body.email)
    except (AuthConflict, AuthInvalid, AuthFailed) as e:
        raise _as_http(e) from e

    return {"success": True, "data": public_user(updated), "message": "Profile updated"}


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest, principal: Principal = Depends(get_current_principal)
):
    try:
        await auth_service.change_password(
            principal.user_id, body.currentPassword, body.newPassword
        )
    except (AuthConflict, AuthInvalid, AuthFailed) as e:
        raise _as_http(e) from e

    revoked = 0
    if body.revokeOtherSessions:
        revoked = await session_service.revoke_all(
            principal.user_id,
            except_session_id=principal.session_id or None,
            reason="password changed",
        )

    return {
        "success": True,
        "data": {"revokedSessions": revoked},
        "message": (
            f"Password changed. {revoked} other device(s) signed out."
            if revoked
            else "Password changed"
        ),
    }
