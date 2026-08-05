from __future__ import annotations

from fastapi import APIRouter, Query

from app.services.model_registry import list_models

router = APIRouter(prefix="/models", tags=["Models"])


@router.get("")
async def get_models(
    probe: bool = Query(
        False,
        description="Send a tiny live completion to each model to check it is answering.",
    ),
):
    return {"success": True, "data": await list_models(probe=probe)}
