

from __future__ import annotations

import re
from dataclasses import dataclass, field

_DIRECTIVE_RE = re.compile(r"^#\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(.+?)\s*$")

_KEYWORDS = {
    "FROM", "RUN", "CMD", "LABEL", "EXPOSE", "ENV", "ADD", "COPY", "ENTRYPOINT",
    "VOLUME", "USER", "WORKDIR", "ARG", "ONBUILD", "STOPSIGNAL", "HEALTHCHECK", "SHELL",
    "MAINTAINER",
}


@dataclass
class Instruction:

    keyword: str
    value: str
    line: int
    end_line: int
    raw: str
    stage_index: int = -1

    @property
    def text(self) -> str:
        return f"{self.keyword} {self.value}".strip()

    @property
    def is_multiline(self) -> bool:
        return self.end_line > self.line

    def column_of(self, needle: str) -> tuple[int, int, int, int]:
        lines = self.raw.splitlines() or [self.raw]
        for offset, source_line in enumerate(lines):
            found = source_line.find(needle)
            if found != -1:
                return (
                    self.line + offset,
                    found + 1,
                    self.line + offset,
                    found + 1 + len(needle),
                )
        return self.full_span()

    def full_span(self) -> tuple[int, int, int, int]:
        lines = self.raw.splitlines() or [self.raw]
        return (self.line, 1, self.end_line, len(lines[-1]) + 1)


@dataclass
class ParsedDockerfile:
    instructions: list[Instruction] = field(default_factory=list)
    directives: dict[str, str] = field(default_factory=dict)
    stage_count: int = 0

    def of(self, *keywords: str) -> list[Instruction]:
        wanted = {k.upper() for k in keywords}
        return [i for i in self.instructions if i.keyword in wanted]

    def in_stage(self, stage_index: int) -> list[Instruction]:
        return [i for i in self.instructions if i.stage_index == stage_index]

    @property
    def final_stage_index(self) -> int:
        return self.stage_count - 1 if self.stage_count else -1

    def has(self, keyword: str) -> bool:
        return any(i.keyword == keyword.upper() for i in self.instructions)


def parse(content: str) -> ParsedDockerfile:
    result = ParsedDockerfile()
    lines = content.splitlines()

    stage_index = -1
    seen_instruction = False

    i = 0
    while i < len(lines):
        raw_line = lines[i]
        stripped = raw_line.strip()

        if not stripped:
            i += 1
            continue

        if stripped.startswith("#"):
            if not seen_instruction:
                match = _DIRECTIVE_RE.match(stripped)
                if match:
                    result.directives[match.group(1).lower()] = match.group(2)
            i += 1
            continue

        keyword_match = re.match(r"^\s*([A-Za-z][A-Za-z0-9_]*)\s*(.*)$", raw_line)
        if not keyword_match:
            i += 1
            continue

        keyword = keyword_match.group(1).upper()
        if keyword not in _KEYWORDS:
            i += 1
            continue

        start_line = i + 1
        raw_parts = [raw_line]
        value_parts = [keyword_match.group(2).strip()]
        continuing = raw_line.rstrip().endswith("\\")

        while continuing and i + 1 < len(lines):
            i += 1
            nxt = lines[i]
            raw_parts.append(nxt)
            if nxt.strip().startswith("#"):
                continue
            value_parts.append(nxt.strip())
            continuing = nxt.rstrip().endswith("\\")

        joined = " ".join(
            part[:-1].strip() if part.rstrip().endswith("\\") else part.strip()
            for part in value_parts
            if part.strip()
        )
        joined = re.sub(r"\s+", " ", joined).strip()

        if keyword == "FROM":
            stage_index += 1
            result.stage_count = stage_index + 1

        result.instructions.append(
            Instruction(
                keyword=keyword,
                value=joined,
                line=start_line,
                end_line=i + 1,
                raw="\n".join(raw_parts),
                stage_index=stage_index,
            )
        )
        seen_instruction = True
        i += 1

    return result


@dataclass
class ImageRef:

    raw: str
    registry: str | None
    path: str
    tag: str | None
    digest: str | None
    alias: str | None = None
    is_stage_reference: bool = False

    @property
    def name(self) -> str:
        return self.path.rsplit("/", 1)[-1]

    @property
    def is_scratch(self) -> bool:
        return self.path == "scratch"

    @property
    def is_distroless(self) -> bool:
        return "distroless" in self.path

    @property
    def is_slim_variant(self) -> bool:
        tag = (self.tag or "").lower()
        return "slim" in tag or "alpine" in tag or self.path.endswith("alpine")


def parse_from(instruction: Instruction, known_stage_names: set[str]) -> ImageRef | None:
    if instruction.keyword != "FROM":
        return None

    tokens = instruction.value.split()
    tokens = [t for t in tokens if not t.startswith("--")]
    if not tokens:
        return None

    reference = tokens[0]
    alias: str | None = None
    if len(tokens) >= 3 and tokens[1].upper() == "AS":
        alias = tokens[2]

    if reference in known_stage_names:
        return ImageRef(
            raw=reference,
            registry=None,
            path=reference,
            tag=None,
            digest=None,
            alias=alias,
            is_stage_reference=True,
        )

    remainder, digest = (reference.split("@", 1) + [None])[:2] if "@" in reference else (reference, None)

    registry: str | None = None
    path = remainder
    if "/" in remainder:
        head = remainder.split("/", 1)[0]
        if "." in head or ":" in head or head == "localhost":
            registry = head
            path = remainder.split("/", 1)[1]

    tag: str | None = None
    if ":" in path:
        path, tag = path.rsplit(":", 1)

    return ImageRef(
        raw=reference,
        registry=registry,
        path=path,
        tag=tag,
        digest=digest,
        alias=alias,
    )


def stage_names(parsed: ParsedDockerfile) -> set[str]:
    names: set[str] = set()
    for instruction in parsed.of("FROM"):
        tokens = [t for t in instruction.value.split() if not t.startswith("--")]
        if len(tokens) >= 3 and tokens[1].upper() == "AS":
            names.add(tokens[2])
    return names
