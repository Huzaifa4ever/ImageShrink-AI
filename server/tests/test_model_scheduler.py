

from __future__ import annotations

import pytest

from app.services import model_scheduler, rate_limiter

from .conftest import FakeClock, bad_key_error, busy_error, missing_model_error


async def test_first_try_success_reports_no_fallback(clock: FakeClock):
    async def call(model: str) -> str:
        return f"ok:{model}"

    outcome = await model_scheduler.run_with_fallback("primary", call, candidates=["backup"])

    assert outcome.value == "ok:primary"
    assert outcome.model == "primary"
    assert outcome.fell_back is False
    assert outcome.attempts == []
    assert outcome.queued_ms == 0


async def test_retryable_failure_falls_back_to_the_next_model(clock: FakeClock):
    tried: list[str] = []

    async def call(model: str) -> str:
        tried.append(model)
        if model == "primary":
            raise busy_error()
        return f"ok:{model}"

    outcome = await model_scheduler.run_with_fallback("primary", call, candidates=["backup"])

    assert tried == ["primary", "backup"]
    assert outcome.model == "backup"
    assert outcome.fell_back is True

    assert len(outcome.attempts) == 1
    assert outcome.attempts[0].model == "primary"
    assert outcome.attempts[0].status == "busy"


async def test_a_rate_limited_model_is_left_cooling_down(clock: FakeClock):
    async def call(model: str) -> str:
        if model == "hot":
            raise busy_error()
        return "ok"

    await model_scheduler.run_with_fallback("hot", call, candidates=["cool"])

    assert await rate_limiter.wait_seconds("hot") == pytest.approx(30.0)


async def test_a_lone_throttled_model_ends_as_busy_not_unavailable(clock: FakeClock):
    async def call(model: str) -> str:
        raise busy_error()

    with pytest.raises(model_scheduler.ProviderBusy) as excinfo:
        await model_scheduler.run_with_fallback("only", call, candidates=[])

    assert excinfo.value.retry_after_seconds > 0
    # The attempts it did make are still reported, so the UI can explain the wait.
    assert [a.status for a in excinfo.value.attempts] == ["busy", "busy"]


async def test_missing_model_is_dropped_from_the_running(clock: FakeClock):
    tried: list[str] = []

    async def call(model: str) -> str:
        tried.append(model)
        if model == "retired":
            raise missing_model_error()
        return "ok"

    outcome = await model_scheduler.run_with_fallback("retired", call, candidates=["current"])

    assert outcome.model == "current"
    assert tried == ["retired", "current"]
    assert await rate_limiter.wait_seconds("retired") == pytest.approx(300.0)


async def test_a_rejected_api_key_stops_immediately_without_burning_quota(clock: FakeClock):
    tried: list[str] = []

    async def call(model: str) -> str:
        tried.append(model)
        raise bad_key_error()

    with pytest.raises(model_scheduler.ProviderUnavailable) as excinfo:
        await model_scheduler.run_with_fallback("a", call, candidates=["b", "c", "d"])
    assert tried == ["a"]
    assert "API key" in str(excinfo.value)


async def test_exhausted_quota_surfaces_as_busy_with_a_retry_after(clock: FakeClock):
    for _ in range(5):
        await rate_limiter.try_reserve("a")

    async def call(model: str) -> str:  
        raise AssertionError("should not have been called")

    with pytest.raises(model_scheduler.ProviderBusy) as excinfo:
        await model_scheduler.run_with_fallback("a", call, candidates=[])

    assert excinfo.value.retry_after_seconds == 60


async def test_attempts_stop_at_the_configured_maximum(clock: FakeClock):
    """A pool of always-busy models must not be retried forever."""
    calls = 0

    async def call(model: str) -> str:
        nonlocal calls
        calls += 1
        raise busy_error()

    with pytest.raises(model_scheduler.ProviderUnavailable):
        await model_scheduler.run_with_fallback(
            "a", call, candidates=["b", "c", "d", "e", "f", "g"]
        )

    assert calls == 4


async def test_waiting_for_a_slot_is_reported_as_queue_time(clock: FakeClock):
    """A caller that waited deserves to be told, so a slow analysis is explicable."""
    await rate_limiter.cool_down("a", 0.5)

    async def call(model: str) -> str:
        return "ok"

    outcome = await model_scheduler.run_with_fallback("a", call, candidates=[])

    assert outcome.model == "a"
    assert outcome.queued_ms == pytest.approx(550, abs=10)


async def test_success_after_a_fallback_still_consumes_only_one_slot_per_attempt(clock: FakeClock):
    async def call(model: str) -> str:
        if model == "a":
            raise busy_error()
        return "ok"

    await model_scheduler.run_with_fallback("a", call, candidates=["b"])

    snap = await rate_limiter.snapshot(["a", "b"])
    assert snap["a"]["remaining"] == 4
    assert snap["b"]["remaining"] == 4
