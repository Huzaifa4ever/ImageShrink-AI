"""Logging and Azure Monitor wiring. Both must run before the app starts serving.

Uvicorn configures only its own loggers and leaves the root logger at WARNING with no handler,
so without this every logger.info() in app.services.* is silently discarded — and any
log-based alert would never fire. Azure Monitor is off unless a connection string is set.
"""

from __future__ import annotations

import logging
import sys

from app.core.config import get_settings

logger = logging.getLogger(__name__)

LOG_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%dT%H:%M:%S"

#: Chatty third-party loggers. Left at WARNING so the free 5 GB/month ingestion grant is
#: spent on this application's own lines rather than on connection bookkeeping.
NOISY = ("pymongo", "httpx", "httpcore", "azure.monitor", "azure.core", "opentelemetry")


def configure_logging() -> None:
    """Send this application's logs to stdout, where the container platform collects them."""
    settings = get_settings()
    level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)

    root = logging.getLogger()
    root.setLevel(level)

    # Idempotent: uvicorn's reloader imports the app more than once per process lifetime, and
    # a second handler would duplicate every line.
    if not any(getattr(h, "_imageshrink", False) for h in root.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT))
        handler._imageshrink = True  # type: ignore[attr-defined]
        root.addHandler(handler)

    for name in NOISY:
        logging.getLogger(name).setLevel(logging.WARNING)


def configure_azure_monitor_if_enabled() -> bool:
    """Wire up Application Insights when a connection string is present. Never fatal."""
    settings = get_settings()
    if not settings.APPLICATIONINSIGHTS_CONNECTION_STRING:
        logger.info("Application Insights not configured - set the connection string to enable")
        return False

    try:
        from azure.monitor.opentelemetry import configure_azure_monitor
    except ImportError:
        logger.warning(
            "APPLICATIONINSIGHTS_CONNECTION_STRING is set but azure-monitor-opentelemetry "
            "is not installed. Traces will not be sent. Reinstall requirements.txt."
        )
        return False

    try:
        configure_azure_monitor(
            connection_string=settings.APPLICATIONINSIGHTS_CONNECTION_STRING,
            logger_name=None,
        )
    except Exception as exc:
        # Telemetry failing must never take the API down with it.
        logger.warning("Application Insights setup failed (%s). Continuing without it.", exc)
        return False

    logger.info("Application Insights enabled")
    return True
