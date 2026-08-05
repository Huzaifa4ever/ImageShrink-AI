
from __future__ import annotations

import pytest

from app.services import rule_engine
from app.services.rule_engine import analyze, catalog, score

IDIOMATIC = """\
# syntax=docker/dockerfile:1
FROM node:22.11-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.11-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/server.js"]
"""

NEGLECTED = """\
FROM node
ENV API_KEY=sk-live-abc123def456
WORKDIR /app
COPY . .
RUN npm install
RUN apt-get update
RUN apt-get install -y curl python3
RUN pip install flask
RUN curl -fsSL https://get.example.com/install.sh | sh
ADD ./config.yml /etc/config.yml
EXPOSE 3000
CMD ["node", "server.js"]
"""


def rule_ids(content: str, **kwargs) -> list[str]:
    return [f.rule_id for f in analyze(content, **kwargs)]

def test_idiomatic_dockerfile_is_clean():
    findings = analyze(IDIOMATIC, has_dockerignore=True)

    assert findings == [], [f.rule_id for f in findings]

    scores = score(findings)
    assert scores["optimizationScore"] == 100
    assert scores["securityScore"] == 100
    assert scores["performanceScore"] == 100


def apply_fix(content: str, finding: rule_engine.Finding) -> str:
    data = finding.to_dict()
    span = data["fixRange"]
    lines = content.split("\n")

    if data["fixKind"] == rule_engine.FIX_REPLACE:
        head = lines[: span["line"] - 1]
        tail = lines[span["endLine"] :]
        return "\n".join(head + data["replacement"].split("\n") + tail)

    if data["fixKind"] == rule_engine.FIX_INSERT:
        index = span["line"] - 1
        inserted = data["replacement"].rstrip("\n").split("\n")
        return "\n".join(lines[:index] + inserted + lines[index:])

    raise AssertionError(f"not a text fix: {data['fixKind']}")


@pytest.mark.parametrize(
    "content,dockerignore",
    [(NEGLECTED, False), (IDIOMATIC, True)],
    ids=["neglected", "idiomatic"],
)
def test_every_quick_fix_removes_its_own_finding(content: str, dockerignore: bool):
    """Applying a fix must actually resolve the finding that offered it."""
    findings = analyze(content, has_dockerignore=dockerignore)
    textual = [
        f for f in findings if f.fix_kind in (rule_engine.FIX_REPLACE, rule_engine.FIX_INSERT)
    ]
    assert textual or content is IDIOMATIC, "expected some fixable findings to check"

    for finding in textual:
        patched = apply_fix(content, finding)
        remaining = rule_ids(patched, has_dockerignore=dockerignore)
        assert finding.rule_id not in remaining, (
            f"{finding.rule_id} survived its own fix.\n"
            f"--- replacement ---\n{finding.replacement}\n--- result ---\n{patched}"
        )


def test_a_fix_never_duplicates_the_instruction_keyword():
    findings = analyze("FROM node\nUSER node\nCMD [\"x\"]\n")
    from_fix = next(f for f in findings if f.rule_id == "large-base-image")

    patched = apply_fix("FROM node\nUSER node\nCMD [\"x\"]\n", from_fix)

    assert "FROM FROM" not in patched
    assert patched.startswith("FROM node:22-alpine")

def test_flags_a_full_base_image_with_the_specific_saving():
    findings = [f for f in analyze("FROM node:22\nUSER node\nCMD [\"x\"]\n") if f.rule_id == "large-base-image"]

    assert len(findings) == 1
    finding = findings[0]
    assert finding.suggested_image == "node:22-alpine"
    assert finding.savings_mb == 1100 - 160
    assert finding.compatibility == 85


def test_does_not_flag_an_already_slim_image():
    assert "large-base-image" not in rule_ids("FROM node:22-alpine\nUSER node\nCMD [\"x\"]\n")
    assert "large-base-image" not in rule_ids("FROM python:3.12-slim\nUSER nobody\nCMD [\"x\"]\n")


