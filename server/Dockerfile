
ARG TRIVY_VERSION=0.69.3
ARG BAKE_TRIVY_DB=false

FROM aquasec/trivy:${TRIVY_VERSION} AS trivy-bin


FROM trivy-bin AS trivy-db-true
RUN trivy --cache-dir /trivy-cache image --download-db-only

FROM trivy-bin AS trivy-db-false
RUN mkdir -p /trivy-cache

# Resolves to trivy-db-true or trivy-db-false.
FROM trivy-db-${BAKE_TRIVY_DB} AS trivy-db


FROM python:3.12-slim AS deps

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

COPY server/requirements.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt


# Stage 3: Runtime 
FROM python:3.12-slim AS runtime

ARG BAKE_TRIVY_DB

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    TRIVY_CACHE_DIR=/opt/trivy-cache \
    TRIVY_SKIP_DB_UPDATE=${BAKE_TRIVY_DB} \
    PORT=8000

RUN groupadd --system --gid 1001 appuser \
    && useradd --system --uid 1001 --gid appuser --create-home appuser

COPY --from=deps --chown=appuser:appuser /opt/venv /opt/venv
COPY --from=trivy-bin /usr/local/bin/trivy /usr/local/bin/trivy
COPY --from=trivy-db --chown=appuser:appuser /trivy-cache /opt/trivy-cache

WORKDIR /app
COPY --chown=appuser:appuser shared/ ./shared/
COPY --chown=appuser:appuser server/app/ ./server/app/
COPY --chown=appuser:appuser server/run.py ./server/

USER appuser
WORKDIR /app/server

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen(f\"http://127.0.0.1:{os.getenv('PORT','8000')}/health\", timeout=4).status == 200 else 1)"


CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
