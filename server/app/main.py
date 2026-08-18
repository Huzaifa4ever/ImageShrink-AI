import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.database import close_db, connect_db
from app.core.observability import configure_azure_monitor_if_enabled, configure_logging
from app.services import api_key_service, device_flow, email_token_service, session_service
from app.services.auth_service import ensure_indexes
from app.services.rule_engine import verify_shared_data

settings = get_settings()

# Before anything else logs, and before the app is built — the OpenTelemetry distro
# instruments libraries at import time, so it has to run ahead of the first request.
configure_logging()
configure_azure_monitor_if_enabled()


@asynccontextmanager
async def lifespan(app: FastAPI):

    # First line of every replica's log. Gives Azure Monitor a marker to join errors to a
    # release, and tells you at a glance whether a restart was a deploy or a crash loop.
    logging.getLogger(__name__).info(
        "starting %s build=%s env=%s", settings.APP_NAME, settings.APP_BUILD, settings.APP_ENV
    )

    verify_shared_data()

    await connect_db()
    try:
        await ensure_indexes()
        await session_service.ensure_indexes()
        await api_key_service.ensure_indexes()
        await device_flow.ensure_indexes()
        await email_token_service.ensure_indexes()
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
        # `build` lets the deploy pipeline confirm the revision it just pushed is the one
        # answering. A healthy *previous* revision would otherwise pass this check and hide a
        # deploy that silently did not take effect.
        return {"status": "ok", "app": settings.APP_NAME, "build": settings.APP_BUILD}

    return app


app = create_app()
