from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.database import close_db, connect_db
from app.services import api_key_service, device_flow, session_service
from app.services.auth_service import ensure_indexes
from app.services.rule_engine import verify_shared_data

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):

    verify_shared_data()

    await connect_db()
    try:
        await ensure_indexes()
        await session_service.ensure_indexes()
        await api_key_service.ensure_indexes()
        await device_flow.ensure_indexes()
    except RuntimeError:
        pass
    yield
    await close_db()


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        description="AI-powered Docker image optimizer and layer auditor",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)

    @app.get("/health", tags=["Health"])
    async def health_check():
        return {"status": "ok", "app": settings.APP_NAME}

    return app


app = create_app()
