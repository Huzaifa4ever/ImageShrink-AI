from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    APP_NAME: str = "ImageShrink-AI"
    APP_ENV: str = "development"
    DEBUG: bool = True
    PORT: int = 8000

    MONGO_URI: str = "mongodb://localhost:27017/imageshrink_ai"
    MONGO_DB_NAME: str = "imageshrink_ai"

    ALLOWED_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    WEB_APP_URL: str = "http://localhost:5173"
    DEVICE_CODE_EXPIRE_MINUTES: int = 10
    DEVICE_CODE_POLL_INTERVAL_SECONDS: int = 5
    MAX_API_KEYS_PER_USER: int = 10

    CEREBRAS_API_KEY: str = ""
    CEREBRAS_BASE_URL: str = "https://api.cerebras.ai/v1"
    CEREBRAS_MODEL: str = "zai-glm-4.7"

    MODEL_CATALOG_CACHE_SECONDS: int = 300
    MODEL_HEALTH_CACHE_SECONDS: int = 60
    MODEL_PROBE_TIMEOUT_SECONDS: int = 15

    MODEL_REQUESTS_PER_MINUTE: int = 5
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
    TRIVY_SKIP_DB_UPDATE: bool = True

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    @property
    def model_fallback_list(self) -> list[str]:
        return [m.strip() for m in self.MODEL_FALLBACK_CHAIN.split(",") if m.strip()]

    @property
    def trivy_severities_arg(self) -> str:
        return ",".join(s.strip().upper() for s in self.TRIVY_SEVERITIES.split(",") if s.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
