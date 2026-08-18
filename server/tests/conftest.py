
from __future__ import annotations

import os
import types

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import get_settings
from app.services import (
    auth_service,
    email_token_service,
    model_scheduler,
    rate_limiter,
    session_service,
)

# The quota counters live in MongoDB, so these tests need a real one — the atomic
# find-and-update they depend on is exactly the thing a fake would not reproduce. Point
# MONGO_TEST_URI at any throwaway instance; never at the database the app actually uses.
TEST_URI = os.environ.get("MONGO_TEST_URI", "mongodb://localhost:27017")
TEST_DB = os.environ.get("MONGO_TEST_DB", "imageshrink_ai_test")


class FakeClock:
    """A clock the test drives by hand. Stands in for both wall and monotonic time."""

    def __init__(self, start: float = 10_000.0) -> None:
        self.now = start
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def time(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


#: Whether MongoDB answered, decided once per session. Without this every skipped test paid its
#: own connection timeout — 48 tests times three seconds is two and a half minutes of waiting to
#: be told the same thing 48 times.
_reachable: bool | None = None

_START_HINT = (
    "Start one with: docker run -d --rm --name imageshrink-test-mongo -p 27017:27017 mongo:7"
)


@pytest.fixture
async def mongo(monkeypatch: pytest.MonkeyPatch):
    """A scratch database for tests that need real MongoDB. Skips if none is reachable."""
    global _reachable

    if _reachable is False:
        pytest.skip(f"no MongoDB at {TEST_URI}. {_START_HINT}")

    client = AsyncIOMotorClient(TEST_URI, serverSelectionTimeoutMS=2000)
    try:
        await client.admin.command("ping")
        _reachable = True
    except Exception as exc:
        _reachable = False
        client.close()
        pytest.skip(f"no MongoDB at {TEST_URI} ({type(exc).__name__}). {_START_HINT}")

    # These modules did `from app.core.database import get_db`, which binds the name locally —
    # so patching app.core.database would not reach them. Patch each importer.
    for module in (rate_limiter, auth_service, email_token_service, session_service):
        monkeypatch.setattr(module, "get_db", lambda: client[TEST_DB])

    try:
        yield client[TEST_DB]
    finally:
        for name in ("users", "emailTokens", "sessions", "modelQuota"):
            await client[TEST_DB][name].delete_many({})
        client.close()


@pytest.fixture
async def clock(monkeypatch: pytest.MonkeyPatch, mongo) -> FakeClock:  # type: ignore
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

    await rate_limiter.reset()
    try:
        yield fake
    finally:
        await rate_limiter.reset()
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
