

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings
from app.services.dockerfile_lexer import (
    ImageRef,
    Instruction,
    ParsedDockerfile,
    parse,
    parse_from,
    stage_names,
)

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[3]

def shared_dir() -> Path:
    configured = get_settings().SHARED_DIR
    return Path(configured) if configured else _REPO_ROOT / "shared"


@lru_cache
def catalog() -> dict[str, dict]:
    path = shared_dir() / "rule-catalog.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise RuntimeError(
            f"Could not load the shared rule catalog at {path}: {e}. "
            "Set SHARED_DIR if the server runs outside the repository."
        ) from e
    return {rule["id"]: rule for rule in data["rules"]}


@lru_cache
def base_images() -> dict:
    path = shared_dir() / "base-images.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise RuntimeError(f"Could not load shared base-image data at {path}: {e}") from e


def verify_shared_data() -> None:
    rules = catalog()
    images = base_images()
    if not rules:
        raise RuntimeError("The shared rule catalog contains no rules")
    if not images.get("families"):
        raise RuntimeError("Shared base-image data contains no families")
    logger.info("rule engine: %d rules, %d image families loaded", len(rules), len(images["families"]))


_FAMILY_ALIASES = {
    "node": "node",
    "nodejs": "node",
    "python": "python",
    "python3": "python",
    "ubuntu": "ubuntu",
    "debian": "debian",
    "golang": "golang",
    "go": "golang",
    "openjdk": "openjdk",
    "eclipse-temurin": "openjdk",
    "temurin": "openjdk",
    "amazoncorretto": "openjdk",
    "nginx": "nginx",
    "ruby": "ruby",
    "php": "php",
}


def _family_for(ref: ImageRef) -> tuple[str, dict] | None:
    families = base_images()["families"]

    if "dotnet" in ref.path:
        return ("dotnet", families["dotnet"]) if "dotnet" in families else None

    key = _FAMILY_ALIASES.get(ref.name.lower())
    if key and key in families:
        return key, families[key]
    return None


def _best_recommendation(family: dict) -> dict | None:
    recommendations = family.get("recommendations") or []
    for rec in recommendations:
        if rec.get("recommended"):
            return rec
    return recommendations[0] if recommendations else None

FIX_REPLACE = "replace"
FIX_INSERT = "insert"
FIX_CREATE_DOCKERIGNORE = "createDockerignore"
FIX_AI_REWRITE = "aiRewrite"


@dataclass
class Finding:
    rule_id: str
    line: int
    column: int
    end_line: int
    end_column: int
    message: str = ""
    detail: str = ""
    replacement: str | None = None
    fix_kind: str | None = None

    fix_span: tuple[int, int, int, int] | None = None
    size_impact_mb: int | None = None
    savings_mb: int | None = None
    compatibility: int | None = None
    suggested_image: str | None = None

    def _fix_range(self) -> dict:
        """The range ``replacement`` replaces. Defaults to the diagnostic range."""
        line, column, end_line, end_column = self.fix_span or (
            self.line,
            self.column,
            self.end_line,
            self.end_column,
        )
        return {"line": line, "column": column, "endLine": end_line, "endColumn": end_column}

    def to_dict(self) -> dict:
        """Merge the catalog metadata in, producing what clients actually render."""
        rule = catalog()[self.rule_id]
        return {
            "ruleId": self.rule_id,
            "title": rule["title"],
            "severity": rule["severity"],
            "category": rule["category"],
            "instruction": rule["instruction"],
            "problem": self.message or rule["problem"],
            "explanation": rule["explanation"],
            "securityImpact": rule["securityImpact"],
            "performanceImpact": rule["performanceImpact"],
            "docsUrl": rule["docsUrl"],
            "quickFixTitle": rule["quickFixTitle"],
            "detail": self.detail,
            "line": self.line,
            "column": self.column,
            "endLine": self.end_line,
            "endColumn": self.end_column,
            "replacement": self.replacement,
            "fixKind": self.fix_kind,
            "fixRange": self._fix_range(),
            "autoFixable": self.fix_kind is not None,
            "sizeImpactMb": (
                self.size_impact_mb if self.size_impact_mb is not None else rule["sizeImpactMb"]
            ),
            "savingsMb": self.savings_mb if self.savings_mb is not None else rule["savingsMb"],
            "compatibility": self.compatibility,
            "suggestedImage": self.suggested_image,
        }