def test_does_not_flag_scratch_or_distroless():
    content = "FROM gcr.io/distroless/static-debian12:nonroot\nCMD [\"/app\"]\n"
    assert "large-base-image" not in rule_ids(content)
    assert "missing-user-instruction" not in rule_ids(content)


def test_ubuntu_gets_its_own_advice_and_is_not_double_reported():
    ids = rule_ids("FROM ubuntu:24.04\nUSER nobody\nCMD [\"x\"]\n")
    assert "ubuntu-base-image" in ids
    assert "large-base-image" not in ids


def test_flags_untagged_and_latest_but_not_a_digest():
    assert "unpinned-base-image" in rule_ids("FROM node\nUSER node\nCMD [\"x\"]\n")
    assert "unpinned-base-image" in rule_ids("FROM node:latest\nUSER node\nCMD [\"x\"]\n")
    # A digest pins harder than any tag could.
    assert "unpinned-base-image" not in rule_ids("FROM node:latest@sha256:abc\nUSER node\nCMD [\"x\"]\n")


def test_floating_tags_are_reported_separately_from_unpinned():
    lts = rule_ids("FROM node:lts\nUSER node\nCMD [\"x\"]\n")
    assert "floating-major-tag" in lts
    latest = rule_ids("FROM node:latest\nUSER node\nCMD [\"x\"]\n")
    assert "floating-major-tag" not in latest


def test_a_pinned_minor_version_is_not_flagged():
    ids = rule_ids("FROM node:22.11-alpine\nUSER node\nCMD [\"x\"]\n")
    assert "floating-major-tag" not in ids
    assert "unpinned-base-image" not in ids


def test_stage_references_are_skipped():
    content = "FROM node:22.11-alpine AS builder\nRUN npm run build\nFROM builder\nUSER node\nCMD [\"x\"]\n"
    assert "unpinned-base-image" not in rule_ids(content)


def test_flags_a_single_stage_build_that_compiles():
    ids = rule_ids("FROM node:22.11-alpine\nRUN npm ci && npm run build\nUSER node\nCMD [\"x\"]\n")
    assert "single-stage-build" in ids


def test_does_not_flag_a_single_stage_that_only_installs_runtime_deps():
    """`pip install flask` leaves no compiler behind; demanding multi-stage would be noise."""
    ids = rule_ids("FROM python:3.12-slim\nRUN pip install --no-cache-dir flask\nUSER nobody\nCMD [\"x\"]\n")
    assert "single-stage-build" not in ids


def test_a_global_tool_install_is_not_a_build_step():
    ids = rule_ids("FROM node:22.11-alpine\nRUN npm install -g pnpm\nUSER node\nCMD [\"x\"]\n")
    assert "single-stage-build" not in ids
    assert "npm-install-not-ci" not in ids
    assert "npm-includes-dev-dependencies" not in ids


def test_multi_stage_is_never_flagged_as_single_stage():
    assert "single-stage-build" not in rule_ids(IDIOMATIC, has_dockerignore=True)


def test_npm_install_suggests_ci():
    ids = rule_ids("FROM node:22.11-alpine\nRUN npm install\nUSER node\nCMD [\"x\"]\n")
    assert "npm-install-not-ci" in ids


def test_dev_dependencies_only_reported_in_the_shipping_stage():
    """A builder stage legitimately needs devDependencies."""
    content = (
        "FROM node:22.11-alpine AS builder\n"
        "RUN npm ci\n"
        "RUN npm run build\n"
        "FROM node:22.11-alpine\n"
        "RUN npm ci --omit=dev\n"
        "USER node\n"
        'CMD ["x"]\n'
    )
    assert "npm-includes-dev-dependencies" not in rule_ids(content, has_dockerignore=True)


def test_apt_rules_fire_together_and_clear_together():
    content = "FROM debian:bookworm-slim\nRUN apt-get update && apt-get install -y curl\nUSER nobody\nCMD [\"x\"]\n"
    ids = rule_ids(content)
    assert "apt-missing-cleanup" in ids
    assert "apt-missing-no-install-recommends" in ids
    # Not a separate-layer problem: update and install are already chained.
    assert "apt-update-in-separate-layer" not in ids


