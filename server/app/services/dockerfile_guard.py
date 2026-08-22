

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


def _check_from(instruction) -> Rejection | None:
    """Hold a FROM to the grammar Docker's own parser enforces.

    `FROM [--flag=value...] <image> [AS <name>]` — one argument, or three with AS in the
    middle. Nothing else builds. This is what catches a sentence typed after the keyword:
    `FROM what is the capital of Pakistan` satisfies "has a FROM" but is not a Dockerfile,
    and quoting the real constraint is more use to somebody than calling their input
    irrelevant. The image reference itself is not second-guessed — a name that does not
    exist in any registry is a pull failure, not a syntax error, and not this code's call.
    """
    words = instruction.value.split()
    arguments = [word for word in words if not word.startswith("--")]

    if len(arguments) == 1:
        return None
    if len(arguments) == 3 and arguments[1].upper() == "AS":
        return None

    if not arguments:
        detail = "it names no image at all"
    elif len(arguments) == 2:
        detail = f"it has a second word ({arguments[1]!r}) that is not 'AS <name>'"
    else:
        detail = f"it has {len(arguments)} arguments"

    return Rejection(
        "bad_from",
        f"Line {instruction.line} is not a valid FROM instruction: {detail}. FROM takes one "
        "image reference, optionally followed by 'AS <name>' — for example "
        "'FROM python:3.12-slim' or 'FROM node:20 AS builder'. Docker would reject this file "
        "before building it, with 'FROM requires either one or three arguments'.",
    )


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

    for instruction in parsed.of("FROM"):
        if rejection := _check_from(instruction):
            return rejection

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