def _finding(rule_id: str, span: tuple[int, int, int, int], **kwargs) -> Finding:
    line, column, end_line, end_column = span
    return Finding(
        rule_id=rule_id,
        line=line,
        column=column,
        end_line=end_line,
        end_column=end_column,
        **kwargs,
    )


@dataclass
class RuleContext:
    content: str
    parsed: ParsedDockerfile
    aliases: set[str]

    has_dockerignore: bool | None = None
    dockerignore: str | None = None
    bloat_candidates: list[str] = field(default_factory=list)
    images: dict[int, ImageRef] = field(default_factory=dict)

    @property
    def final_stage(self) -> int:
        return self.parsed.final_stage_index

    def final_image(self) -> ImageRef | None:
        return self.images.get(self.final_stage)

_SEGMENT_SPLIT_RE = re.compile(r"&&|\|\||;")


def _segments(command: str) -> list[str]:

    return [s.strip() for s in _SEGMENT_SPLIT_RE.split(command) if s.strip()]


def _is_bare_install(segment: str, tool_pattern: str) -> bool:

    match = re.match(tool_pattern, segment, re.IGNORECASE)
    if not match:
        return False
    rest = segment[match.end() :].strip()
    if not rest:
        return True
    return all(token.startswith("-") for token in rest.split())


def _rewrite_from(instruction: Instruction, ref: ImageRef, new_image: str) -> str:
    return re.sub(re.escape(ref.raw), new_image, instruction.raw, count=1)


def _sub_in_raw(instruction: Instruction, pattern: str, replacement: str) -> str | None:
    fixed, count = re.subn(pattern, replacement, instruction.raw, count=1, flags=re.IGNORECASE)
    return fixed if count else None


_FLOATING_TAGS = {"lts", "stable", "current", "edge", "alpine", "slim", "mainline", "jre", "jdk"}


