
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field


@dataclass
class ParsedLayer:
    id: str
    command: str       
    size: int = 0       
    size_human: str = "unknown"
    is_optimizable: bool = False
    suggestion: str = ""


@dataclass
class ParsedStage:
    id: str
    name: str | None
    base_image: str
    layers: list[ParsedLayer] = field(default_factory=list)
    is_final_stage: bool = False


_HEAVY_INSTRUCTIONS = {"RUN", "COPY", "ADD"}
_OPTIMIZABLE_PATTERNS = [
    (r"npm install(?! --production)", "Use --production or --omit=dev to exclude devDependencies"),
    (r"apt-get install", "Pin package versions and use --no-install-recommends to reduce layer size"),
    (r"pip install(?! --no-cache-dir)", "Add --no-cache-dir to prevent pip from storing cache in the image"),
    (r"yarn install(?! --production)", "Use --production to exclude development packages"),
    (r"COPY \. \.", "Avoid COPY . . in final stage — only copy necessary build artifacts"),
]


def parse_dockerfile(content: str) -> list[ParsedStage]:
    lines = content.splitlines()
    stages: list[ParsedStage] = []
    current_stage: ParsedStage | None = None
    current_layer_lines: list[str] = []

    def flush_layer(stage: ParsedStage, raw: str) -> None:
        if not raw.strip():
            return
        layer = ParsedLayer(id=str(uuid.uuid4()), command=raw.strip())
        for pattern, suggestion in _OPTIMIZABLE_PATTERNS:
            if re.search(pattern, raw, re.IGNORECASE):
                layer.is_optimizable = True
                layer.suggestion = suggestion
                break
        stage.layers.append(layer)

    for raw_line in lines:
        line = raw_line.strip()

        if not line or line.startswith("#"):
            if current_stage and current_layer_lines:
                flush_layer(current_stage, " ".join(current_layer_lines))
                current_layer_lines = []
            continue

        if line.endswith("\\"):
            current_layer_lines.append(line[:-1].strip())
            continue
        if line.upper().startswith("FROM "):
            if current_stage and current_layer_lines:
                flush_layer(current_stage, " ".join(current_layer_lines))
                current_layer_lines = []

            parts = line.split()
            base_image = parts[1] if len(parts) > 1 else "unknown"
            name: str | None = None
            if "AS" in [p.upper() for p in parts]:
                as_idx = next(i for i, p in enumerate(parts) if p.upper() == "AS")
                name = parts[as_idx + 1] if as_idx + 1 < len(parts) else None

            current_stage = ParsedStage(
                id=str(uuid.uuid4()),
                name=name,
                base_image=base_image,
            )
            stages.append(current_stage)
            continue

        if current_stage:
            if current_layer_lines:
                current_layer_lines.append(line)
            else:
                instr = line.split()[0].upper() if line.split() else ""
                if instr in _HEAVY_INSTRUCTIONS:
                    current_layer_lines = [line]
                else:
                    flush_layer(current_stage, line)

    if current_stage and current_layer_lines:
        flush_layer(current_stage, " ".join(current_layer_lines))
    if stages:
        stages[-1].is_final_stage = True

    return stages


def to_dict(stages: list[ParsedStage]) -> list[dict]:
    result = []
    for s in stages:
        result.append({
            "id": s.id,
            "name": s.name,
            "baseImage": s.base_image,
            "isFinalStage": s.is_final_stage,
            "totalSize": 0,
            "layers": [
                {
                    "id": lyr.id,
                    "command": lyr.command,
                    "size": lyr.size,
                    "sizeHuman": lyr.size_human,
                    "isOptimizable": lyr.is_optimizable,
                    "suggestion": lyr.suggestion,
                }
                for lyr in s.layers
            ],
        })
    return result
