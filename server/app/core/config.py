from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    APP_NAME: str = "ImageShrink-AI"
    APP_ENV: str = "development"
    DEBUG: bool = True
    PORT: int = 8000

    LOG_LEVEL: str = "INFO"

    # Set by the pipeline to "<build>-<sha>". /health reports it, so a deploy can prove the new
    # image is serving; also logged at startup, to tie an error spike to a release.
    APP_BUILD: str = "dev"

    # Google Cloud console -> "OAuth 2.0 Client IDs". Empty hides the button and makes the
    # endpoint return 501, so the feature is absent rather than broken. No client secret needed.
    GOOGLE_CLIENT_ID: str = ""

    # Azure Communication Services. Empty disables sending, and the flows then fail with a
    # clear message rather than silently doing nothing.
    ACS_CONNECTION_STRING: str = ""
    ACS_SENDER_ADDRESS: str = ""

    # Blocks sign-in until confirmed. False by default so enabling it cannot lock out accounts
    # created before verification existed.
    EMAIL_VERIFICATION_REQUIRED: bool = False
    EMAIL_VERIFY_TOKEN_HOURS: int = 24
    PASSWORD_RESET_TOKEN_MINUTES: int = 30

    # MX lookup, so typos like @gmial.com are rejected at signup. Cannot prove a mailbox
    # exists — only the confirmation link does. Falls back to syntax-only if DNS is down.
    EMAIL_CHECK_DELIVERABILITY: bool = True

    # Empty disables Application Insights, so local development needs no Azure account.
    APPLICATIONINSIGHTS_CONNECTION_STRING: str = ""

    MONGO_URI: str = "mongodb://localhost:27017/imageshrink_ai"
    MONGO_DB_NAME: str = "imageshrink_ai"

    # A container on localhost answers in milliseconds; a hosted cluster has to resolve SRV
    # records and finish a TLS handshake first, which on a cold start can take several
    # seconds. Too low a value here shows up as "MongoDB unavailable" on an otherwise
    # healthy database.
    MONGO_SERVER_SELECTION_TIMEOUT_MS: int = 15000

    ALLOWED_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    WEB_APP_URL: str = "http://localhost:5173"
    DEVICE_CODE_EXPIRE_MINUTES: int = 10
    DEVICE_CODE_POLL_INTERVAL_SECONDS: int = 5
    MAX_API_KEYS_PER_USER: int = 10

    GROQ_API_KEY: str = ""
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    GROQ_MODEL: str = "openai/gpt-oss-120b"

    # The provider serves speech, text-to-speech and classifier models alongside the chat
    # ones. None of those can optimize a Dockerfile, so only these are offered and used.
    # Empty means "allow everything the provider lists".
    MODEL_ALLOWLIST: str = "openai/gpt-oss-120b,qwen/qwen3.6-27b,openai/gpt-oss-20b"

    MODEL_CATALOG_CACHE_SECONDS: int = 300
    MODEL_HEALTH_CACHE_SECONDS: int = 60
    MODEL_PROBE_TIMEOUT_SECONDS: int = 15

    # Derived from the provider's tokens-per-minute cap, not its requests-per-minute one.
    # The free tier allows 30 requests/minute but only 8K tokens/minute, and one analysis
    # costs roughly 2-4K tokens (prompt plus a completion capped at max_tokens=4096). The
    # requests column is never the binding limit; tokens are. Log usage.total_tokens over a
    # few analyses before raising this.
    MODEL_REQUESTS_PER_MINUTE: int = 3
    MODEL_RATE_WINDOW_SECONDS: int = 60
    MODEL_MAX_ATTEMPTS: int = 4
    MODEL_MAX_QUEUE_WAIT_SECONDS: int = 45
    MODEL_COOLDOWN_SECONDS: int = 30
    MODEL_UNAVAILABLE_COOLDOWN_SECONDS: int = 300
    MODEL_MAX_CANDIDATES: int = 5
    MODEL_FALLBACK_CHAIN: str = ""

    MAX_UPLOAD_SIZE_MB: int = 10

    SHARED_DIR: str = ""

    TRIVY_ENABLED: bool = True
    TRIVY_BINARY: str = "trivy"
    TRIVY_TIMEOUT_SECONDS: int = 120
    TRIVY_TOTAL_TIMEOUT_SECONDS: int = 180

    TRIVY_MAX_CONCURRENT_SCANS: int = 1
    TRIVY_SEVERITIES: str = "CRITICAL,HIGH,MEDIUM,LOW"
    TRIVY_CACHE_TTL_MINUTES: int = 60
    TRIVY_MAX_IMAGES: int = 4
    TRIVY_MAX_FINDINGS: int = 100

    # False so a local checkout downloads the vulnerability database and scans actually work.
    # The Dockerfile overrides this to true when it bakes the database into the image, since
    # a container has one already and re-downloading it on every restart is pure waste.
    TRIVY_SKIP_DB_UPDATE: bool = False

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    @property
    def model_fallback_list(self) -> list[str]:
        return [m.strip() for m in self.MODEL_FALLBACK_CHAIN.split(",") if m.strip()]

    @property
    def model_allowlist(self) -> list[str]:
        return [m.strip() for m in self.MODEL_ALLOWLIST.split(",") if m.strip()]

    @property
    def trivy_severities_arg(self) -> str:
        return ",".join(s.strip().upper() for s in self.TRIVY_SEVERITIES.split(",") if s.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
