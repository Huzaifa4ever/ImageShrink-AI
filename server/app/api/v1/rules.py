

from __future__ import annotations

from fastapi import APIRouter

from app.services import rule_engine

router = APIRouter(prefix="/rules", tags=["Rules"])


@router.get("")
async def list_rules():
    catalog = rule_engine.catalog()
    images = rule_engine.base_images()

    return {
        "success": True,
        "data": {
            "rules": list(catalog.values()),
            "categories": sorted({rule["category"] for rule in catalog.values()}),
            "severities": ["critical", "high", "medium", "low", "info"],
            "imageFamilies": {
                key: {
                    "displayName": family["displayName"],
                    "defaultSizeMb": family["defaultSizeMb"],
                    "recommendations": family["recommendations"],
                }
                for key, family in images["families"].items()
            },
        },
    }
