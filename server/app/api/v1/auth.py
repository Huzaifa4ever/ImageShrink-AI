from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.deps import Principal, client_info, client_ip, get_current_principal, get_current_user
from app.core.config import get_settings
from app.core.security import create_access_token
from app.models.user import public_user
from app.services import (
    auth_service,
    email_service,
    email_token_service,
    google_auth,
    session_service,
)
from app.services.auth_service import AuthConflict, AuthFailed, AuthInvalid
from app.services.email_token_service import PURPOSE_RESET, PURPOSE_VERIFY
from app.services.session_service import SessionInvalid

logger = logging.getLogger(__name__)

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


class GoogleSignInRequest(BaseModel):
    #: The ID token from Google Identity Services in the browser.
    credential: str = Field(min_length=1, max_length=4096)


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=1, max_length=200)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1, max_length=200)
    newPassword: str = Field(min_length=1, max_length=200)


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


def _web_url() -> str:
    return get_settings().WEB_APP_URL.rstrip("/")


async def _send_verification(user: dict) -> bool:
    """Issue a confirmation link and email it. False if email is not set up on this server."""
    if not email_service.is_configured():
        logger.warning("email not configured - skipping verification email")
        return False

    settings = get_settings()
    hours = settings.EMAIL_VERIFY_TOKEN_HOURS
    token = await email_token_service.issue(
        str(user["_id"]), PURPOSE_VERIFY, timedelta(hours=hours)
    )
    link = f"{_web_url()}/verify-email?token={token}"
    subject, html, text = email_service.verification_email(user["username"], link, hours)

    try:
        await email_service.send(user["email"], subject, html, text)
    except email_service.EmailSendFailed:
        # Signup already succeeded. Failing the whole request now would leave an account the
        # user cannot log into and cannot re-create. They can ask for a new link instead.
        logger.error("could not send verification email to a new account")
        return False
    return True


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, request: Request):
    try:
        user = await auth_service.create_user(body.username, body.email, body.password)
    except (AuthConflict, AuthInvalid, AuthFailed) as e:
        raise _as_http(e) from e

    emailed = await _send_verification(user)
    data = await _start_session(user, request)
    data["verificationEmailSent"] = emailed
    return {"success": True, "data": data}


@router.post("/google")
async def google_sign_in(body: GoogleSignInRequest, request: Request):
    """Sign in or sign up with a Google ID token from the browser."""
    try:
        profile = await google_auth.verify(body.credential)
    except google_auth.GoogleAuthUnavailable as e:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(e)
        ) from e
    except google_auth.GoogleAuthInvalid as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e

    try:
        user, created = await auth_service.upsert_google_user(profile)
    except (AuthConflict, AuthInvalid, AuthFailed) as e:
        raise _as_http(e) from e

    data = await _start_session(user, request)
    data["created"] = created
    return {
        "success": True,
        "data": data,
        "message": "Account created" if created else "Signed in",
    }


@router.post("/verify-email/send")
async def resend_verification(user: dict = Depends(get_current_user)):
    """Ask for a fresh confirmation link. Any outstanding one stops working."""
    if user.get("emailVerified", True):
        return {"success": True, "data": None, "message": "Your email is already confirmed"}

    if not await _send_verification(user):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not send the email just now. Please try again shortly.",
        )
    return {"success": True, "data": None, "message": f"Link sent to {user['email']}"}


@router.post("/verify-email/confirm")
async def confirm_email(body: VerifyEmailRequest):
    user_id = await email_token_service.consume(body.token, PURPOSE_VERIFY)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That link has expired or has already been used. Request a new one.",
        )

    user = await auth_service.mark_email_verified(user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This account no longer exists"
        )
    return {"success": True, "data": public_user(user), "message": "Email confirmed"}


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest):
    """Email a reset link.

    Always reports success, even for an address with no account. Saying "no such user" here
    turns this endpoint into a way to test which email addresses are registered.
    """
    generic = {
        "success": True,
        "data": None,
        "message": "If that email has an account, a reset link is on its way.",
    }

    user = await auth_service.find_by_email(body.email)
    if user is None:
        logger.info("password reset requested for an address with no account")
        return generic

    if not email_service.is_configured():
        logger.warning("email not configured - cannot send password reset")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset by email is not available on this server yet.",
        )

    settings = get_settings()
    minutes = settings.PASSWORD_RESET_TOKEN_MINUTES
    token = await email_token_service.issue(
        str(user["_id"]), PURPOSE_RESET, timedelta(minutes=minutes)
    )
    link = f"{_web_url()}/reset-password?token={token}"
    subject, html, text = email_service.password_reset_email(user["username"], link, minutes)

    try:
        await email_service.send(user["email"], subject, html, text)
    except email_service.EmailSendFailed:
        logger.error("could not send password reset email")
    return generic


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest):
    user_id = await email_token_service.consume(body.token, PURPOSE_RESET)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That reset link has expired or has already been used. Request a new one.",
        )

    try:
        await auth_service.set_password(user_id, body.newPassword)
    except (AuthConflict, AuthInvalid, AuthFailed) as e:
        raise _as_http(e) from e

    # Whoever asked for this may have been locked out by someone else. Signing every session
    # out is the point of a reset, not a side effect of it.
    revoked = await session_service.revoke_all(user_id, reason="password reset")
    return {
        "success": True,
        "data": {"revokedSessions": revoked},
        "message": "Password changed. Please sign in with your new password.",
    }


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
