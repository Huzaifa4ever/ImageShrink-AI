from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import get_settings

settings = get_settings()

_client: AsyncIOMotorClient | None = None


async def connect_db() -> None:
    global _client
    try:
        _client = AsyncIOMotorClient(
            settings.MONGO_URI,
            serverSelectionTimeoutMS=5000,
            tz_aware=True,
        )
        await _client.admin.command("ping")
        print(f"MongoDB connected {settings.MONGO_DB_NAME}")
    except Exception as e:
        print(f"MongoDB unavailable ({e}). The app will start, but DB operations will fail.")
        _client = None


async def close_db() -> None:
    global _client
    if _client:
        _client.close()
        print(" MongoDB connection closed")


def get_db():
    if _client is None:
        raise RuntimeError(
            "Database not connected. Ensure MongoDB is running and restart the server."
        )
    return _client[settings.MONGO_DB_NAME]