def test_correctly_written_apt_block_is_clean():
    content = (
        "FROM debian:bookworm-slim\n"
        "RUN apt-get update \\\n"
        "    && apt-get install -y --no-install-recommends curl \\\n"
        "    && rm -rf /var/lib/apt/lists/*\n"
        "USER nobody\n"
        'CMD ["x"]\n'
    )
    ids = rule_ids(content)
    assert "apt-missing-cleanup" not in ids
    assert "apt-missing-no-install-recommends" not in ids


def test_apt_update_alone_is_only_flagged_when_a_later_run_installs():
    with_later_install = "FROM debian:bookworm-slim\nRUN apt-get update\nRUN apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*\nUSER nobody\nCMD [\"x\"]\n"
    assert "apt-update-in-separate-layer" in rule_ids(with_later_install)

    alone = "FROM debian:bookworm-slim\nRUN apt-get update\nUSER nobody\nCMD [\"x\"]\n"
    assert "apt-update-in-separate-layer" not in rule_ids(alone)


def test_pip_cache_rule_respects_the_environment_opt_out():
    flagged = "FROM python:3.12-slim\nRUN pip install flask\nUSER nobody\nCMD [\"x\"]\n"
    assert "pip-missing-no-cache-dir" in rule_ids(flagged)

    opted_out = "FROM python:3.12-slim\nENV PIP_NO_CACHE_DIR=1\nRUN pip install flask\nUSER nobody\nCMD [\"x\"]\n"
    assert "pip-missing-no-cache-dir" not in rule_ids(opted_out)


def test_apk_cache_rule():
    assert "apk-missing-no-cache" in rule_ids("FROM alpine:3.20\nRUN apk add curl\nUSER nobody\nCMD [\"x\"]\n")
    assert "apk-missing-no-cache" not in rule_ids(
        "FROM alpine:3.20\nRUN apk add --no-cache curl\nUSER nobody\nCMD [\"x\"]\n"
    )


def test_flags_a_remote_script_piped_into_a_shell():
    content = "FROM alpine:3.20\nRUN wget -qO- https://x.example/i.sh | sh\nUSER nobody\nCMD [\"x\"]\n"
    assert "curl-pipe-to-shell" in rule_ids(content)


def test_does_not_flag_a_download_that_is_not_piped_to_a_shell():
    content = "FROM alpine:3.20\nRUN curl -fsSLo /tmp/f.tgz https://x.example/f.tgz\nUSER nobody\nCMD [\"x\"]\n"
    assert "curl-pipe-to-shell" not in rule_ids(content)


def test_consecutive_run_threshold_is_three():
    two = "FROM alpine:3.20\nRUN echo a\nRUN echo b\nUSER nobody\nCMD [\"x\"]\n"
    assert "separate-run-layers" not in rule_ids(two)

    three = "FROM alpine:3.20\nRUN echo a\nRUN echo b\nRUN echo c\nUSER nobody\nCMD [\"x\"]\n"
    assert "separate-run-layers" in rule_ids(three)


def test_runs_split_across_stages_are_not_treated_as_consecutive():
    content = (
        "FROM alpine:3.20 AS a\nRUN echo 1\nRUN echo 2\n"
        "FROM alpine:3.20\nRUN echo 3\nUSER nobody\nCMD [\"x\"]\n"
    )
    assert "separate-run-layers" not in rule_ids(content)


def test_copy_whole_context_is_fine_in_a_builder_stage_with_a_dockerignore():
    content = (
        "FROM node:22.11-alpine AS builder\nCOPY . .\nRUN npm run build\n"
        "FROM nginx:1.27-alpine\nCOPY --from=builder /app/dist /usr/share/nginx/html\n"
        'USER nginx\nCMD ["nginx"]\n'
    )
    assert "copy-entire-context" not in rule_ids(content, has_dockerignore=True)


def test_copy_whole_context_is_flagged_when_nothing_bounds_it():
    ids = rule_ids("FROM node:22.11-alpine\nCOPY . .\nUSER node\nCMD [\"x\"]\n", has_dockerignore=False)
    assert "copy-entire-context" in ids
    assert "missing-dockerignore" in ids


