
from __future__ import annotations

import asyncio
import logging
import re

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field

from app.api.deps import Principal, get_current_principal, get_current_user
from app.api.errors import scheduler_http_error
from app.core.config import get_settings
from app.core.database import get_db
from app.models.analysis import AnalysisDocument
from app.services import rule_engine
from app.services.ai_optimizer import AnalysisContext, optimize_dockerfile
from app.services.dockerfile_parser import parse_dockerfile, to_dict
from app.services.model_registry import is_servable
from app.services.model_scheduler import Outcome
from app.services.trivy_scanner import empty_report, ensure_grouped, scan_dockerfile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analyze", tags=["Analysis"])
settings = get_settings()

DEFAULT_PAGE_SIZE = 12
MAX_PAGE_SIZE = 50

class ExtensionAnalyzeRequest(BaseModel):
    """What the extension sends. Everything but ``content`` is optional context."""

    content: str = Field(min_length=1, max_length=1_000_000)
    filename: str = Field(default="Dockerfile", max_length=260)
    model: str | None = None

    dockerignore: str | None = Field(default=None, max_length=200_000)
    hasDockerignore: bool | None = None
    packageJson: str | None = Field(default=None, max_length=200_000)
    dockerHistory: str | None = Field(default=None, max_length=200_000)
    imageMetadata: str | None = Field(default=None, max_length=200_000)
    bloatCandidates: list[str] = Field(default_factory=list, max_length=200)

    save: bool = True
    clientVersion: str = Field(default="", max_length=40)


class RulesOnlyRequest(BaseModel):

    content: str = Field(min_length=0, max_length=1_000_000)
    filename: str = Field(default="Dockerfile", max_length=260)
    dockerignore: str | None = Field(default=None, max_length=200_000)
    hasDockerignore: bool | None = None
    bloatCandidates: list[str] = Field(default_factory=list, max_length=200)


class FavoriteRequest(BaseModel):
    favorite: bool

async def _run_analysis(
    *,
    user_id: str,
    filename: str,
    content: str,
    requested_model: str,
    source: str,
    context: AnalysisContext,
    has_dockerignore: bool | None,
    bloat_candidates: list[str],
    client: dict,
) -> tuple[AnalysisDocument, Outcome]:
    stages_dict = to_dict(parse_dockerfile(content))

    findings = rule_engine.analyze(
        content,
        has_dockerignore=has_dockerignore,
        dockerignore=context.dockerignore,
        bloat_candidates=bloat_candidates,
    )
    scores = rule_engine.score(findings)

    scan_outcome, ai_outcome = await asyncio.gather(
        scan_dockerfile(content, stages_dict),
        optimize_dockerfile(content, requested_model, context),
        return_exceptions=True,
    )

    if isinstance(ai_outcome, BaseException):
        raise scheduler_http_error(ai_outcome) from ai_outcome

    if isinstance(scan_outcome, BaseException):
        logger.exception("Trivy scan raised unexpectedly", exc_info=scan_outcome)
        scan_outcome = empty_report("unavailable", f"Scan failed: {scan_outcome}")

    ai_result = ai_outcome.value
    original_bytes = ai_result["estimated_original_size_mb"] * 1024 * 1024
    optimized_bytes = ai_result["estimated_optimized_size_mb"] * 1024 * 1024
    savings_pct = round((1 - optimized_bytes / max(original_bytes, 1)) * 100, 1)

    doc = AnalysisDocument(
        user_id=user_id,
        filename=filename,
        original_content=content,
        original_size=original_bytes,
        optimized_size=optimized_bytes,
        savings_percent=savings_pct,
        stages=stages_dict,
        vulnerabilities=scan_outcome["vulnerabilities"],
        misconfigurations=scan_outcome["misconfigurations"],
        scan_summary=scan_outcome["scanSummary"],
        scanner=scan_outcome["scanner"],
        optimized_dockerfile=ai_result["optimized_dockerfile"],
        ai_insights=ai_result["ai_insights"],
        layer_optimizations=ai_result["layer_optimizations"],
        optimization_score=scores["optimizationScore"],
        security_score=scores["securityScore"],
        performance_score=scores["performanceScore"],
        rule_scores=scores,
        rule_findings=rule_engine.to_dicts(findings),
        confidence=ai_result["confidence"],
        ai_optimization_score=ai_result["optimization_score"],
        ai_performance_score=ai_result["performance_score"],
        security_notes=ai_result["security_notes"],
        dockerignore_suggestions=ai_result["dockerignore_suggestions"],
        source=source,  # type: ignore[arg-type]
        model_used=ai_outcome.model,
        model_requested=requested_model,
        client=client,
        status="complete",
    )
    return doc, ai_outcome


