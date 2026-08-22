

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.dockerfile_lexer import parse

_FILENAME_RE = re.compile(
    r"""^(
        (docker|container)file(\.[\w.-]+)?     # Dockerfile, Containerfile, Dockerfile.prod
        |[\w.-]+\.(docker|container)file       # prod.Dockerfile
    )$""",
    re.IGNORECASE | re.VERBOSE,
)

MAX_JUNK_RATIO = 0.4

_SAMPLE_CHARS = 60


@dataclass(frozen=True)
class Rejection:
    """Why the input was refused. ``message`` is shown to the user verbatim."""

    code: str
    message: str


def check_filename(filename: str) -> Rejection | None:
    """Return why ``filename`` is not a Dockerfile's name, or ``None`` if it could be."""
    name = (filename or "").strip().replace("\\", "/").rsplit("/", 1)[-1]

    if not name:
        return Rejection("no_filename", "That upload had no filename.")

    if not _FILENAME_RE.match(name):
        return Rejection(
            "wrong_filename",
            f"'{name}' is not a Dockerfile. Upload a file named Dockerfile, "
            "Dockerfile.<something>, <something>.Dockerfile or Containerfile - "
            "or use Paste Content instead.",
        )

    return None


def _is_ignorable(line: str) -> bool:
    stripped = line.strip()
    return not stripped or stripped.startswith("#")


def _covered_lines(content: str) -> set[int]:
    """1-based line numbers the lexer could read as part of an instruction."""
    covered: set[int] = set()
    for instruction in parse(content).instructions:
        covered.update(range(instruction.line, instruction.end_line + 1))
    return covered


def check(content: str) -> Rejection | None:
    """Return why ``content`` is not a Dockerfile, or ``None`` if it looks like one."""
    if "\x00" in content:
        return Rejection(
            "binary",
            "That file is binary, not text. Upload a Dockerfile - a plain text file of "
            "Docker instructions.",
        )

    lines = content.splitlines()
    meaningful = [line for line in lines if not _is_ignorable(line)]

    if not meaningful:
        return Rejection(
            "empty",
            "There is nothing to analyze - the file is empty or contains only comments.",
        )

    parsed = parse(content)

    if not parsed.has("FROM"):
        return Rejection(
            "no_from",
            "This does not look like a Dockerfile: it has no FROM instruction, which every "
            "Dockerfile must start with. Paste the contents of a Dockerfile and try again.",
        )

    covered = _covered_lines(content)
    junk = [
        line
        for number, line in enumerate(lines, start=1)
        if number not in covered and not _is_ignorable(line)
    ]

    if len(junk) / len(meaningful) > MAX_JUNK_RATIO:
        sample = junk[0].strip()[:_SAMPLE_CHARS]
        return Rejection(
            "mostly_prose",
            "This looks like ordinary text rather than a Dockerfile - most of it is not "
            f"Docker instructions (for example: {sample!r}). Paste the contents of a "
            "Dockerfile and try again.",
        )

    return None
