
from __future__ import annotations

from bson import ObjectId
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.core.config import get_settings
from app.core.database import get_db
from app.models.analysis import AnalysisDocument
from app.services.ai_optimizer import optimize_dockerfile
from app.services.dockerfile_parser import parse_dockerfile, to_dict
from app.services.vulnerability_scanner import scan_vulnerabilities

router = APIRouter(prefix="/analyze", tags=["Analysis"])
settings = get_settings()


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Upload a Dockerfile for AI analysis",
)
async def analyze_dockerfile(file: UploadFile = File(...), model: str = Form("zai-glm-4.7")):

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    content_bytes = await file.read()
    if len(content_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit",
        )
    content = content_bytes.decode("utf-8")

    parsed_stages = parse_dockerfile(content)
    stages_dict = to_dict(parsed_stages)

    vulnerabilities = scan_vulnerabilities(stages_dict)

    try:
        ai_result = await optimize_dockerfile(content, model)
    except Exception as e:
        error_msg = str(e)
        if "429" in error_msg or "queue" in error_msg.lower() or "too_many_requests" in error_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="The AI optimization service is currently experiencing high traffic. Please try again soon."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Optimization failed: {error_msg}"
        )

    original_mb: int  = ai_result.get("estimated_original_size_mb", 850)
    optimized_mb: int = ai_result.get("estimated_optimized_size_mb", 120)
    original_bytes   = original_mb  * 1024 * 1024
    optimized_bytes  = optimized_mb * 1024 * 1024
    savings_pct      = round((1 - optimized_bytes / max(original_bytes, 1)) * 100, 1)

    layer_opts = ai_result.get("layer_optimizations", [])
    for opt in layer_opts:
        if "saved_bytes" in opt:
            opt["savedBytes"] = opt.pop("saved_bytes")

    doc = AnalysisDocument(
        filename=file.filename or "Dockerfile",
        original_content=content,
        original_size=original_bytes,
        optimized_size=optimized_bytes,
        savings_percent=savings_pct,
        stages=stages_dict,
        vulnerabilities=vulnerabilities,
        optimized_dockerfile=ai_result.get("optimized_dockerfile", ""),
        ai_insights=ai_result.get("ai_insights", ""),
        layer_optimizations=layer_opts,
        status="complete",
    )

    db = get_db()
    result = await db["analyses"].insert_one(doc.to_mongo())
    inserted_id = str(result.inserted_id)

    return {
        "success": True,
        "data": {
            "_id": inserted_id,
            **doc.model_dump(by_alias=True, exclude={"id", "original_content"}),
            "_id": inserted_id,
        },
    }


@router.get("/history", summary="List all past analyses")
async def get_history():
    db = get_db()
    cursor = db["analyses"].find({}, {"original_content": 0}).sort("created_at", -1).limit(50)
    docs = []
    async for d in cursor:
        d["_id"] = str(d["_id"])
        docs.append(d)
    return {"success": True, "data": docs}


@router.get("/{analysis_id}", summary="Get a single analysis by ID")
async def get_analysis(analysis_id: str):
    if not ObjectId.is_valid(analysis_id):
        raise HTTPException(status_code=400, detail="Invalid analysis ID")

    db = get_db()
    doc = await db["analyses"].find_one({"_id": ObjectId(analysis_id)}, {"original_content": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")

    doc["_id"] = str(doc["_id"])
    return {"success": True, "data": doc}


@router.delete("/{analysis_id}", summary="Delete an analysis by ID")
async def delete_analysis(analysis_id: str):
    if not ObjectId.is_valid(analysis_id):
        raise HTTPException(status_code=400, detail="Invalid analysis ID")

    db = get_db()
    result = await db["analyses"].delete_one({"_id": ObjectId(analysis_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {"success": True, "data": None, "message": "Deleted successfully"}