async def _reject_unservable(model: str) -> None:
    if not await is_servable(model):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{model}' is not served by the AI provider. "
                "Run the model availability check and pick a model marked available."
            ),
        )


def _response(doc: AnalysisDocument, outcome: Outcome, inserted_id: str | None) -> dict:
    return {
        "success": True,
        "data": {
            "_id": inserted_id or doc.id,
            **doc.model_dump(by_alias=True, exclude={"id", "original_content"}),
            "scheduling": outcome.to_dict(),
            "saved": inserted_id is not None,
        },
    }

@router.post("", status_code=status.HTTP_201_CREATED)
async def analyze_dockerfile(
    file: UploadFile = File(...),
    model: str | None = Form(None),
    user: dict = Depends(get_current_user),
):
    """Web workbench upload."""
    selected_model = (model or "").strip() or settings.CEREBRAS_MODEL
    await _reject_unservable(selected_model)

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    content_bytes = await file.read()

    if len(content_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit",
        )

    try:
        content = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dockerfile must be valid UTF-8 text",
        ) from None

    doc, outcome = await _run_analysis(
        user_id=str(user["_id"]),
        filename=file.filename or "Dockerfile",
        content=content,
        requested_model=selected_model,
        source="web",
        context=AnalysisContext(),
        has_dockerignore=None,
        bloat_candidates=[],
        client={"kind": "web", "name": "Browser"},
    )

    result = await get_db()["analyses"].insert_one(doc.to_mongo())
    return _response(doc, outcome, str(result.inserted_id))


@router.post("/extension", status_code=status.HTTP_201_CREATED)
async def analyze_from_extension(
    body: ExtensionAnalyzeRequest,
    principal: Principal = Depends(get_current_principal),
):
    selected_model = (body.model or "").strip() or settings.CEREBRAS_MODEL
    await _reject_unservable(selected_model)

    context = AnalysisContext(
        dockerignore=body.dockerignore,
        package_json=body.packageJson,
        docker_history=body.dockerHistory,
        image_metadata=body.imageMetadata,
        bloat_candidates=body.bloatCandidates,
    )

    doc, outcome = await _run_analysis(
        user_id=principal.user_id,
        filename=body.filename or "Dockerfile",
        content=body.content,
        requested_model=selected_model,
        source="vscode",
        context=context,
        has_dockerignore=body.hasDockerignore,
        bloat_candidates=body.bloatCandidates,
        client={"kind": "vscode", "name": "VS Code", "version": body.clientVersion},
    )

    inserted_id = None
    if body.save:
        result = await get_db()["analyses"].insert_one(doc.to_mongo())
        inserted_id = str(result.inserted_id)

    return _response(doc, outcome, inserted_id)


@router.post("/rules")
async def analyze_rules_only(
    body: RulesOnlyRequest, _: Principal = Depends(get_current_principal)
):
   
    findings = rule_engine.analyze(
        body.content,
        has_dockerignore=body.hasDockerignore,
        dockerignore=body.dockerignore,
        bloat_candidates=body.bloatCandidates,
    )
    return {
        "success": True,
        "data": {
            "filename": body.filename,
            "findings": rule_engine.to_dicts(findings),
            "scores": rule_engine.score(findings),
        },
    }

_LIST_PROJECTION = {
    "originalContent": 0,
    "vulnerabilities": 0,
    "misconfigurations": 0,
    "stages": 0,
    "layerOptimizations": 0,
    "optimizedDockerfile": 0,
    "ruleFindings": 0,
}

_SORTS = {
    "newest": [("createdAt", -1)],
    "oldest": [("createdAt", 1)],
    "savings": [("savingsPercent", -1), ("createdAt", -1)],
    "score": [("optimizationScore", 1), ("createdAt", -1)],
}


@router.get("/history")
async def get_history(
    principal: Principal = Depends(get_current_principal),
    q: str = Query("", max_length=120, description="Matches the filename or AI summary"),
    source: str = Query("all", pattern="^(all|web|vscode)$"),
    favorite: bool | None = Query(None),
    sort: str = Query("newest", pattern="^(newest|oldest|savings|score)$"),
    page: int = Query(1, ge=1),
    pageSize: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
):
    """The caller's own analyses — searchable, filterable, paginated."""
    query: dict = {"userId": principal.user_id}

    if q.strip():
        pattern = re.escape(q.strip())
        query["$or"] = [
            {"filename": {"$regex": pattern, "$options": "i"}},
            {"aiInsights": {"$regex": pattern, "$options": "i"}},
        ]

    if source != "all":
        query["source"] = source
    if favorite is not None:
        query["favorite"] = favorite

    db = get_db()
    total = await db["analyses"].count_documents(query)

    cursor = (
        db["analyses"]
        .find(query, _LIST_PROJECTION)
        .sort(_SORTS[sort])
        .skip((page - 1) * pageSize)
        .limit(pageSize)
    )

    items = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        items.append(doc)

    return {
        "success": True,
        "data": {
            "items": items,
            "total": total,
            "page": page,
            "pageSize": pageSize,
            "hasMore": page * pageSize < total,
        },
    }


