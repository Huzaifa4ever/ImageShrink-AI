
from __future__ import annotations

import pytest

from app.services import rate_limiter

from .conftest import FakeClock


def test_try_reserve_allows_exactly_the_capacity(clock: FakeClock):
    for i in range(5):
        assert rate_limiter.try_reserve("m") == 0.0, f"request {i + 1} should fit in the window"

    wait = rate_limiter.try_reserve("m")
    assert wait == pytest.approx(60.0)


def test_try_reserve_claims_nothing_when_it_reports_a_wait(clock: FakeClock):
    for _ in range(5):
        rate_limiter.try_reserve("m")

    for _ in range(3):
        assert rate_limiter.try_reserve("m") == pytest.approx(60.0)

    clock.advance(60)
    assert rate_limiter.try_reserve("m") == 0.0


def test_slots_free_up_as_the_window_slides(clock: FakeClock):
    for _ in range(5):
        rate_limiter.try_reserve("m")
    assert rate_limiter.wait_seconds("m") == pytest.approx(60.0)

    clock.advance(30)
    assert rate_limiter.wait_seconds("m") == pytest.approx(30.0)

    clock.advance(31)
    assert rate_limiter.wait_seconds("m") == 0.0
    assert rate_limiter.try_reserve("m") == 0.0


def test_snapshot_reports_remaining_quota(clock: FakeClock):
    rate_limiter.try_reserve("used")
    rate_limiter.try_reserve("used")

    snap = rate_limiter.snapshot(["used", "untouched"])

    assert snap["used"] == {"remaining": 3, "capacity": 5, "resetInSeconds": 0}
    # A model nobody has called yet should report a full window, not be missing.
    assert snap["untouched"] == {"remaining": 5, "capacity": 5, "resetInSeconds": 0}


def test_cool_down_makes_a_model_wait_even_with_quota_left(clock: FakeClock):
    assert rate_limiter.wait_seconds("m") == 0.0
    rate_limiter.cool_down("m", 20)
    assert rate_limiter.wait_seconds("m") == pytest.approx(20.0)

    clock.advance(20)
    assert rate_limiter.wait_seconds("m") == 0.0


async def test_reserve_prefers_the_first_candidate_when_both_are_free(clock: FakeClock):
    model, waited = await rate_limiter.reserve(["preferred", "other"], clock.now + 45)

    assert model == "preferred"
    assert waited == 0.0


async def test_reserve_falls_back_to_a_free_model_when_the_first_is_exhausted(clock: FakeClock):
    for _ in range(5):
        rate_limiter.try_reserve("exhausted")

    model, waited = await rate_limiter.reserve(["exhausted", "fresh"], clock.now + 45)

    assert model == "fresh"
    assert waited == 0.0


async def test_reserve_waits_out_a_short_delay_on_the_preferred_model(clock: FakeClock):
    rate_limiter.cool_down("preferred", 0.4)

    model, waited = await rate_limiter.reserve(["preferred", "other"], clock.now + 45)

    assert model == "preferred"
    assert clock.slept == [pytest.approx(0.45)]
    assert waited == pytest.approx(0.45)


async def test_reserve_skips_a_preferred_model_delayed_beyond_the_tolerance(clock: FakeClock):
    rate_limiter.cool_down("preferred", 30)

    model, _ = await rate_limiter.reserve(["preferred", "other"], clock.now + 45)

    assert model == "other"
    assert clock.slept == []


async def test_reserve_raises_when_every_candidate_is_out_of_budget(clock: FakeClock):
    for name in ("a", "b"):
        for _ in range(5):
            rate_limiter.try_reserve(name)

    with pytest.raises(rate_limiter.AllModelsBusy) as excinfo:
        await rate_limiter.reserve(["a", "b"], clock.now + 45)

    # The caller needs a Retry-After it can pass on to the client.
    assert excinfo.value.retry_after_seconds == 60


async def test_reserve_does_not_overadmit_under_concurrency(clock: FakeClock):
    import asyncio

    async def attempt():
        try:
            return await rate_limiter.reserve(["m"], clock.now + 45)
        except rate_limiter.AllModelsBusy:
            return None

    results = await asyncio.gather(*(attempt() for _ in range(10)))

    granted = [r for r in results if r is not None]
    assert len(granted) == 5
    assert rate_limiter.wait_seconds("m") > 0
