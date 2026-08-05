
from __future__ import annotations

import json

import pytest

from app.services.ai_optimizer import (
    AnalysisContext,
    _build_prompt,
    _extract_json,
    _normalize,
)



def test_extracts_json_wrapped_in_prose_and_fences():
    raw = 'Sure! Here is the analysis:\n```json\n{"optimized_dockerfile": "FROM x"}\n```\nHope that helps.'
    assert _extract_json(raw) == {"optimized_dockerfile": "FROM x"}


def test_rejects_a_response_with_no_object():
    with pytest.raises(ValueError, match="No JSON object"):
        _extract_json("I cannot help with that request.")


def test_rejects_a_json_array_at_the_top_level():
    with pytest.raises(ValueError):
        _extract_json('["not", "an", "object"]')


def test_rejects_malformed_json_with_a_useful_message():
    with pytest.raises(ValueError, match="not valid JSON"):
        _extract_json('{"optimized_dockerfile": "FROM x",}')


def test_normalizes_a_well_formed_response_unchanged():
    result = _normalize(
        {
            "optimized_dockerfile": "FROM node:22-alpine",
            "ai_insights": "Switched to alpine.",
            "layer_optimizations": [
                {"before": "RUN a", "after": "RUN b", "saved_bytes": 1024, "reason": "smaller"}
            ],
            "estimated_original_size_mb": 900,
            "estimated_optimized_size_mb": 120,
            "optimization_score": 25,
            "performance_score": 40,
            "security_notes": ["Runs as root"],
            "dockerignore_suggestions": ["node_modules"],
            "confidence": 88,
        }
    )

    assert result["estimated_original_size_mb"] == 900
    assert result["optimization_score"] == 25
    assert result["security_notes"] == ["Runs as root"]
    # saved_bytes is renamed on the way in, so the whole collection stays camelCase.
    assert result["layer_optimizations"][0]["savedBytes"] == 1024


def test_coerces_numbers_that_arrive_as_strings():
    result = _normalize(
        {"estimated_original_size_mb": "1200 MB", "estimated_optimized_size_mb": "95"}
    )

    assert result["estimated_original_size_mb"] == 1200
    assert result["estimated_optimized_size_mb"] == 95


def test_clamps_scores_into_range():
    result = _normalize(
        {"optimization_score": 250, "performance_score": -10, "confidence": 1000}
    )

    assert result["optimization_score"] == 100
    assert result["performance_score"] == 0
    assert result["confidence"] == 100


def test_clamps_an_optimized_size_larger_than_the_original():
    """Otherwise the savings percentage downstream goes negative."""
    result = _normalize(
        {"estimated_original_size_mb": 100, "estimated_optimized_size_mb": 400}
    )

    assert result["estimated_original_size_mb"] == 100
    assert result["estimated_optimized_size_mb"] == 100


def test_an_empty_response_yields_usable_defaults():
    result = _normalize({})

    assert result["optimized_dockerfile"] == ""
    assert result["layer_optimizations"] == []
    assert result["security_notes"] == []
    # Sizes must stay positive: the savings maths divides by the original.
    assert result["estimated_original_size_mb"] > 0
    assert result["estimated_optimized_size_mb"] > 0


def test_accepts_a_bare_string_where_a_list_was_asked_for():
    result = _normalize({"security_notes": "Base image is unpinned"})
    assert result["security_notes"] == ["Base image is unpinned"]


def test_pulls_text_out_of_objects_in_a_string_list():
    result = _normalize(
        {"security_notes": [{"description": "Runs as root"}, {"title": "Unpinned tag"}]}
    )
    assert result["security_notes"] == ["Runs as root", "Unpinned tag"]


def test_drops_layer_optimizations_missing_their_before_or_after():
    result = _normalize(
        {
            "layer_optimizations": [
                {"before": "RUN a", "after": "RUN b"},
                {"before": "RUN c"},
                "not an object",
                {"after": "RUN d"},
            ]
        }
    )

    assert len(result["layer_optimizations"]) == 1
    assert result["layer_optimizations"][0]["savedBytes"] == 0
    assert result["layer_optimizations"][0]["reason"] == ""


def test_rejects_booleans_where_a_score_was_expected():
    # bool is an int subclass, so `True` would otherwise silently score 1.
    result = _normalize({"confidence": True})
    assert result["confidence"] == 70


def test_wrong_types_do_not_leak_into_strings():
    result = _normalize({"optimized_dockerfile": {"nested": "object"}, "ai_insights": 42})
    assert result["optimized_dockerfile"] == ""
    assert result["ai_insights"] == ""

def test_prompt_without_context_does_not_mention_project_files():
    prompt = _build_prompt("FROM node:22")
    assert "Additional project context" not in prompt
    assert "FROM node:22" in prompt


def test_prompt_flags_a_missing_dockerignore():
    """The extension needs this to be able to suggest creating one."""
    prompt = _build_prompt("FROM node:22", AnalysisContext(package_json='{"name":"x"}'))

    assert "NO .dockerignore" in prompt
    assert '{"name":"x"}' in prompt


def test_prompt_includes_an_existing_dockerignore():
    prompt = _build_prompt("FROM node:22", AnalysisContext(dockerignore="node_modules\n.git"))

    assert "Existing .dockerignore" in prompt
    assert "NO .dockerignore" not in prompt


def test_oversized_context_is_truncated_rather_than_dropped():
    huge = json.dumps({"deps": ["pkg-" + str(i) for i in range(5000)]})
    prompt = _build_prompt("FROM node:22", AnalysisContext(package_json=huge))

    assert "truncated" in prompt
    # The Dockerfile itself must survive intact - it is the point of the request.
    assert "FROM node:22" in prompt
    assert len(prompt) < len(huge)
