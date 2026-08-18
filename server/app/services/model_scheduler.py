

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Generic, TypeVar

from app.core.config import get_settings
from app.services import model_registry, provider, rate_limiter

logger = logging.getLogger(__name__)

T = TypeVar("T")


class SchedulerError(Exception):

    def __init__(self, message: str, attempts: list["Attempt"] | None = None) -> None:
        super().__init__(message)
        self.attempts = attempts or []


class ProviderBusy(SchedulerError):

    def __init__(self, message: str, retry_after_seconds: float, attempts=None) -> None:
        super().__init__(message, attempts)
        self.retry_after_seconds = max(1, round(retry_after_seconds))


class ProviderUnavailable(SchedulerError):

    def __init__(self, message: str, attempts=None) -> None:
        super().__init__(message, attempts)
@dataclass
class Attempt:

    model: str
    status: str
    reason: str
    waited_ms: int

    def to_dict(self) -> dict:
        return {
            "model": self.model,
            "status": self.status,
            "reason": self.reason,
            "waitedMs": self.waited_ms,
        }


@dataclass
class Outcome(Generic[T]):

    value: T
    model: str
    fell_back: bool
    attempts: list[Attempt] = field(default_factory=list)
    #: Time spent waiting for a rate-limit slot, excluding the call itself.
    queued_ms: int = 0

    def to_dict(self) -> dict:
        return {
            "model": self.model,
            "fellBack": self.fell_back,
            "queuedMs": self.queued_ms,
            "attempts": [a.to_dict() for a in self.attempts],
        }


def _dedupe(models: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for m in models:
        m = (m or "").strip()
        if m and m not in seen:
            seen.add(m)
            ordered.append(m)
    return ordered


async def _resolve_candidates(primary: str, override: list[str] | None) -> list[str]:
    settings = get_settings()

    if override is not None:
        chain = _dedupe([primary, *override])
    elif settings.model_fallback_list:
        chain = _dedupe([primary, *settings.model_fallback_list])
    else:
        try:
            chain = _dedupe([primary, *await model_registry.catalog_ids()])
        except Exception as e: 
            logger.warning("scheduler: catalog unavailable for fallback (%s)", e)
            chain = [primary]

    return chain[: max(1, settings.MODEL_MAX_CANDIDATES)]


async def run_with_fallback(
    primary: str,
    call: Callable[[str], Awaitable[T]],
    *,
    candidates: list[str] | None = None,
) -> Outcome[T]:
    settings = get_settings()
    chain = await _resolve_candidates(primary, candidates)
    deadline = time.monotonic() + settings.MODEL_MAX_QUEUE_WAIT_SECONDS

    eligible = list(chain)
    attempts: list[Attempt] = []
    queued = 0.0

    for _ in range(max(1, settings.MODEL_MAX_ATTEMPTS)):
        if not eligible:
            break

        try:
            model, waited = await rate_limiter.reserve(eligible, deadline)
        except rate_limiter.AllModelsBusy as busy:
            raise ProviderBusy(str(busy), busy.retry_after_seconds, attempts) from busy
        queued += waited

        try:
            value = await call(model)
        except Exception as e: 
            verdict = provider.classify_error(e)
            attempts.append(
                Attempt(model, verdict.status, verdict.reason, round(waited * 1000))
            )
            logger.info(
                "scheduler: %s failed (%s: %s)%s",
                model,
                verdict.status,
                verdict.reason,
                "" if verdict.fatal else " - trying next candidate",
            )

            await rate_limiter.cool_down(
                model,
                settings.MODEL_COOLDOWN_SECONDS
                if verdict.retryable
                else settings.MODEL_UNAVAILABLE_COOLDOWN_SECONDS,
            )

            if verdict.fatal:
                raise ProviderUnavailable(verdict.reason, attempts) from e

            if not verdict.retryable:
                eligible = [m for m in eligible if m != model]
            continue

        return Outcome(
            value=value,
            model=model,
            fell_back=model != primary,
            attempts=attempts,
            queued_ms=round(queued * 1000),
        )

    reason = attempts[-1].reason if attempts else "No model could serve the request"
    raise ProviderUnavailable(reason, attempts)
