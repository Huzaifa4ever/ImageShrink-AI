from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from pydantic import BaseModel, Field
from pydantic.alias_generators import to_camel


class AnalysisDocument(BaseModel):

    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    filename: str
    original_content: str          
    original_size: int = 0         
    optimized_size: int = 0
    savings_percent: float = 0.0
    stages: list[dict] = []
    vulnerabilities: list[dict] = []
    optimized_dockerfile: str = ""
    ai_insights: str = ""
    layer_optimizations: list[dict] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: str = "pending"

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
        "alias_generator": to_camel,
    }

    def to_mongo(self) -> dict:
        d = self.model_dump(by_alias=True)
        d["_id"] = ObjectId(d["_id"])
        return d