def test_missing_dockerignore_is_not_guessed_when_unknown():
    ids = rule_ids("FROM node:22.11-alpine\nCOPY . .\nUSER node\nCMD [\"x\"]\n", has_dockerignore=None)
    assert "missing-dockerignore" not in ids


def test_bloat_candidates_appear_in_the_detail():
    findings = analyze(
        "FROM node:22.11-alpine\nCOPY . .\nUSER node\nCMD [\"x\"]\n",
        has_dockerignore=False,
        bloat_candidates=[".git", "node_modules"],
    )
    detail = next(f for f in findings if f.rule_id == "missing-dockerignore").detail
    assert ".git" in detail and "node_modules" in detail


def test_cache_busting_copy_is_flagged_and_the_good_order_is_not():
    bad = "FROM node:22.11-alpine\nCOPY . .\nRUN npm ci --omit=dev\nUSER node\nCMD [\"x\"]\n"
    assert "copy-before-dependency-install" in rule_ids(bad, has_dockerignore=True)

    good = "FROM node:22.11-alpine\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nUSER node\nCMD [\"x\"]\n"
    assert "copy-before-dependency-install" not in rule_ids(good, has_dockerignore=True)


def test_add_is_flagged_for_a_plain_file_but_not_an_archive_or_url():
    assert "add-instead-of-copy" in rule_ids("FROM alpine:3.20\nADD ./cfg.yml /etc/\nUSER nobody\nCMD [\"x\"]\n")
    # These are the cases ADD exists for.
    assert "add-instead-of-copy" not in rule_ids("FROM alpine:3.20\nADD app.tar.gz /opt/\nUSER nobody\nCMD [\"x\"]\n")
    assert "add-instead-of-copy" not in rule_ids(
        "FROM alpine:3.20\nADD https://x.example/f /tmp/f\nUSER nobody\nCMD [\"x\"]\n"
    )


def test_flags_a_hardcoded_secret_but_not_a_variable_reference():
    assert "hardcoded-secret" in rule_ids('FROM alpine:3.20\nENV API_KEY=sk-live-abc123\nUSER nobody\nCMD ["x"]\n')
    # Referencing a build arg is the correct pattern.
    assert "hardcoded-secret" not in rule_ids(
        'FROM alpine:3.20\nARG API_KEY\nENV API_KEY=$API_KEY\nUSER nobody\nCMD ["x"]\n'
    )
    # An ARG with no default is a parameter, not a leak.
    assert "hardcoded-secret" not in rule_ids('FROM alpine:3.20\nARG DB_PASSWORD\nUSER nobody\nCMD ["x"]\n')


def test_secret_detection_handles_quoted_and_multiple_assignments():
    findings = analyze(
        'FROM alpine:3.20\nENV NODE_ENV=production SECRET_TOKEN="abcdef123456"\nUSER nobody\nCMD ["x"]\n'
    )
    secrets = [f for f in findings if f.rule_id == "hardcoded-secret"]
    assert len(secrets) == 1
    assert "SECRET_TOKEN" in secrets[0].message


def test_missing_user_is_reported_and_root_does_not_count():
    assert "missing-user-instruction" in rule_ids('FROM alpine:3.20\nCMD ["x"]\n')
    assert "missing-user-instruction" in rule_ids('FROM alpine:3.20\nUSER root\nCMD ["x"]\n')
    assert "missing-user-instruction" not in rule_ids('FROM alpine:3.20\nUSER nobody\nCMD ["x"]\n')


def test_user_fix_matches_the_base_image():
    def fix_for(content):
        return next(f for f in analyze(content) if f.rule_id == "missing-user-instruction").replacement

    # Official Node images already ship an unprivileged `node` user.
    assert fix_for('FROM node:22.11-alpine\nCMD ["x"]\n') == "USER node\n"
    # scratch has no shell, no /etc/passwd and no adduser - only a numeric id works.
    assert fix_for('FROM scratch\nCMD ["/app"]\n') == "USER 65534:65534\n"
    # Alpine's busybox adduser takes different flags from Debian's.
    assert "adduser -S" in fix_for('FROM alpine:3.20\nCMD ["x"]\n')
    assert "useradd --system" in fix_for('FROM debian:bookworm-slim\nCMD ["x"]\n')