def _rule_base_image_size(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []

    for instruction in ctx.parsed.of("FROM"):
        ref = ctx.images.get(instruction.stage_index)
        if ref is None or ref.is_stage_reference or ref.is_scratch or ref.is_distroless:
            continue

        family = _family_for(ref)
        if family is None:
            continue
        name, data = family

        if name == "ubuntu":
            continue
        if ref.is_slim_variant:
            continue

        best = _best_recommendation(data)
        if best is None:
            continue

        current_mb = data["defaultSizeMb"]
        savings = current_mb - best["sizeMb"]
        if savings < 40:
            continue

        if "distroless" in best["image"] and instruction.stage_index != ctx.final_stage:
            alternatives = [r for r in data["recommendations"] if "distroless" not in r["image"]]
            if not alternatives:
                continue
            best = alternatives[0]
            savings = current_mb - best["sizeMb"]

        findings.append(
            _finding(
                "large-base-image",
                instruction.column_of(ref.raw),
                message=(
                    f"{ref.raw} is roughly {current_mb} MB - {best['image']} does the same "
                    f"job in about {best['sizeMb']} MB."
                ),
                detail=(
                    f"Estimated saving: ~{savings} MB. "
                    f"Compatibility: ~{best['compatibility']}% likely to be a drop-in swap. "
                    f"{best.get('note', '')}".strip()
                ),
                replacement=_rewrite_from(instruction, ref, best["image"]),
                fix_kind=FIX_REPLACE,
                fix_span=instruction.full_span(),
                size_impact_mb=current_mb,
                savings_mb=savings,
                compatibility=best["compatibility"],
                suggested_image=best["image"],
            )
        )

    return findings


def _rule_ubuntu_base(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []

    for instruction in ctx.parsed.of("FROM"):
        ref = ctx.images.get(instruction.stage_index)
        if ref is None or ref.is_stage_reference or ref.name.lower() != "ubuntu":
            continue

        family = base_images()["families"]["ubuntu"]
        best = _best_recommendation(family)
        if best is None:
            continue

        savings = family["defaultSizeMb"] - best["sizeMb"]
        findings.append(
            _finding(
                "ubuntu-base-image",
                instruction.column_of(ref.raw),
                detail=(
                    f"{best['image']} is about {best['sizeMb']} MB against "
                    f"~{family['defaultSizeMb']} MB, and shares almost all package names. "
                    f"Compatibility: ~{best['compatibility']}%. {best.get('note', '')}".strip()
                ),
                replacement=_rewrite_from(instruction, ref, best["image"]),
                fix_kind=FIX_REPLACE,
                fix_span=instruction.full_span(),
                savings_mb=max(savings, 0),
                compatibility=best["compatibility"],
                suggested_image=best["image"],
            )
        )

    return findings


def _rule_unpinned_base(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []

    for instruction in ctx.parsed.of("FROM"):
        ref = ctx.images.get(instruction.stage_index)
        if ref is None or ref.is_stage_reference or ref.is_scratch:
            continue
        if ref.digest:
            continue
        if ref.tag not in (None, "latest"):
            continue

        family = _family_for(ref)
        suggestion = None
        if family:
            best = _best_recommendation(family[1])
            if best:
                suggestion = best["image"]

        findings.append(
            _finding(
                "unpinned-base-image",
                instruction.column_of(ref.raw),
                message=(
                    f"{ref.raw} has no version tag - it resolves to :latest."
                    if ref.tag is None
                    else f"{ref.raw} uses the mutable :latest tag."
                ),
                detail=(
                    f"Suggested: {suggestion}, which pins a version."
                    if suggestion
                    else "Pin at least a major and minor version, or a digest for a fully "
                    "reproducible build."
                ),
                replacement=(
                    _rewrite_from(instruction, ref, suggestion) if suggestion else None
                ),
                fix_kind=FIX_REPLACE if suggestion else None,
                suggested_image=suggestion,
            )
        )

    return findings


def _rule_floating_tag(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []

    for instruction in ctx.parsed.of("FROM"):
        ref = ctx.images.get(instruction.stage_index)
        if ref is None or ref.is_stage_reference or ref.is_scratch or ref.digest:
            continue
        tag = (ref.tag or "").lower()
        if not tag or tag == "latest":
            continue

        base_component = tag.split("-")[0]
        floats = (
            tag in _FLOATING_TAGS
            or base_component in _FLOATING_TAGS
            or re.fullmatch(r"\d+", base_component) is not None
        )
        if not floats:
            continue

        findings.append(
            _finding(
                "floating-major-tag",
                instruction.column_of(ref.raw),
                message=f"The tag '{ref.tag}' moves to new releases without warning.",
                detail="Pin the minor version so upgrades arrive as a reviewable change.",
            )
        )

    return findings

_OMIT_FLAGS = ("--omit=dev", "--production", "--only=production", "--only=prod", "--no-dev")

_COMPILE_MARKERS = (
    r"npm\s+run\s+build",
    r"yarn\s+build",
    r"pnpm\s+(run\s+)?build",
    r"go\s+build",
    r"cargo\s+build",
    r"mvn\b",
    r"gradle\b",
    r"dotnet\s+(build|publish)",
    r"\bmake\b",
    r"\btsc\b",
    r"webpack",
    r"vite\s+build",
    r"\bjavac\b",
    r"\brustc\b",
    r"build-essential",
    r"\bgcc\b",
    r"\bg\+\+\b",
)


def _is_global_install(segment: str) -> bool:
    tokens = segment.split()
    return "-g" in tokens or "--global" in tokens


def _has_build_step(ctx: RuleContext) -> bool:
    """Whether this Dockerfile builds something, rather than only installing runtime deps."""
    for instruction in ctx.parsed.of("RUN"):
        if any(re.search(m, instruction.value, re.IGNORECASE) for m in _COMPILE_MARKERS):
            return True

        for segment in _segments(instruction.value):
            if _is_global_install(segment):
                continue
            if any(flag in segment for flag in _OMIT_FLAGS):
                continue
            if _is_bare_install(segment, r"(?:npm|pnpm)\s+(?:ci|install|i)\b"):
                return True
            if _is_bare_install(segment, r"yarn(?:\s+install)?\b"):
                return True
    return False


def _rule_single_stage(ctx: RuleContext) -> list[Finding]:
    if ctx.parsed.stage_count != 1:
        return []
    if not _has_build_step(ctx):
        return []

    from_instructions = ctx.parsed.of("FROM")
    if not from_instructions:
        return []
    instruction = from_instructions[0]

    ref = ctx.images.get(instruction.stage_index)
    final_hint = ""
    if ref:
        family = _family_for(ref)
        if family:
            suggested = base_images()["distrolessFinalStages"].get(family[0])
            if suggested:
                final_hint = f" A good final stage for this project would be {suggested}."

    return [
        _finding(
            "single-stage-build",
            instruction.full_span(),
            detail=(
                "Build in one stage, then copy only the built artefact into a clean final "
                f"stage.{final_hint} Run ImageShrink: Optimize Dockerfile to generate the "
                "rewrite."
            ),
            fix_kind=FIX_AI_REWRITE,
        )
    ]


def _rule_npm(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []

    for instruction in ctx.parsed.of("RUN"):
        segments = [s for s in _segments(instruction.value) if not _is_global_install(s)]

        for segment in segments:
            if _is_bare_install(segment, r"npm\s+(?:install|i)\b"):
                fixed = _sub_in_raw(instruction, r"npm\s+(?:install|i)\b", "npm ci --omit=dev")
                findings.append(
                    _finding(
                        "npm-install-not-ci",
                        instruction.column_of("npm"),
                        detail=(
                            "npm ci installs exactly what package-lock.json specifies and "
                            "skips resolution, so it is faster and deterministic. Requires "
                            "a lockfile to be committed and COPYed in."
                        ),
                        replacement=fixed,
                        fix_kind=FIX_REPLACE if fixed else None,
                        fix_span=instruction.full_span(),
                    )
                )
                break

        if instruction.stage_index != ctx.final_stage:
            continue
        for segment in segments:
            if not re.search(r"npm\s+(?:ci|install|i)\b", segment, re.IGNORECASE):
                continue
            if any(flag in segment for flag in _OMIT_FLAGS):
                continue
            fixed = _sub_in_raw(
                instruction, r"(npm\s+(?:ci|install|i))\b", r"\1 --omit=dev"
            )
            findings.append(
                _finding(
                    "npm-includes-dev-dependencies",
                    instruction.column_of("npm"),
                    detail=(
                        "This is the final stage, so devDependencies installed here ship to "
                        "production. Test runners and bundlers routinely outweigh the app."
                    ),
                    replacement=fixed,
                    fix_kind=FIX_REPLACE if fixed else None,
                    fix_span=instruction.full_span(),
                )
            )
            break

    return findings


def _rule_yarn(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []

    for instruction in ctx.parsed.of("RUN"):
        for segment in _segments(instruction.value):
            if not _is_bare_install(segment, r"yarn(?:\s+install)?\b"):
                continue
            if "--immutable" in segment or "--frozen-lockfile" in segment:
                continue
            fixed = _sub_in_raw(
                instruction, r"yarn(\s+install)?\b", "yarn install --immutable --production"
            )
            findings.append(
                _finding(
                    "yarn-install-not-immutable",
                    instruction.column_of("yarn"),
                    detail=(
                        "Use --immutable on Yarn 2+ or --frozen-lockfile on Yarn 1 so a "
                        "lockfile mismatch fails the build instead of resolving silently."
                    ),
                    replacement=fixed,
                    fix_kind=FIX_REPLACE if fixed else None,
                    fix_span=instruction.full_span(),
                )
            )
            break

    return findings


def _rule_apt(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []
    install_re = r"apt(?:-get)?\s+install"

    apt_installs = [i for i in ctx.parsed.of("RUN") if re.search(install_re, i.value, re.I)]

    for instruction in ctx.parsed.of("RUN"):
        value = instruction.value
        installs = re.search(install_re, value, re.IGNORECASE) is not None

        if installs and "/var/lib/apt/lists" not in value:
            trailing = " \\\n    && rm -rf /var/lib/apt/lists/*"
            fixed = instruction.raw.rstrip() + (
                trailing if instruction.is_multiline else " && rm -rf /var/lib/apt/lists/*"
            )
            findings.append(
                _finding(
                    "apt-missing-cleanup",
                    instruction.column_of("apt"),
                    detail=(
                        "Deleting the lists in a later RUN does not help - they are already "
                        "committed to this layer and both copies ship."
                    ),
                    replacement=fixed,
                    fix_kind=FIX_REPLACE,
                    fix_span=instruction.full_span(),
                )
            )

        if installs and "--no-install-recommends" not in value:
            fixed = _sub_in_raw(
                instruction, r"(apt(?:-get)?\s+install)", r"\1 --no-install-recommends"
            )
            findings.append(
                _finding(
                    "apt-missing-no-install-recommends",
                    instruction.column_of("apt"),
                    detail=(
                        "Recommended packages are conveniences for interactive systems. "
                        "Install anything genuinely required by name instead."
                    ),
                    replacement=fixed,
                    fix_kind=FIX_REPLACE if fixed else None,
                    fix_span=instruction.full_span(),
                )
            )

        if re.search(r"apt(?:-get)?\s+(dist-)?upgrade", value, re.IGNORECASE):
            findings.append(
                _finding(
                    "apt-get-upgrade",
                    instruction.column_of("apt"),
                    detail=(
                        "Pin a base image that is already patched and rebuild on a schedule, "
                        "so upgrades arrive as a reviewable change of tag."
                    ),
                )
            )

        if re.search(r"apt(?:-get)?\s+update", value, re.IGNORECASE) and not installs:
            later_install = any(other.line > instruction.line for other in apt_installs)
            if later_install:
                findings.append(
                    _finding(
                        "apt-update-in-separate-layer",
                        instruction.column_of("apt"),
                        detail=(
                            "Docker will reuse this cached layer while the install layer "
                            "re-runs, so apt looks for versions the mirror no longer has and "
                            "the build fails with a 404. Chain update and install in one RUN."
                        ),
                    )
                )

    return findings


def _rule_pip(ctx: RuleContext) -> list[Finding]:
    if re.search(r"PIP_NO_CACHE_DIR", ctx.content, re.IGNORECASE):
        return []

    findings: list[Finding] = []
    pip_re = r"(?:python3?\s+-m\s+)?pip3?\s+install"

    for instruction in ctx.parsed.of("RUN"):
        if not re.search(pip_re, instruction.value, re.IGNORECASE):
            continue
        if "--no-cache-dir" in instruction.value:
            continue
        fixed = _sub_in_raw(instruction, f"({pip_re})", r"\1 --no-cache-dir")
        findings.append(
            _finding(
                "pip-missing-no-cache-dir",
                instruction.column_of("pip"),
                detail=(
                    "A container installs once, so pip's wheel cache has no second install "
                    "to accelerate - it is pure overhead in the layer."
                ),
                replacement=fixed,
                fix_kind=FIX_REPLACE if fixed else None,
                fix_span=instruction.full_span(),
            )
        )

    return findings


def _rule_apk(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []

    for instruction in ctx.parsed.of("RUN"):
        value = instruction.value
        if not re.search(r"apk\s+add", value, re.IGNORECASE):
            continue
        if "--no-cache" in value or "/var/cache/apk" in value:
            continue
        fixed = _sub_in_raw(instruction, r"(apk\s+add)", r"\1 --no-cache")
        findings.append(
            _finding(
                "apk-missing-no-cache",
                instruction.column_of("apk"),
                detail="--no-cache fetches the index, installs, and discards it in one step.",
                replacement=fixed,
                fix_kind=FIX_REPLACE if fixed else None,
                fix_span=instruction.full_span(),
            )
        )

    return findings


def _rule_curl_pipe_shell(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []
    pattern = re.compile(r"(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b", re.IGNORECASE)

    for instruction in ctx.parsed.of("RUN"):
        if pattern.search(instruction.value):
            findings.append(
                _finding(
                    "curl-pipe-to-shell",
                    instruction.full_span(),
                    detail=(
                        "Download to a file, verify a checksum or signature, then execute - "
                        "so a compromised upstream host cannot run arbitrary code in your build."
                    ),
                )
            )

    return findings


def _rule_sudo(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []

    for instruction in ctx.parsed.of("RUN"):
        if not re.search(r"\bsudo\b", instruction.value):
            continue
        findings.append(
            _finding(
                "sudo-in-container",
                instruction.column_of("sudo"),
                detail=(
                    "Build steps already run as root, so sudo adds a package and an "
                    "escalation path for nothing. Use USER to change accounts."
                ),
                replacement=_sub_in_raw(instruction, r"sudo\s+", ""),
                fix_kind=FIX_REPLACE,
                fix_span=instruction.full_span(),
            )
        )

    return findings


def _rule_consecutive_runs(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []

    for stage in range(max(ctx.parsed.stage_count, 1)):
        instructions = ctx.parsed.in_stage(stage)
        streak: list[Instruction] = []

        def flush(streak: list[Instruction]) -> None:
            if len(streak) < 3:
                return
            findings.append(
                Finding(
                    rule_id="separate-run-layers",
                    line=streak[0].line,
                    column=1,
                    end_line=streak[-1].end_line,
                    end_column=len(streak[-1].raw.splitlines()[-1]) + 1,
                    message=f"{len(streak)} consecutive RUN instructions create {len(streak)} layers.",
                    detail=(
                        "Chaining related commands with && keeps intermediate files out of "
                        "the image. Keep commands that change at different rates separate, "
                        "though - merging those throws away useful caching."
                    ),
                )
            )

        for instruction in instructions:
            if instruction.keyword == "RUN":
                streak.append(instruction)
            else:
                flush(streak)
                streak = []
        flush(streak)

    return findings


_DOCKERIGNORE_TEMPLATE = """\
# Version control
.git
.gitignore

# Dependencies - reinstalled inside the image
node_modules
vendor
__pycache__
*.pyc
.venv
venv

# Build output
dist
build
coverage
*.log

# Local configuration and secrets - never copy these into an image
.env
.env.*
*.pem
*.key

# Editor and OS noise
.vscode
.idea
.DS_Store

# Docker files themselves
Dockerfile*
docker-compose*.yml
.dockerignore
"""


def _copies_whole_context(instruction: Instruction) -> bool:
    tokens = [t for t in instruction.value.split() if not t.startswith("--")]
    if len(tokens) < 2:
        return False
    return tokens[0] in (".", "./")


def _rule_copy_entire_context(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []

    multi_stage = ctx.parsed.stage_count > 1

    for instruction in ctx.parsed.of("COPY", "ADD"):
        if not _copies_whole_context(instruction):
            continue

        unbounded = ctx.has_dockerignore is False
        ships_to_production = instruction.stage_index == ctx.final_stage and multi_stage
        if not unbounded and not ships_to_production:
            continue

        extra = ""
        if ctx.bloat_candidates:
            listed = ", ".join(ctx.bloat_candidates[:6])
            extra = f" Paths in this workspace that would come along: {listed}."
        elif ctx.has_dockerignore is False:
            extra = " There is no .dockerignore, so nothing is excluded."

        findings.append(
            _finding(
                "copy-entire-context",
                instruction.full_span(),
                detail=(
                    "Copy the paths you need explicitly, or keep a complete .dockerignore."
                    + extra
                ),
                replacement=_DOCKERIGNORE_TEMPLATE if ctx.has_dockerignore is False else None,
                fix_kind=FIX_CREATE_DOCKERIGNORE if ctx.has_dockerignore is False else None,
            )
        )

    return findings


def _rule_missing_dockerignore(ctx: RuleContext) -> list[Finding]:
    if ctx.has_dockerignore is not False:
        return []

    broad = [i for i in ctx.parsed.of("COPY", "ADD") if _copies_whole_context(i)]
    if not broad:
        return []

    anchor = broad[0]
    extra = ""
    if ctx.bloat_candidates:
        extra = f" Detected in this workspace: {', '.join(ctx.bloat_candidates[:8])}."

    return [
        _finding(
            "missing-dockerignore",
            anchor.full_span(),
            detail=(
                "Everything in the context is uploaded to the daemon before the build "
                "starts, and anything a COPY matches lands in the image." + extra
            ),
            replacement=_DOCKERIGNORE_TEMPLATE,
            fix_kind=FIX_CREATE_DOCKERIGNORE,
        )
    ]


_DEPENDENCY_MANIFESTS = (
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "requirements.txt",
    "pyproject.toml",
    "poetry.lock",
    "go.mod",
    "go.sum",
    "Gemfile",
    "composer.json",
    "Cargo.toml",
)

_DEPENDENCY_INSTALL_RE = re.compile(
    r"(npm\s+(ci|install|i)\b|yarn(\s+install)?\b|pnpm\s+(install|i)\b|pip3?\s+install"
    r"|poetry\s+install|bundle\s+install|composer\s+install|go\s+mod\s+download"
    r"|cargo\s+fetch|dotnet\s+restore)",
    re.IGNORECASE,
)


def _rule_copy_before_install(ctx: RuleContext) -> list[Finding]:
    """A broad COPY before the dependency install destroys layer caching."""
    findings: list[Finding] = []

    for stage in range(max(ctx.parsed.stage_count, 1)):
        instructions = ctx.parsed.in_stage(stage)

        broad_copy: Instruction | None = None
        for instruction in instructions:
            if instruction.keyword in ("COPY", "ADD") and _copies_whole_context(instruction):
                broad_copy = instruction
                break
        if broad_copy is None:
            continue

        install = next(
            (
                i
                for i in instructions
                if i.keyword == "RUN"
                and i.line > broad_copy.line
                and _DEPENDENCY_INSTALL_RE.search(i.value)
            ),
            None,
        )
        if install is None:
            continue

        earlier_manifest_copy = any(
            i.keyword == "COPY"
            and i.line < broad_copy.line
            and any(manifest in i.value for manifest in _DEPENDENCY_MANIFESTS)
            for i in instructions
        )
        if earlier_manifest_copy:
            continue

        findings.append(
            _finding(
                "copy-before-dependency-install",
                broad_copy.full_span(),
                detail=(
                    f"The install on line {install.line} re-runs whenever any file changes. "
                    "Copy the manifest and lockfile first, install, then copy the source."
                ),
            )
        )

    return findings


def _rule_add_instead_of_copy(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []
    archive_suffixes = (".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz", ".gz", ".bz2", ".xz", ".zip")

    for instruction in ctx.parsed.of("ADD"):
        tokens = [t for t in instruction.value.split() if not t.startswith("--")]
        if not tokens:
            continue
        source = tokens[0]

        if source.startswith(("http://", "https://", "git@")):
            continue
        if source.lower().endswith(archive_suffixes):
            continue

        findings.append(
            _finding(
                "add-instead-of-copy",
                instruction.column_of("ADD"),
                detail="COPY does exactly one thing, so it is the safer default here.",
                replacement=_sub_in_raw(instruction, r"^\s*ADD\b", "COPY"),
                fix_kind=FIX_REPLACE,
                fix_span=instruction.full_span(),
            )
        )

    return findings


def _rule_missing_user(ctx: RuleContext) -> list[Finding]:
    if ctx.parsed.stage_count == 0:
        return []

    final_stage = ctx.final_stage
    if any(i.keyword == "USER" and i.value.strip() not in ("root", "0") for i in ctx.parsed.in_stage(final_stage)):
        return []

    final = ctx.final_image()
    if final and (final.tag or "").lower().endswith("nonroot"):
        return []

    entrypoints = [i for i in ctx.parsed.in_stage(final_stage) if i.keyword in ("CMD", "ENTRYPOINT")]
    if entrypoints:
        anchor_line = entrypoints[0].line
    else:
        stage_instructions = ctx.parsed.in_stage(final_stage)
        anchor_line = (stage_instructions[-1].end_line + 1) if stage_instructions else 1

    family = _family_for(final) if final else None
    if final and (final.is_scratch or final.is_distroless):
        block = "USER 65534:65534\n"
    elif family and family[0] == "node":
        block = "USER node\n"
    elif final and "alpine" in f"{final.tag or ''}{final.path}".lower():
        block = (
            "RUN addgroup -S -g 1001 appuser \\\n"
            "    && adduser -S -u 1001 -G appuser appuser\n"
            "USER appuser\n"
        )
    else:
        block = (
            "RUN groupadd --system --gid 1001 appuser \\\n"
            "    && useradd --system --uid 1001 --gid appuser appuser\n"
            "USER appuser\n"
        )

    return [
        Finding(
            rule_id="missing-user-instruction",
            line=anchor_line,
            column=1,
            end_line=anchor_line,
            end_column=1,
            detail=(
                "Switch to an unprivileged user after the last step that needs elevated "
                "permissions. Make sure any paths the process writes to are owned by it."
            ),
            replacement=block,
            fix_kind=FIX_INSERT,
        )
    ]


def _rule_hardcoded_secret(ctx: RuleContext) -> list[Finding]:
    findings: list[Finding] = []
    secret_key = re.compile(
        r"(API[_-]?KEY|SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE[_-]?KEY|ACCESS[_-]?KEY"
        r"|CREDENTIAL|AUTH)",
        re.IGNORECASE,
    )

    for instruction in ctx.parsed.of("ENV", "ARG"):
        for key, value in _key_values(instruction.value):
            if not secret_key.search(key):
                continue
            if not value or value.startswith("$"):
                continue
            if len(value) < 6:
                continue

            findings.append(
                _finding(
                    "hardcoded-secret",
                    instruction.column_of(key),
                    message=f"{key} appears to have a credential written directly into the Dockerfile.",
                    detail=(
                        "Values in ENV and ARG are readable via docker history by anyone who "
                        "can pull the image, and removing the line later does not remove it "
                        "from earlier layers. Treat this value as leaked and rotate it. Pass "
                        "secrets at runtime, or use a BuildKit secret mount at build time."
                    ),
                )
            )

    return findings


def _key_values(value: str) -> list[tuple[str, str]]:
    """Parse ENV/ARG assignments, handling both `K=V` and the legacy `ENV K V` form."""
    value = value.strip()
    if not value:
        return []

    if "=" not in value:
        parts = value.split(None, 1)
        return [(parts[0], parts[1].strip() if len(parts) > 1 else "")]

    pairs: list[tuple[str, str]] = []
    for chunk in re.findall(r"(\S+?)=(\"[^\"]*\"|'[^']*'|\S*)", value):
        key, raw_value = chunk
        pairs.append((key, raw_value.strip("\"'")))
    return pairs


def _rule_missing_healthcheck(ctx: RuleContext) -> list[Finding]:
    if ctx.parsed.has("HEALTHCHECK") or ctx.parsed.stage_count == 0:
        return []
    starters = [i for i in ctx.parsed.of("CMD", "ENTRYPOINT")]
    if not starters:
        return []

    exposed = ctx.parsed.of("EXPOSE")
    port = "8080"
    note = " Port 8080 is a guess - set it to the port your app listens on."
    if exposed:
        first = exposed[0].value.split("/")[0].split()[0]
        if first.isdigit():
            port = first
            note = ""

    anchor_line = starters[0].line
    block = (
        "HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\\n"
        f"    CMD wget -qO- http://127.0.0.1:{port}/health || exit 1\n"
    )

    return [
        Finding(
            rule_id="missing-healthcheck",
            line=anchor_line,
            column=1,
            end_line=anchor_line,
            end_column=1,
            detail=(
                "Point this at an endpoint that fails when the app is genuinely unhealthy; a "
                "check that only proves the process exists is little better than none." + note
            ),
            replacement=block,
            fix_kind=FIX_INSERT,
        )
    ]

_RULES = (
    _rule_base_image_size,
    _rule_ubuntu_base,
    _rule_unpinned_base,
    _rule_floating_tag,
    _rule_single_stage,
    _rule_npm,
    _rule_yarn,
    _rule_apt,
    _rule_pip,
    _rule_apk,
    _rule_curl_pipe_shell,
    _rule_sudo,
    _rule_consecutive_runs,
    _rule_copy_entire_context,
    _rule_missing_dockerignore,
    _rule_copy_before_install,
    _rule_add_instead_of_copy,
    _rule_missing_user,
    _rule_hardcoded_secret,
    _rule_missing_healthcheck,
)

_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def build_context(
    content: str,
    *,
    has_dockerignore: bool | None = None,
    dockerignore: str | None = None,
    bloat_candidates: list[str] | None = None,
) -> RuleContext:
    parsed = parse(content)
    aliases = stage_names(parsed)

    images: dict[int, ImageRef] = {}
    for instruction in parsed.of("FROM"):
        ref = parse_from(instruction, aliases)
        if ref is not None:
            images[instruction.stage_index] = ref

    resolved_has = has_dockerignore
    if dockerignore is not None:
        resolved_has = True

    return RuleContext(
        content=content,
        parsed=parsed,
        aliases=aliases,
        has_dockerignore=resolved_has,
        dockerignore=dockerignore,
        bloat_candidates=bloat_candidates or [],
        images=images,
    )


def analyze(
    content: str,
    *,
    has_dockerignore: bool | None = None,
    dockerignore: str | None = None,
    bloat_candidates: list[str] | None = None,
) -> list[Finding]:
    """Run every rule. Ordered by severity, then by position."""
    ctx = build_context(
        content,
        has_dockerignore=has_dockerignore,
        dockerignore=dockerignore,
        bloat_candidates=bloat_candidates,
    )

    findings: list[Finding] = []
    for rule in _RULES:
        try:
            findings.extend(rule(ctx))
        except Exception:  
            logger.exception("rule %s raised", getattr(rule, "__name__", rule))

    findings.sort(
        key=lambda f: (_SEVERITY_ORDER.get(catalog()[f.rule_id]["severity"], 9), f.line, f.column)
    )
    return findings


def score(findings: list[Finding]) -> dict:
    weights = {"critical": 34, "high": 16, "medium": 8, "low": 3, "info": 1}
    buckets = {
        "optimizationScore": ("size", "maintainability"),
        "securityScore": ("security",),
        "performanceScore": ("performance",),
    }

    scores: dict[str, int] = {}
    for label, categories in buckets.items():
        penalty = 0.0
        seen = 0
        relevant = [f for f in findings if catalog()[f.rule_id]["category"] in categories]
        for finding in relevant:
            severity = catalog()[finding.rule_id]["severity"]
            seen += 1
            penalty += weights.get(severity, 5) / seen
        scores[label] = max(0, min(100, round(100 - penalty)))

    savings = sum(
        f.savings_mb if f.savings_mb is not None else catalog()[f.rule_id]["savingsMb"]
        for f in findings
    )

    return {
        **scores,
        "findingCount": len(findings),
        "bySeverity": {
            severity: sum(1 for f in findings if catalog()[f.rule_id]["severity"] == severity)
            for severity in _SEVERITY_ORDER
        },
        "estimatedSavingsMb": savings,
    }


def to_dicts(findings: list[Finding]) -> list[dict]:
    return [f.to_dict() for f in findings]
