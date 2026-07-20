

from __future__ import annotations

import json
import textwrap

from openai import AsyncOpenAI

from app.core.config import get_settings

settings = get_settings()

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=settings.CEREBRAS_API_KEY,
            base_url=settings.CEREBRAS_BASE_URL,
        )
    return _client


def _build_prompt(dockerfile_content: str) -> str:
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
      "estimated_optimized_size_mb": <integer>
    }}

    Optimization rules you MUST apply:
    1. Convert to multi-stage build (builder stage → distroless or alpine final stage).
    2. Combine RUN commands with && to minimize layers.
    3. Strip development dependencies (devDependencies, build tools, compilers) from the final stage.
    4. Use --no-cache, --no-install-recommends, --no-cache-dir where applicable.
    5. Use specific pinned versions for base images (never :latest).
    6. Add .dockerignore-friendly COPY patterns.
    7. Prefer distroless/static for Go, distroless/nodejs for Node.js, python:3.12-alpine for Python.

    Dockerfile to optimize:
    ```dockerfile
    {dockerfile_content}
    ```

    Return ONLY valid JSON. No markdown fences. No extra text.
    """).strip()


async def optimize_dockerfile(content: str, model: str = None) -> dict:
    client = _get_client()
    prompt = _build_prompt(content)
    
    selected_model = model if model else settings.CEREBRAS_MODEL

    response = await client.chat.completions.create(
        model=selected_model,
        messages=[
            {
                "role": "system",
                "content": "You are a Docker optimization expert. You always respond with valid JSON only, no markdown.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        temperature=0.3,
        max_tokens=4096,
    )

    raw = response.choices[0].message.content.strip()

    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1:
        raw = raw[start:end+1]

    return json.loads(raw)