def test_sudo_is_flagged_and_the_fix_removes_it():
    findings = analyze('FROM alpine:3.20\nRUN sudo apk add --no-cache curl\nUSER nobody\nCMD ["x"]\n')
    sudo = next(f for f in findings if f.rule_id == "sudo-in-container")
    assert "sudo" not in sudo.replacement


def test_healthcheck_fix_uses_the_exposed_port():
    findings = analyze('FROM alpine:3.20\nEXPOSE 9000\nUSER nobody\nCMD ["x"]\n')
    hc = next(f for f in findings if f.rule_id == "missing-healthcheck")
    assert ":9000/health" in hc.replacement


def test_healthcheck_not_reported_when_present():
    content = 'FROM alpine:3.20\nHEALTHCHECK CMD true\nUSER nobody\nCMD ["x"]\n'
    assert "missing-healthcheck" not in rule_ids(content)


def test_findings_are_ordered_by_severity_then_position():
    findings = analyze(NEGLECTED, has_dockerignore=False)
    severities = [catalog()[f.rule_id]["severity"] for f in findings]
    order = ["critical", "high", "medium", "low", "info"]
    ranks = [order.index(s) for s in severities]
    assert ranks == sorted(ranks)


def test_an_empty_or_garbage_dockerfile_does_not_raise():
    assert analyze("") == []
    assert analyze("\n\n# just a comment\n") == []
    # Not valid, but must not crash the engine.
    analyze("}{ this is not a dockerfile")


def test_scores_degrade_with_severity():
    clean = score(analyze(IDIOMATIC, has_dockerignore=True))
    bad = score(analyze(NEGLECTED, has_dockerignore=False))

    assert bad["securityScore"] < clean["securityScore"]
    assert bad["optimizationScore"] < clean["optimizationScore"]
    assert bad["findingCount"] > 10
    assert bad["bySeverity"]["critical"] == 1
    assert bad["estimatedSavingsMb"] > 0


def test_scores_stay_within_range_for_a_pathological_file():
    awful = "FROM ubuntu\n" + "".join(
        f"ENV API_KEY_{i}=supersecret{i}\nRUN sudo apt-get install -y pkg{i}\n" for i in range(40)
    )
    scores = score(analyze(awful, has_dockerignore=False))
    for key in ("optimizationScore", "securityScore", "performanceScore"):
        assert 0 <= scores[key] <= 100


def test_every_catalog_rule_has_the_fields_clients_render():
    for rule_id, rule in catalog().items():
        for key in (
            "title",
            "severity",
            "category",
            "instruction",
            "problem",
            "explanation",
            "docsUrl",
            "sizeImpactMb",
            "savingsMb",
            "autoFixable",
        ):
            assert key in rule, f"{rule_id} is missing {key}"
        assert rule["severity"] in ("critical", "high", "medium", "low", "info")
        assert rule["category"] in ("size", "security", "performance", "maintainability")
        # Hovers link out, so a broken or relative URL would be a dead end.
        assert rule["docsUrl"].startswith("https://")


def test_every_rule_the_engine_emits_exists_in_the_catalog():
    """Guards against a rule id typo, which would otherwise KeyError at render time."""
    emitted = {f.rule_id for f in analyze(NEGLECTED, has_dockerignore=False)}
    emitted |= {f.rule_id for f in analyze(IDIOMATIC, has_dockerignore=True)}
    assert emitted <= set(catalog())


def test_to_dict_merges_catalog_metadata():
    finding = next(f for f in analyze("FROM node\nUSER node\nCMD [\"x\"]\n") if f.rule_id == "large-base-image")
    data = finding.to_dict()

    for key in (
        "problem",
        "explanation",
        "sizeImpactMb",
        "savingsMb",
        "securityImpact",
        "performanceImpact",
        "docsUrl",
        "compatibility",
        "suggestedImage",
    ):
        assert key in data
    assert data["autoFixable"] is True
