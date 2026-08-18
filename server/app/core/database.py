import logging

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

_client: AsyncIOMotorClient | None = None


async def connect_db() -> None:
    global _client
    try:
        _client = AsyncIOMotorClient(
            settings.MONGO_URI,
            serverSelectionTimeoutMS=settings.MONGO_SERVER_SELECTION_TIMEOUT_MS,
            tz_aware=True,
        )
        await _client.admin.command("ping")
        logger.info("MongoDB connected: %s", settings.MONGO_DB_NAME)
    except Exception as e:
        # Logged at ERROR, not printed: this is the line an alert rule watches for, and a
        # print() would not carry a severity for the query to filter on.
        logger.error(
            "MongoDB unavailable (%s). The app will start, but DB operations will fail.", e
        )
        _client = None


async def close_db() -> None:
    global _client
    if _client:
        _client.close()
        logger.info("MongoDB connection closed")


def get_db():
    if _client is None:
        raise RuntimeError(
            "Database not connected. Ensure MongoDB is running and restart the server."
        )
    return _client[settings.MONGO_DB_NAME]
