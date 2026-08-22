

from __future__ import annotations

import asyncio
import logging
import time

from app.core.config import get_settings
from app.services import provider, rate_limiter

logger = logging.getLogger(__name__)

_LABELS = {
    "openai/gpt-oss-120b": "OpenAI GPT-OSS 120B",
    "openai/gpt-oss-20b": "OpenAI GPT-OSS 20B",
    "qwen/qwen3.6-27b": "Qwen 3.6 27B",
    "llama-3.3-70b-versatile": "Llama 3.3 70B Versatile",
}

_catalog_cache: tuple[float, list[str]] | None = None
_probe_cache: dict[str, tuple[float, dict]] = {}
_lock = asyncio.Lock()


def _label_for(model_id: str) -> str:
    if model_id in _LABELS:
        return _LABELS[model_id]
    return " ".join(part.capitalize() for part in model_id.replace("_", "-").split("-"))


async def catalog_ids() -> list[str]:
    global _catalog_cache

    settings = get_settings()
    if _catalog_cache and _catalog_cache[0] > time.monotonic():
        return _catalog_cache[1]

    listing = await asyncio.wait_for(
        provider.get_client().models.list(),
        timeout=settings.MODEL_PROBE_TIMEOUT_SECONDS,
    )
    served = {m.id for m in listing.data if getattr(m, "id", None)}

    allowed = settings.model_allowlist
    if allowed:
        # Intersected, not substituted: an allowlisted model the provider has retired must
        # disappear rather than be offered as available. Allowlist order is preserved so the
        # picker is stable rather than alphabetical.
        ids = [model_id for model_id in allowed if model_id in served]
        missing = [model_id for model_id in allowed if model_id not in served]
        if missing:
            logger.warning("configured models not served by the provider: %s", ", ".join(missing))
    else:
        ids = sorted(served)

    _catalog_cache = (time.monotonic() + settings.MODEL_CATALOG_CACHE_SECONDS, ids)
    return ids


async def _probe_model(model_id: str) -> dict:
    """Send the smallest possible completion to see whether the model answers."""
    settings = get_settings()

    cached = _probe_cache.get(model_id)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    quota_wait = await rate_limiter.try_reserve(model_id)
    if quota_wait > 0:
        return {
            "status": provider.BUSY,
            "reason": f"Per-minute quota already used - a slot frees up in {round(quota_wait)}s",
            "latencyMs": None,
        }

    started = time.monotonic()
    try:
        await asyncio.wait_for(
            provider.get_client().chat.completions.create(
                model=model_id,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=16,
                temperature=0,
            ),
            timeout=settings.MODEL_PROBE_TIMEOUT_SECONDS,
        )
        result = {"status": provider.AVAILABLE, "reason": "", "latencyMs": None}
    except Exception as e:  
        verdict = provider.classify_error(e)
        logger.info("model probe %s -> %s (%s)", model_id, verdict.status, verdict.reason)
        result = {"status": verdict.status, "reason": verdict.reason, "latencyMs": None}
        await rate_limiter.cool_down(
            model_id,
            settings.MODEL_COOLDOWN_SECONDS
            if verdict.retryable
            else settings.MODEL_UNAVAILABLE_COOLDOWN_SECONDS,
        )

    result["latencyMs"] = round((time.monotonic() - started) * 1000)
    _probe_cache[model_id] = (time.monotonic() + settings.MODEL_HEALTH_CACHE_SECONDS, result)
    return result


async def list_models(probe: bool = False) -> dict:
    """Catalog of selectable models, optionally with a live health check on each."""
    settings = get_settings()

    if not settings.GROQ_API_KEY:
        return {
            "models": [],
            "default": settings.GROQ_MODEL,
            "probed": False,
            "requestsPerMinute": settings.MODEL_REQUESTS_PER_MINUTE,
            "windowSeconds": settings.MODEL_RATE_WINDOW_SECONDS,
            "error": "No GROQ_API_KEY configured, so no model can be reached.",
        }

    async with _lock:
        try:
            catalog = await catalog_ids()
        except Exception as e:  # noqa: BLE001
            logger.warning("model catalog unreachable: %s", e)
            return {
                "models": [],
                "default": settings.GROQ_MODEL,
                "probed": False,
                "requestsPerMinute": settings.MODEL_REQUESTS_PER_MINUTE,
                "windowSeconds": settings.MODEL_RATE_WINDOW_SECONDS,
                "error": f"Could not reach the AI provider: {provider.classify_error(e).reason}",
            }

        if probe:
            probes = await asyncio.gather(*(_probe_model(m) for m in catalog))
        else:
            probes = [{"status": provider.UNKNOWN, "reason": "", "latencyMs": None}] * len(catalog)

    quota = await rate_limiter.snapshot(catalog)

    models = [
        {
            "id": model_id,
            "label": _label_for(model_id),
            "isDefault": model_id == settings.GROQ_MODEL,
            "quota": quota[model_id],
            **result,
        }
        for model_id, result in zip(catalog, probes)
    ]
    order = {provider.AVAILABLE: 0, provider.UNKNOWN: 1, provider.BUSY: 2, provider.UNAVAILABLE: 3}
    models.sort(key=lambda m: (order.get(m["status"], 4), not m["isDefault"], m["label"]))

    return {
        "models": models,
        "default": settings.GROQ_MODEL,
        "probed": probe,
        "requestsPerMinute": settings.MODEL_REQUESTS_PER_MINUTE,
        "windowSeconds": settings.MODEL_RATE_WINDOW_SECONDS,
        "error": None,
    }


async def is_servable(model_id: str) -> bool:
    """Whether the provider currently lists this model. True if the catalog is down."""
    try:
        return model_id in await catalog_ids()
    except Exception: 
        return True