@router.get("/stats")
async def get_stats(principal: Principal = Depends(get_current_principal)):
    db = get_db()
    pipeline = [
        {"$match": {"userId": principal.user_id}},
        {
            "$group": {
                "_id": None,
                "total": {"$sum": 1},
                "web": {"$sum": {"$cond": [{"$eq": ["$source", "vscode"]}, 0, 1]}},
                "vscode": {"$sum": {"$cond": [{"$eq": ["$source", "vscode"]}, 1, 0]}},
                "favorites": {"$sum": {"$cond": ["$favorite", 1, 0]}},
                "bytesSaved": {"$sum": {"$subtract": ["$originalSize", "$optimizedSize"]}},
                "avgSavingsPercent": {"$avg": "$savingsPercent"},
                "avgOptimizationScore": {"$avg": "$optimizationScore"},
                "avgSecurityScore": {"$avg": "$securityScore"},
                "criticalFindings": {"$sum": {"$ifNull": ["$scanSummary.critical", 0]}},
                "highFindings": {"$sum": {"$ifNull": ["$scanSummary.high", 0]}},
                "lastAnalysisAt": {"$max": "$createdAt"},
            }
        },
    ]

    rows = await db["analyses"].aggregate(pipeline).to_list(length=1)
    if not rows:
        return {
            "success": True,
            "data": {
                "total": 0,
                "bySource": {"web": 0, "vscode": 0},
                "favorites": 0,
                "bytesSaved": 0,
                "avgSavingsPercent": 0.0,
                "avgOptimizationScore": 0,
                "avgSecurityScore": 0,
                "criticalFindings": 0,
                "highFindings": 0,
                "lastAnalysisAt": None,
            },
        }

    row = rows[0]
    return {
        "success": True,
        "data": {
            "total": row["total"],
            "bySource": {"web": row["web"], "vscode": row["vscode"]},
            "favorites": row["favorites"],
            "bytesSaved": max(0, row["bytesSaved"] or 0),
            "avgSavingsPercent": round(row["avgSavingsPercent"] or 0, 1),
            "avgOptimizationScore": round(row["avgOptimizationScore"] or 0),
            "avgSecurityScore": round(row["avgSecurityScore"] or 0),
            "criticalFindings": row["criticalFindings"] or 0,
            "highFindings": row["highFindings"] or 0,
            "lastAnalysisAt": row["lastAnalysisAt"],
        },
    }


@router.get("/{analysis_id}")
async def get_analysis(analysis_id: str, principal: Principal = Depends(get_current_principal)):
    if not ObjectId.is_valid(analysis_id):
        raise HTTPException(status_code=400, detail="Invalid analysis ID")

    doc = await get_db()["analyses"].find_one(
        {"_id": ObjectId(analysis_id), "userId": principal.user_id},
        {"originalContent": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")

    doc["_id"] = str(doc["_id"])
    doc["vulnerabilities"], doc["scanSummary"] = ensure_grouped(
        doc.get("vulnerabilities") or [], doc.get("scanSummary") or {}
    )
    return {"success": True, "data": doc}


@router.patch("/{analysis_id}/favorite")
async def set_favorite(
    analysis_id: str,
    body: FavoriteRequest,
    principal: Principal = Depends(get_current_principal),
):
    if not ObjectId.is_valid(analysis_id):
        raise HTTPException(status_code=400, detail="Invalid analysis ID")

    result = await get_db()["analyses"].update_one(
        {"_id": ObjectId(analysis_id), "userId": principal.user_id},
        {"$set": {"favorite": body.favorite}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {
        "success": True,
        "data": {"favorite": body.favorite},
        "message": "Added to favorites" if body.favorite else "Removed from favorites",
    }


@router.delete("/{analysis_id}")
async def delete_analysis(analysis_id: str, principal: Principal = Depends(get_current_principal)):
    if not ObjectId.is_valid(analysis_id):
        raise HTTPException(status_code=400, detail="Invalid analysis ID")

    result = await get_db()["analyses"].delete_one(
        {"_id": ObjectId(analysis_id), "userId": principal.user_id}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {"success": True, "data": None, "message": "Deleted successfully"}
