

from __future__ import annotations

import json
import logging
import textwrap
from dataclasses import dataclass, field

from app.core.config import get_settings
from app.services import model_scheduler, provider

logger = logging.getLogger(__name__)

MAX_CONTEXT_CHARS = 4_000

MAX_DOCKERFILE_CHARS = 24_000

_DEFAULT_ORIGINAL_MB = 850
_DEFAULT_OPTIMIZED_MB = 120


@dataclass
class AnalysisContext:

    dockerignore: str | None = None
    package_json: str | None = None
    docker_history: str | None = None
    image_metadata: str | None = None
    bloat_candidates: list[str] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not any(
            [
                self.dockerignore,
                self.package_json,
                self.docker_history,
                self.image_metadata,
                self.bloat_candidates,
            ]
        )


def _clip(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n… [truncated, {len(text) - limit} more characters]"


def _context_block(ctx: AnalysisContext | None) -> str:
    if ctx is None or ctx.is_empty():
        return ""

    parts: list[str] = ["\n    Additional project context (use it - do not restate it):\n"]

    if ctx.dockerignore:
        parts.append(f"    Existing .dockerignore:\n    ```\n{_clip(ctx.dockerignore, MAX_CONTEXT_CHARS)}\n    ```\n")
    else:
        parts.append(
            "    There is NO .dockerignore in this project. If the Dockerfile copies the "
            "build context, say so and propose one.\n"
        )

    if ctx.package_json:
        parts.append(f"    package.json:\n    ```json\n{_clip(ctx.package_json, MAX_CONTEXT_CHARS)}\n    ```\n")
    if ctx.docker_history:
        parts.append(f"    docker history for the built image:\n    ```\n{_clip(ctx.docker_history, MAX_CONTEXT_CHARS)}\n    ```\n")
    if ctx.image_metadata:
        parts.append(f"    Image metadata:\n    ```\n{_clip(ctx.image_metadata, MAX_CONTEXT_CHARS)}\n    ```\n")
    if ctx.bloat_candidates:
        listed = ", ".join(ctx.bloat_candidates[:40])
        parts.append(f"    Workspace paths that would bloat the build context: {listed}\n")

    return "".join(parts)


def _build_prompt(dockerfile_content: str, ctx: AnalysisContext | None = None) -> str:
    return textwrap.dedent(f"""
    You are an expert DevOps engineer specializing in Docker image optimization.

    Analyze the following Dockerfile and return a JSON object with exactly these keys:

    {{
      "optimized_dockerfile": "<the fully refactored Dockerfile as a string>",
      "ai_insights": "<2-3 sentence summary of the main optimizations made>",
      "layer_optimizations": [
        {{
          "before": "<original command>",
          "after": "<optimized command>",
          "saved_bytes": <estimated bytes saved as integer>,
          "reason": "<why this change reduces size>"
        }}
      ],
      "estimated_original_size_mb": <integer>,
      "estimated_optimized_size_mb": <integer>,
      "optimization_score": <integer 0-100, how well optimized the ORIGINAL Dockerfile is>,
      "performance_score": <integer 0-100, build speed and layer cache efficiency of the ORIGINAL>,
      "security_notes": ["<security problem in the original, one per entry>"],
      "dockerignore_suggestions": ["<glob pattern that belongs in .dockerignore>"],
      "confidence": <integer 0-100, your confidence in these estimates>
    }}

    Optimization rules you MUST apply:
    1. Convert to multi-stage build (builder stage -> distroless or alpine final stage).
    2. Combine RUN commands with && to minimize layers.
    3. Strip development dependencies (devDependencies, build tools, compilers) from the final stage.
    4. Use --no-cache, --no-install-recommends, --no-cache-dir where applicable.
    5. Use specific pinned versions for base images (never :latest).
    6. Order instructions so that rarely-changing layers come first, for cache reuse.
    7. Prefer distroless/static for Go, distroless/nodejs for Node.js, python:3.12-alpine for Python.
    8. Run as a non-root USER in the final stage.

    Scoring guidance: a Dockerfile that already follows every rule above scores 90+. One
    with a fat base image, no multi-stage build and unpinned tags scores under 30.
    {_context_block(ctx)}
    Dockerfile to optimize:
    ```dockerfile
    {_clip(dockerfile_content, MAX_DOCKERFILE_CHARS)}
    ```

    Return ONLY valid JSON. No markdown fences. No extra text.
    """).strip()


def _extract_json(raw: str) -> dict:
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in AI response")

    candidate = raw[start : end + 1]
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as e:
        raise ValueError(f"AI response was not valid JSON: {e}") from e

    if not isinstance(parsed, dict):
        raise ValueError("AI response JSON was not an object")
    return parsed


def _as_int(value: object, default: int, *, low: int, high: int) -> int:
    """Coerce a model-supplied number, tolerating "120", "120 MB" and 120.5."""
    if isinstance(value, bool): 
        return default
    if isinstance(value, (int, float)):
        n = int(value)
    elif isinstance(value, str):
        digits = "".join(c for c in value.strip() if c.isdigit() or c == "-")
        if not digits or digits == "-":
            return default
        try:
            n = int(digits)
        except ValueError:
            return default
    else:
        return default
    return max(low, min(high, n))


def _as_str_list(value: object, limit: int = 40) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value[:limit]:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
        elif isinstance(item, dict):
            for key in ("text", "note", "description", "title", "message"):
                if isinstance(item.get(key), str) and item[key].strip():
                    out.append(item[key].strip())
                    break
    return out


def _normalize_layer_optimizations(value: object, limit: int = 40) -> list[dict]:
    if not isinstance(value, list):
        return []
    out: list[dict] = []
    for item in value[:limit]:
        if not isinstance(item, dict):
            continue
        before = item.get("before")
        after = item.get("after")
        if not isinstance(before, str) or not isinstance(after, str):
            continue
        out.append(
            {
                "before": before.strip(),
                "after": after.strip(),
                "savedBytes": _as_int(
                    item.get("saved_bytes", item.get("savedBytes")),
                    0,
                    low=0,
                    high=50 * 1024**3,
                ),
                "reason": item.get("reason", "").strip() if isinstance(item.get("reason"), str) else "",
            }
        )
    return out


def _normalize(raw: dict) -> dict:
    """Coerce a model response into the exact shape the rest of the app expects."""
    optimized = raw.get("optimized_dockerfile")
    if not isinstance(optimized, str):
        optimized = ""

    insights = raw.get("ai_insights")
    if not isinstance(insights, str):
        insights = ""

    original_mb = _as_int(
        raw.get("estimated_original_size_mb"), _DEFAULT_ORIGINAL_MB, low=1, high=100_000
    )
    optimized_mb = _as_int(
        raw.get("estimated_optimized_size_mb"), _DEFAULT_OPTIMIZED_MB, low=1, high=100_000
    )
    if optimized_mb > original_mb:
        logger.info(
            "AI reported optimized (%s MB) larger than original (%s MB) - clamping",
            optimized_mb,
            original_mb,
        )
        optimized_mb = original_mb

    return {
        "optimized_dockerfile": optimized.strip(),
        "ai_insights": insights.strip(),
        "layer_optimizations": _normalize_layer_optimizations(raw.get("layer_optimizations")),
        "estimated_original_size_mb": original_mb,
        "estimated_optimized_size_mb": optimized_mb,
        "optimization_score": _as_int(raw.get("optimization_score"), 50, low=0, high=100),
        "performance_score": _as_int(raw.get("performance_score"), 50, low=0, high=100),
        "security_notes": _as_str_list(raw.get("security_notes")),
        "dockerignore_suggestions": _as_str_list(raw.get("dockerignore_suggestions")),
        "confidence": _as_int(raw.get("confidence"), 70, low=0, high=100),
    }


async def optimize_dockerfile(
    content: str,
    model: str | None = None,
    context: AnalysisContext | None = None,
) -> model_scheduler.Outcome[dict]:
    settings = get_settings()
    prompt = _build_prompt(content, context)
    primary = (model or "").strip() or settings.CEREBRAS_MODEL

    async def call(selected_model: str) -> dict:
        response = await provider.get_client().chat.completions.create(
            model=selected_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a Docker optimization expert. You always respond with "
                        "valid JSON only, no markdown."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=4096,
        )

        choices = response.choices or []
        raw = (choices[0].message.content or "").strip() if choices else ""
        if not raw:
            raise ValueError("AI returned an empty response")
        return _normalize(_extract_json(raw))

    return await model_scheduler.run_with_fallback(primary, call)
