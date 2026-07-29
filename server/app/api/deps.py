

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import InvalidToken, read_access_token
from app.models.session import ClientInfo
from app.services import api_key_service, session_service
from app.services.auth_service import get_user_by_id

_bearer = HTTPBearer(auto_error=False)


@dataclass
class Principal:
    """Who is making the request, and how they proved it."""

    user: dict
    session_id: str
    method: str

    @property
    def user_id(self) -> str:
        return str(self.user["_id"])


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Principal:

    if credentials is None or not credentials.credentials:
        raise _unauthorized("Sign in to continue")

    presented = credentials.credentials

    if presented.startswith(api_key_service.KEY_PREFIX):
        key = await api_key_service.resolve(presented)
        if key is None:
            raise _unauthorized("That API key is not valid or has been revoked")
        user = await get_user_by_id(key["userId"])
        if user is None:
            raise _unauthorized("The account this key belongs to no longer exists")
        return Principal(user=user, session_id="", method="apiKey")

    try:
        user_id, session_id = read_access_token(presented)
    except InvalidToken as e:
        raise _unauthorized(str(e)) from e

    session = await session_service.get_active(session_id)
    if session is None:
        raise _unauthorized("This session has ended. Please sign in again.")

    user = await get_user_by_id(user_id)
    if user is None:
        raise _unauthorized("Session expired")

    return Principal(user=user, session_id=session_id, method="token")


async def get_current_user(principal: Principal = Depends(get_current_principal)) -> dict:
    return principal.user


def client_info(request: Request) -> ClientInfo:
    kind = (request.headers.get("x-imageshrink-client") or "").strip().lower()
    version = (request.headers.get("x-imageshrink-client-version") or "").strip()
    platform = (request.headers.get("x-imageshrink-platform") or "").strip()
    user_agent = request.headers.get("user-agent") or ""

    if kind not in ("web", "vscode", "cli"):
        kind = "web" if user_agent else "unknown"

    names = {"web": "Browser", "vscode": "VS Code", "cli": "CLI", "unknown": "Unknown client"}
    return ClientInfo(
        kind=kind,
        name=names[kind],
        version=version[:40],
        platform=(platform or user_agent)[:120],
    )


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]
