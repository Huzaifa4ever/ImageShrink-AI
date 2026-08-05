from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from bson import ObjectId
from pydantic import BaseModel, Field
from pydantic.alias_generators import to_camel

AnalysisSource = Literal["web", "vscode"]


class AnalysisDocument(BaseModel):

    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    user_id: str
    filename: str
    original_content: str
    original_size: int = 0
    optimized_size: int = 0
    savings_percent: float = 0.0
    stages: list[dict] = []
    vulnerabilities: list[dict] = []
    misconfigurations: list[dict] = []
    scan_summary: dict = {}
    scanner: dict = {}
    optimized_dockerfile: str = ""
    ai_insights: str = ""
    layer_optimizations: list[dict] = []

    optimization_score: int = 0
    security_score: int = 0
    performance_score: int = 0
    rule_scores: dict = {}

    confidence: int = 0
    ai_optimization_score: int = 0
    ai_performance_score: int = 0
    security_notes: list[str] = []
    dockerignore_suggestions: list[str] = []

    rule_findings: list[dict] = []

    source: AnalysisSource = "web"

    model_used: str = ""
    model_requested: str = ""
    client: dict = {}

    favorite: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: str = "pending"

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
        "alias_generator": to_camel,
        "protected_namespaces": (),
    }

    def to_mongo(self) -> dict:
        d = self.model_dump(by_alias=True)
        d["_id"] = ObjectId(d["_id"])
        return d
