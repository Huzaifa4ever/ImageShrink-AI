from fastapi import APIRouter
from app.api.v1.analyze import router as analyze_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(analyze_router)
