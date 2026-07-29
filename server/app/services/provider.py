
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from openai import AsyncOpenAI

from app.core.config import get_settings

AVAILABLE = "available"
BUSY = "busy"
UNAVAILABLE = "unavailable"
UNKNOWN = "unknown"

_BUSY_MARKERS = ("429", "rate", "queue", "too_many_requests", "capacity", "overload")
_MISSING_MARKERS = ("404", "not_found", "not found", "does not exist", "no such model")
_AUTH_MARKERS = ("401", "403", "invalid_api_key", "authentication")

_client: AsyncOpenAI | None = None


@dataclass(frozen=True)
class ProviderVerdict:
    """What a provider exception means for scheduling and for the user."""

    status: str
    reason: str
    retryable: bool
    fatal: bool


def get_client() -> AsyncOpenAI:
    """The shared provider client. Created lazily so importing this module is cheap."""
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncOpenAI(
            api_key=settings.CEREBRAS_API_KEY,
            base_url=settings.CEREBRAS_BASE_URL,
        )
    return _client


def classify_error(error: BaseException) -> ProviderVerdict:
    """Map a provider exception onto a scheduling decision plus a user-facing reason."""
    text = str(error).lower()

    if isinstance(error, (asyncio.TimeoutError, TimeoutError)):
        return ProviderVerdict(
            BUSY,
            "Did not respond in time - likely queueing behind other requests",
            retryable=True,
            fatal=False,
        )


    if any(m in text for m in _BUSY_MARKERS):
        return ProviderVerdict(BUSY, "Rate-limited or queueing right now", retryable=True, fatal=False)

    if any(m in text for m in _MISSING_MARKERS):
        return ProviderVerdict(UNAVAILABLE, "Not served by the provider", retryable=False, fatal=False)

    if any(m in text for m in _AUTH_MARKERS):
        return ProviderVerdict(
            UNAVAILABLE, "API key rejected by the provider", retryable=False, fatal=True
        )

    first_line = str(error).splitlines()[0][:200] if str(error).strip() else ""
    return ProviderVerdict(
        UNAVAILABLE, first_line or "Unknown provider error", retryable=False, fatal=False
    )
