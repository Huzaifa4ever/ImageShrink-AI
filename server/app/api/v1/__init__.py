from fastapi import APIRouter

from app.api.v1.account import router as account_router
from app.api.v1.analyze import router as analyze_router
from app.api.v1.auth import router as auth_router
from app.api.v1.device import router as device_router
from app.api.v1.models import router as models_router
from app.api.v1.rules import router as rules_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(device_router)
api_router.include_router(account_router)
api_router.include_router(analyze_router)
api_router.include_router(models_router)
api_router.include_router(rules_router)
