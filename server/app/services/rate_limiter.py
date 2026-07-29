
from __future__ import annotations

import asyncio
import time
from collections import deque

from app.core.config import get_settings

PREFERENCE_TOLERANCE_SECONDS = 1.0


class AllModelsBusy(Exception):
    """No candidate has a free slot within the caller's wait budget."""

    def __init__(self, retry_after_seconds: float) -> None:
        self.retry_after_seconds = max(1, round(retry_after_seconds))
        super().__init__(
            "Every available model has used its per-minute quota. The next free slot is "
            f"about {self.retry_after_seconds}s away."
        )


class _Window:
    """Sliding-window request counter plus a cooldown, for one model."""

    def __init__(self, capacity: int, window_seconds: float) -> None:
        self.capacity = max(1, capacity)
        self.window = window_seconds
        self._hits: deque[float] = deque()
        self._cooldown_until = 0.0

    def _prune(self, now: float) -> None:
        while self._hits and now - self._hits[0] >= self.window:
            self._hits.popleft()

    def wait_seconds(self, now: float) -> float:
        """Seconds until this model can take another request. 0.0 means right now."""
        self._prune(now)
        cooling = max(0.0, self._cooldown_until - now)
        if len(self._hits) < self.capacity:
            return cooling
        return max(cooling, self.window - (now - self._hits[0]))

    def remaining(self, now: float) -> int:
        self._prune(now)
        return max(0, self.capacity - len(self._hits))

    def record(self, now: float) -> None:
        self._hits.append(now)

    def cool_down(self, now: float, seconds: float) -> None:
        self._cooldown_until = max(self._cooldown_until, now + seconds)


_windows: dict[str, _Window] = {}


def _window(model: str) -> _Window:
    existing = _windows.get(model)
    if existing is None:
        settings = get_settings()
        existing = _Window(settings.MODEL_REQUESTS_PER_MINUTE, settings.MODEL_RATE_WINDOW_SECONDS)
        _windows[model] = existing
    return existing


def try_reserve(model: str) -> float:
    now = time.monotonic()
    wait = _window(model).wait_seconds(now)
    if wait <= 0:
        _window(model).record(now)
        return 0.0
    return wait


def wait_seconds(model: str) -> float:
    """Seconds until ``model`` could take a request. Claims nothing."""
    return _window(model).wait_seconds(time.monotonic())


def cool_down(model: str, seconds: float) -> None:
    """Skip ``model`` for a while — it just failed, or is known to be rate-limited."""
    _window(model).cool_down(time.monotonic(), seconds)


async def reserve(candidates: list[str], deadline: float) -> tuple[str, float]:

    if not candidates:
        raise AllModelsBusy(0)

    waited = 0.0
    while True:
        now = time.monotonic()
        ranked = sorted(
            ((_window(m).wait_seconds(now), i, m) for i, m in enumerate(candidates)),
            key=lambda t: (int(t[0] // PREFERENCE_TOLERANCE_SECONDS), t[1]),
        )
        best_wait, _, best_model = ranked[0]
        if best_wait <= 0:
            _window(best_model).record(now)
            return best_model, waited

        soonest = min(w for w, _, _ in ranked)
        remaining = deadline - now

        target = best_wait if best_wait <= remaining else soonest
        if remaining <= 0 or target > remaining:
            raise AllModelsBusy(soonest)

        nap = min(target, remaining) + 0.05
        await asyncio.sleep(nap)
        waited += nap


def snapshot(models: list[str]) -> dict[str, dict]:
    """Remaining quota per model, for the workbench and the extension status bar."""
    now = time.monotonic()
    capacity = get_settings().MODEL_REQUESTS_PER_MINUTE
    out: dict[str, dict] = {}
    for model in models:
        existing = _windows.get(model)
        if existing is None:
            out[model] = {"remaining": capacity, "capacity": capacity, "resetInSeconds": 0}
        else:
            out[model] = {
                "remaining": existing.remaining(now),
                "capacity": existing.capacity,
                "resetInSeconds": round(existing.wait_seconds(now)),
            }
    return out


def reset() -> None:
    """Drop all counters. For tests only."""
    _windows.clear()
