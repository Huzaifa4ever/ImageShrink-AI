"""
Entry point - run with: python run.py
Or via uvicorn directly: uvicorn app.main:app --reload
"""
import uvicorn
from app.core.config import get_settings

settings = get_settings()

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.DEBUG,
        # Settings are read once per process and cached, and uvicorn's reloader only watches
        # *.py by default - so editing .env changed nothing until the server was killed by
        # hand. Watching it here means pasting an API key takes effect immediately.
        reload_includes=[".env"] if settings.DEBUG else None,
        log_level="info",
    )
