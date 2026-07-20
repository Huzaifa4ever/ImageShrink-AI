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

    CEREBRAS_API_KEY: str = ""
    CEREBRAS_BASE_URL: str = "https://api.cerebras.ai/v1"
    CEREBRAS_MODEL: str = "zai-glm-4.7"

    MAX_UPLOAD_SIZE_MB: int = 10

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()
