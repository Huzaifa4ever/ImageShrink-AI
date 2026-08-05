
from __future__ import annotations

import types

import pytest

from app.core.config import get_settings
from app.services import model_scheduler, rate_limiter


class FakeClock:
    """A monotonic clock the test drives by hand."""

    def __init__(self, start: float = 10_000.0) -> None:
        self.now = start
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> FakeClock: # type: ignore
    # Pin the quota settings so the assertions below don't depend on the developer's .env.
    monkeypatch.setenv("MODEL_REQUESTS_PER_MINUTE", "5")
    monkeypatch.setenv("MODEL_RATE_WINDOW_SECONDS", "60")
    monkeypatch.setenv("MODEL_MAX_QUEUE_WAIT_SECONDS", "45")
    monkeypatch.setenv("MODEL_COOLDOWN_SECONDS", "30")
    monkeypatch.setenv("MODEL_UNAVAILABLE_COOLDOWN_SECONDS", "300")
    monkeypatch.setenv("MODEL_MAX_ATTEMPTS", "4")
    monkeypatch.setenv("MODEL_MAX_CANDIDATES", "5")
    monkeypatch.setenv("MODEL_FALLBACK_CHAIN", "")
    get_settings.cache_clear()

    fake = FakeClock()

    async def fake_sleep(seconds: float) -> None:
        fake.slept.append(seconds)
        fake.advance(seconds)

    monkeypatch.setattr(rate_limiter, "time", fake)
    monkeypatch.setattr(rate_limiter, "asyncio", types.SimpleNamespace(sleep=fake_sleep))
    monkeypatch.setattr(model_scheduler, "time", fake)

    rate_limiter.reset()
    try:
        yield fake
    finally:
        rate_limiter.reset()
        get_settings.cache_clear()


def busy_error() -> Exception:
    """A provider error that means "come back shortly"."""
    return RuntimeError("429 Too Many Requests: model is queueing")


def missing_model_error() -> Exception:
    """A provider error that means "this model is not served"."""
    return RuntimeError("404 not_found: no such model")


def bad_key_error() -> Exception:
    """A provider error that dooms every model equally."""
    return RuntimeError("401 invalid_api_key: authentication failed")
