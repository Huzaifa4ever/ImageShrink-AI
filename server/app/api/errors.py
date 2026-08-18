

from __future__ import annotations

import logging

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.services.model_scheduler import Attempt, ProviderBusy, ProviderUnavailable

logger = logging.getLogger(__name__)


def _tried_summary(attempts: list[Attempt]) -> str:
    if not attempts:
        return ""
    tried = ", ".join(f"{a.model} ({a.reason})" for a in attempts)
    return f" Tried: {tried}."


def scheduler_http_error(e: BaseException) -> HTTPException:
    settings = get_settings()

    if isinstance(e, ProviderBusy):
        # A user was turned away. Nothing else records this — the exception becomes a 429 and
        # disappears — so without this line "we are at capacity" is invisible in the logs and
        # no alert rule can see it.
        logger.warning(
            "quota exhausted: every model busy, retry in %ss (tried: %s)",
            e.retry_after_seconds,
            ", ".join(a.model for a in e.attempts) or "none",
        )
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Every available model has used its quota of "
                f"{settings.MODEL_REQUESTS_PER_MINUTE} requests per minute. A slot frees "
                f"up in about {e.retry_after_seconds}s - this is provider throttling, not "
                f"a problem with your Dockerfile.{_tried_summary(e.attempts)}"
            ),
            headers={"Retry-After": str(e.retry_after_seconds)},
        )

    if isinstance(e, ProviderUnavailable):
        logger.error("provider unavailable: %s (tried: %s)", e, _tried_summary(e.attempts))
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI optimization failed: {e}.{_tried_summary(e.attempts)}",
        )

    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"AI optimization failed: {e}",
    )
