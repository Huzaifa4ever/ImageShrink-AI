"""Per-model request quota, shared across processes via MongoDB.

The provider's quota is per API key, not per process, so an in-memory counter would let N
replicas each send the full allowance. Timestamps are wall-clock, not monotonic, because
monotonic clocks are only comparable inside one process.
"""

from __future__ import annotations

import asyncio
import time

from pymongo import ReturnDocument

from app.core.config import get_settings
from app.core.database import get_db

PREFERENCE_TOLERANCE_SECONDS = 1.0

COLLECTION = "modelQuota"


class AllModelsBusy(Exception):
    """No candidate has a free slot within the caller's wait budget."""

    def __init__(self, retry_after_seconds: float) -> None:
        self.retry_after_seconds = max(1, round(retry_after_seconds))
        super().__init__(
            "Every available model has used its per-minute quota. The next free slot is "
            f"about {self.retry_after_seconds}s away."
        )


def _collection():
    return get_db()[COLLECTION]


def _limits() -> tuple[int, float]:
    settings = get_settings()
    return max(1, settings.MODEL_REQUESTS_PER_MINUTE), float(settings.MODEL_RATE_WINDOW_SECONDS)


def _wait_from(doc: dict | None, now: float, capacity: int, window: float) -> float:
    """Seconds until this model can take another request. 0.0 means right now."""
    if not doc:
        return 0.0

    hits = sorted(h for h in doc.get("hits", []) if now - h < window)
    cooling = max(0.0, (doc.get("cooldownUntil") or 0.0) - now)

    if len(hits) < capacity:
        return cooling
    return max(cooling, window - (now - hits[0]))


async def _load(models: list[str]) -> dict[str, dict]:
    cursor = _collection().find({"_id": {"$in": models}})
    return {doc["_id"]: doc async for doc in cursor}


async def try_reserve(model: str) -> float:
    """Claim a slot. Returns 0.0 on success, else the seconds to wait. Never blocks."""
    capacity, window = _limits()
    now = time.time()
    col = _collection()

    # Drop expired hits first so the size check below reflects the live window. Pruning is
    # idempotent, so it does not need to share a transaction with the claim.
    await col.update_one(
        {"_id": model}, {"$pull": {"hits": {"$lte": now - window}}}, upsert=True
    )

    # The claim itself must be atomic, or two replicas both see room and both take it.
    # "hits.<capacity-1> does not exist" is how you ask for "fewer than capacity elements"
    # in a query filter — the whole find-and-update is one server-side operation.
    claimed = await col.find_one_and_update(
        {
            "_id": model,
            f"hits.{capacity - 1}": {"$exists": False},
            "$or": [
                {"cooldownUntil": {"$exists": False}},
                {"cooldownUntil": None},
                {"cooldownUntil": {"$lte": now}},
            ],
        },
        {"$push": {"hits": now}},
        return_document=ReturnDocument.AFTER,
    )
    if claimed is not None:
        return 0.0

    return _wait_from(await col.find_one({"_id": model}), now, capacity, window)


async def wait_seconds(model: str) -> float:
    """Seconds until ``model`` could take a request. Claims nothing."""
    capacity, window = _limits()
    doc = await _collection().find_one({"_id": model})
    return _wait_from(doc, time.time(), capacity, window)


async def cool_down(model: str, seconds: float) -> None:
    """Skip ``model`` for a while — it just failed, or is known to be rate-limited."""
    # $max keeps the furthest-out deadline, so a short cooldown cannot shorten a long one
    # another replica already recorded.
    await _collection().update_one(
        {"_id": model}, {"$max": {"cooldownUntil": time.time() + seconds}}, upsert=True
    )


async def reserve(candidates: list[str], deadline: float) -> tuple[str, float]:

    if not candidates:
        raise AllModelsBusy(0)

    capacity, window = _limits()
    waited = 0.0

    while True:
        now = time.time()
        docs = await _load(candidates)
        ranked = sorted(
            (
                (_wait_from(docs.get(m), now, capacity, window), i, m)
                for i, m in enumerate(candidates)
            ),
            key=lambda t: (int(t[0] // PREFERENCE_TOLERANCE_SECONDS), t[1]),
        )
        best_wait, _, best_model = ranked[0]

        if best_wait <= 0:
            if await try_reserve(best_model) <= 0:
                return best_model, waited
            # Another replica took the slot between the read and the claim. Re-rank rather
            # than assuming the next candidate is free.
            nap = 0.05
            await asyncio.sleep(nap)
            waited += nap
            continue

        soonest = min(w for w, _, _ in ranked)
        remaining = deadline - time.monotonic()

        target = best_wait if best_wait <= remaining else soonest
        if remaining <= 0 or target > remaining:
            raise AllModelsBusy(soonest)

        nap = min(target, remaining) + 0.05
        await asyncio.sleep(nap)
        waited += nap


async def snapshot(models: list[str]) -> dict[str, dict]:
    """Remaining quota per model, for the workbench and the extension status bar."""
    capacity, window = _limits()
    empty = {"remaining": capacity, "capacity": capacity, "resetInSeconds": 0}

    try:
        docs = await _load(models)
    except Exception:
        # Display-only. A quota panel is not worth failing the whole models endpoint over.
        return {model: dict(empty) for model in models}

    now = time.time()
    out: dict[str, dict] = {}
    for model in models:
        doc = docs.get(model)
        if not doc:
            out[model] = dict(empty)
            continue
        live = [h for h in doc.get("hits", []) if now - h < window]
        out[model] = {
            "remaining": max(0, capacity - len(live)),
            "capacity": capacity,
            "resetInSeconds": round(_wait_from(doc, now, capacity, window)),
        }
    return out


async def reset() -> None:
    """Drop all counters. For tests only."""
    await _collection().delete_many({})
