"""Confirm the configured AI provider and models are reachable.

Run this after pasting your API key into server/.env. It lists what the provider actually
serves right now and health-checks the models the app is configured to use, so a typo in a
model id shows up here rather than as a failed analysis later.

    cd server && PYTHONPATH=. ./venv/bin/python scripts/check_models.py
"""

import asyncio
import sys

from app.core.config import get_settings
from app.services.model_registry import list_models


async def main() -> int:
    settings = get_settings()

    print(f"endpoint : {settings.GROQ_BASE_URL}")
    print(f"default  : {settings.GROQ_MODEL}")
    print(f"fallback : {', '.join(settings.model_fallback_list) or '(derived from the catalog)'}")
    print(f"quota    : {settings.MODEL_REQUESTS_PER_MINUTE} requests/minute per model\n")

    if not settings.GROQ_API_KEY:
        print("GROQ_API_KEY is empty. Paste your key into server/.env and run this again.")
        return 1

    result = await list_models(probe=True)

    if result["error"]:
        print(f"FAILED: {result['error']}")
        return 1

    served = {m["id"] for m in result["models"]}
    print(f"{len(served)} models served by the provider:\n")
    for model in result["models"]:
        mark = {"available": "ok  ", "busy": "busy", "unavailable": "down", "unknown": "?   "}
        note = f"  ({model['reason']})" if model["reason"] else ""
        default = "  <- default" if model["isDefault"] else ""
        print(f"  [{mark.get(model['status'], '?')}] {model['id']}{note}{default}")

    configured = [settings.GROQ_MODEL, *settings.model_fallback_list]
    missing = [m for m in dict.fromkeys(configured) if m and m not in served]

    if missing:
        print("\nConfigured but NOT served by the provider:")
        for model in missing:
            print(f"  - {model}")
        print("\nFix the id in server/.env, or remove it from MODEL_FALLBACK_CHAIN.")
        return 1

    print("\nEvery configured model is served.")
    return 0


sys.exit(asyncio.run(main()))
