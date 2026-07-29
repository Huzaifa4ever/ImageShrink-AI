

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.deps import Principal, client_ip, get_current_principal
from app.core.security import create_access_token
from app.models.session import ClientInfo
from app.models.user import public_user
from app.services import auth_service, device_flow, session_service
from app.services.device_flow import DeviceFlowError, DevicePending, DeviceSlowDown

router = APIRouter(prefix="/auth/device", tags=["Extension login"])


class StartRequest(BaseModel):
    clientName: str = Field(default="VS Code", max_length=60)
    clientVersion: str = Field(default="", max_length=40)
    platform: str = Field(default="", max_length=120)


class TokenRequest(BaseModel):
    deviceCode: str = Field(min_length=1, max_length=500)


class UserCodeRequest(BaseModel):
    userCode: str = Field(min_length=1, max_length=32)


def _bad_request(e: Exception) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/start", status_code=status.HTTP_201_CREATED)
async def start(body: StartRequest):
    client = ClientInfo(
        kind="vscode",
        name=body.clientName or "VS Code",
        version=body.clientVersion,
        platform=body.platform,
    )
    try:
        return {"success": True, "data": await device_flow.start(client)}
    except DeviceFlowError as e:
        raise _bad_request(e) from e


@router.post("/token")
async def exchange_token(body: TokenRequest, request: Request):
    try:
        user_id, approved_client = await device_flow.claim(body.deviceCode)
    except DevicePending as e:
        raise HTTPException(status_code=status.HTTP_202_ACCEPTED, detail=str(e)) from e
    except DeviceSlowDown as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(e),
            headers={"Retry-After": str(e.interval)},
        ) from e
    except DeviceFlowError as e:
        raise _bad_request(e) from e

    user = await auth_service.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="This account no longer exists"
        )
    session_id, refresh_token = await session_service.create_session(
        user_id,
        client=approved_client,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent") or "",
    )
    token, expires_in = create_access_token(user_id, session_id)

    return {
        "success": True,
        "data": {
            "token": token,
            "tokenType": "bearer",
            "expiresIn": expires_in,
            "refreshToken": refresh_token,
            "sessionId": session_id,
            "user": public_user(user),
        },
    }

@router.get("/pending")
async def pending(userCode: str, _: Principal = Depends(get_current_principal)):
    """Details for the approval screen: which client is asking, and when it asked."""
    try:
        return {"success": True, "data": await device_flow.describe(userCode)}
    except DeviceFlowError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.post("/approve")
async def approve(body: UserCodeRequest, principal: Principal = Depends(get_current_principal)):
    """Grant the requesting client access to this account."""
    if principal.method != "token":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Approve a device from a signed-in browser session, not with an API key.",
        )
    try:
        data = await device_flow.approve(body.userCode, principal.user_id)
    except DeviceFlowError as e:
        raise _bad_request(e) from e

    return {"success": True, "data": data, "message": "Device approved"}


@router.post("/deny")
async def deny(body: UserCodeRequest, _: Principal = Depends(get_current_principal)):
    try:
        await device_flow.deny(body.userCode)
    except DeviceFlowError as e:
        raise _bad_request(e) from e
    return {"success": True, "data": None, "message": "Request declined"}
