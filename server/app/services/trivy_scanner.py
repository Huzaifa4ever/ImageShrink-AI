

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
import time
import uuid

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_IMAGE_REF_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,254}$")

_SEVERITY_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "UNKNOWN": 4}

_MAX_DESCRIPTION_CHARS = 400

_LOCK_CONTENTION_MARKER = "cache may be in use by another process"
_LOCK_RETRIES = 2
_LOCK_RETRY_DELAY_SECONDS = 2.0

_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_cache_lock = asyncio.Lock()

_version_cache: dict | None = None
_scan_semaphore: tuple[asyncio.AbstractEventLoop, asyncio.Semaphore] | None = None


def _get_scan_semaphore() -> asyncio.Semaphore:
    """Built lazily per event loop — a semaphore must not outlive the loop it blocks on."""
    global _scan_semaphore
    loop = asyncio.get_running_loop()
    if _scan_semaphore is None or _scan_semaphore[0] is not loop:
        limit = max(1, get_settings().TRIVY_MAX_CONCURRENT_SCANS)
        _scan_semaphore = (loop, asyncio.Semaphore(limit))
    return _scan_semaphore[1]


class TrivyUnavailable(RuntimeError):
    """Raised when the Trivy binary cannot be executed at all."""


async def _exec_trivy(args: list[str], timeout: int) -> tuple[int, bytes, bytes]:
    settings = get_settings()

    try:
        proc = await asyncio.create_subprocess_exec(
            settings.TRIVY_BINARY,
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "TRIVY_NO_PROGRESS": "true"},
        )
    except FileNotFoundError as e:
        raise TrivyUnavailable(
            f"Trivy binary '{settings.TRIVY_BINARY}' not found on PATH"
        ) from e

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        await _terminate(proc)
        raise TimeoutError(f"trivy {args[0]} exceeded {timeout}s")
    except asyncio.CancelledError:
        await _terminate(proc)
        raise

    return proc.returncode or 0, stdout or b"", stderr or b""


async def _terminate(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    proc.kill()
    try:
        await proc.wait()
    except Exception: 
        pass


async def _run_trivy(args: list[str], timeout: int) -> str:

    async with _get_scan_semaphore():
        for attempt in range(_LOCK_RETRIES + 1):
            returncode, stdout, stderr = await _exec_trivy(args, timeout)
            if returncode == 0:
                return stdout.decode("utf-8", "replace")

            err = stderr.decode("utf-8", "replace").strip()
            if _LOCK_CONTENTION_MARKER in err and attempt < _LOCK_RETRIES:
                logger.warning(
                    "trivy %s: cache locked by another process, retry %d/%d",
                    args[0],
                    attempt + 1,
                    _LOCK_RETRIES,
                )
                await asyncio.sleep(_LOCK_RETRY_DELAY_SECONDS * (attempt + 1))
                continue

            detail = err.splitlines()
            raise RuntimeError(
                f"trivy {args[0]} exited {returncode}: {detail[-1] if detail else 'unknown error'}"
            )

    raise RuntimeError(f"trivy {args[0]} failed after {_LOCK_RETRIES} retries")


async def get_trivy_version() -> dict:

    global _version_cache
    if _version_cache is not None:
        return _version_cache

    raw = await _run_trivy(["version", "--format", "json"], timeout=15)
    info = json.loads(raw)
    _version_cache = {
        "version": info.get("Version", "unknown"),
        "dbUpdatedAt": (info.get("VulnerabilityDB") or {}).get("UpdatedAt"),
    }
    return _version_cache



async def _cache_get(key: tuple[str, str]) -> dict | None:
    async with _cache_lock:
        hit = _cache.get(key)
        if not hit:
            return None
        expires_at, payload = hit
        if expires_at < time.monotonic():
            _cache.pop(key, None)
            return None
        return payload


async def _cache_set(key: tuple[str, str], payload: dict) -> None:
    ttl = get_settings().TRIVY_CACHE_TTL_MINUTES * 60
    if ttl <= 0:
        return
    async with _cache_lock:
        _cache[key] = (time.monotonic() + ttl, payload)



def collect_base_images(stages: list[dict]) -> tuple[list[str], list[dict]]:
    settings = get_settings()
    stage_names = {
        (s.get("name") or "").strip().lower() for s in stages if s.get("name")
    }

    scannable: list[str] = []
    skipped: list[dict] = []
    seen: set[str] = set()

    for stage in stages:
        image = (stage.get("baseImage") or "").strip()
        if not image or image.lower() in seen:
            continue
        seen.add(image.lower())

        if image.lower() == "scratch":
            skipped.append(
                {"image": image, "reason": "scratch has no packages to scan", "benign": True}
            )
        elif image.lower() in stage_names:
            skipped.append(
                {"image": image, "reason": "refers to an earlier build stage", "benign": True}
            )
        elif "$" in image:
            skipped.append(
                {"image": image, "reason": "unresolved build argument in image tag", "benign": False}
            )
        elif not _IMAGE_REF_RE.match(image):
            skipped.append({"image": image, "reason": "not a valid image reference", "benign": False})
        elif len(scannable) >= settings.TRIVY_MAX_IMAGES:
            skipped.append(
                {
                    "image": image,
                    "reason": f"exceeds TRIVY_MAX_IMAGES limit ({settings.TRIVY_MAX_IMAGES})",
                    "benign": False,
                }
            )
        else:
            scannable.append(image)

    return scannable, skipped



def _truncate(text: str) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= _MAX_DESCRIPTION_CHARS else text[: _MAX_DESCRIPTION_CHARS - 1] + "…"


def _normalize_vulnerability(raw: dict, target: str) -> dict:
    severity = (raw.get("Severity") or "UNKNOWN").upper()
    title = _truncate(raw.get("Title") or "")
    description = title or _truncate(raw.get("Description") or "No description provided")

    return {
        "id": str(uuid.uuid4()),
        "cveId": raw.get("VulnerabilityID", ""),
        "severity": severity if severity in _SEVERITY_RANK else "UNKNOWN",
        "package": raw.get("PkgName") or raw.get("PkgID") or "unknown",
        "installedVersion": raw.get("InstalledVersion") or "",
        "fixedVersion": raw.get("FixedVersion") or None,
        "description": description,
        "referenceUrl": raw.get("PrimaryURL") or "",
        "target": target,
        "fixState": raw.get("Status") or "unknown",
        "source": "trivy",
    }


def _normalize_misconfiguration(raw: dict, target: str) -> dict:
    severity = (raw.get("Severity") or "UNKNOWN").upper()
    cause = raw.get("CauseMetadata") or {}

    return {
        "id": str(uuid.uuid4()),
        "checkId": raw.get("ID", ""),
        "severity": severity if severity in _SEVERITY_RANK else "UNKNOWN",
        "title": raw.get("Title") or raw.get("ID") or "Misconfiguration",
        "description": _truncate(raw.get("Message") or raw.get("Description") or ""),
        "resolution": _truncate(raw.get("Resolution") or ""),
        "referenceUrl": raw.get("PrimaryURL") or "",
        "line": cause.get("StartLine") or 0,
        "target": target,
        "source": "trivy",
    }


def _sort_key(finding: dict) -> tuple[int, str]:
    return (
        _SEVERITY_RANK.get(finding.get("severity", "UNKNOWN"), 4),
        finding.get("cveId") or finding.get("checkId") or "",
    )


def _group_vulnerabilities(findings: list[dict]) -> list[dict]:

    grouped: dict[str, dict] = {}
    for finding in findings:
        target = finding.get("target") or ""
        key = finding.get("cveId") or f"{target}|{finding.get('package')}|{finding.get('id')}"
        package = {
            "name": finding.get("package") or "unknown",
            "installedVersion": finding.get("installedVersion") or "",
            "fixedVersion": finding.get("fixedVersion"),
            "fixState": finding.get("fixState") or "unknown",
        }

        entry = grouped.get(key)
        if entry is None:
            grouped[key] = {
                **finding,
                "severity": finding.get("severity") or "UNKNOWN",
                "description": finding.get("description") or "",
                "referenceUrl": finding.get("referenceUrl") or "",
                "packages": [package],
                "targets": [target] if target else [],
            }
            continue

        if package not in entry["packages"]:
            entry["packages"].append(package)
        if target and target not in entry["targets"]:
            entry["targets"].append(target)
        if _SEVERITY_RANK.get(finding.get("severity"), 4) < _SEVERITY_RANK.get(entry["severity"], 4):
            entry["severity"] = finding["severity"]
        if len(finding.get("description") or "") > len(entry["description"]):
            entry["description"] = finding["description"]
        if not entry["referenceUrl"]:
            entry["referenceUrl"] = finding.get("referenceUrl") or ""

    for entry in grouped.values():
        entry["packages"].sort(key=lambda p: p["name"])
        entry["packageCount"] = len(entry["packages"])
        headline = next((p for p in entry["packages"] if p["fixedVersion"]), entry["packages"][0])
        entry["package"] = headline["name"]
        entry["installedVersion"] = headline["installedVersion"]
        entry["fixedVersion"] = headline["fixedVersion"]
        entry["fixState"] = headline["fixState"]
        entry["target"] = entry["targets"][0] if entry["targets"] else ""

    return list(grouped.values())


def ensure_grouped(vulnerabilities: list[dict], summary: dict) -> tuple[list[dict], dict]:

    if not vulnerabilities or any("packages" in v for v in vulnerabilities):
        return vulnerabilities, summary

    stored = len(vulnerabilities)
    grouped = _group_vulnerabilities(vulnerabilities)
    grouped.sort(key=_sort_key)

    return grouped, {
        **summary,
        "occurrences": summary.get("occurrences") or stored,
        "displayed": len(grouped),
    }

async def _scan_image(image: str) -> dict:
    settings = get_settings()
    cache_key = ("image", f"{image}|{settings.trivy_severities_arg}")

    cached = await _cache_get(cache_key)
    if cached is not None:
        logger.info("trivy: cache hit for image %s", image)
        return cached

    args = [
        "image",
        "--scanners", "vuln",
        "--format", "json",
        "--quiet",
        "--severity", settings.trivy_severities_arg,
        "--timeout", f"{settings.TRIVY_TIMEOUT_SECONDS}s",
    ]
    if settings.TRIVY_SKIP_DB_UPDATE:
        args.append("--skip-db-update")
    args.append(image)

    started = time.monotonic()
    report = json.loads(await _run_trivy(args, timeout=settings.TRIVY_TIMEOUT_SECONDS + 15))
    logger.info("trivy: scanned image %s in %.1fs", image, time.monotonic() - started)

    findings: list[dict] = []
    for result in report.get("Results") or []:
        target = result.get("Target") or image
        for raw in result.get("Vulnerabilities") or []:
            findings.append(_normalize_vulnerability(raw, target))

    payload = {"vulnerabilities": findings}
    await _cache_set(cache_key, payload)
    return payload


async def _scan_config(content: str) -> dict:
    """Dockerfile misconfiguration scan. Returns {"misconfigurations": [...]}."""
    settings = get_settings()
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    cache_key = ("config", f"{digest}|{settings.trivy_severities_arg}")

    cached = await _cache_get(cache_key)
    if cached is not None:
        return cached

    findings: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="imageshrink-trivy-") as tmpdir:
        path = os.path.join(tmpdir, "Dockerfile")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)

        args = [
            "config",
            "--format", "json",
            "--quiet",
            "--severity", settings.trivy_severities_arg,
        ]
        if settings.TRIVY_SKIP_DB_UPDATE:
            args.append("--skip-check-update")
        args.append(path)

        report = json.loads(await _run_trivy(args, timeout=settings.TRIVY_TIMEOUT_SECONDS))

        for result in report.get("Results") or []:
            for raw in result.get("Misconfigurations") or []:
                if (raw.get("Status") or "").upper() != "FAIL":
                    continue
                findings.append(_normalize_misconfiguration(raw, "Dockerfile"))

    payload = {"misconfigurations": findings}
    await _cache_set(cache_key, payload)
    return payload



def _summarize(
    vulnerabilities: list[dict],
    misconfigurations: list[dict],
    occurrences: int | None = None,
) -> dict:
    counts = {sev.lower(): 0 for sev in _SEVERITY_RANK}
    for v in vulnerabilities:
        counts[v["severity"].lower()] += 1
    return {
        **counts,
        "total": len(vulnerabilities),
        "displayed": len(vulnerabilities),
        "occurrences": len(vulnerabilities) if occurrences is None else occurrences,
        "fixable": sum(1 for v in vulnerabilities if v.get("fixedVersion")),
        "misconfigurations": len(misconfigurations),
    }


def empty_report(status: str, message: str = "") -> dict:
    return {
        "vulnerabilities": [],
        "misconfigurations": [],
        "scanSummary": _summarize([], []),
        "scanner": {
            "name": "trivy",
            "status": status,
            "version": None,
            "dbUpdatedAt": None,
            "scannedImages": [],
            "skippedImages": [],
            "errors": [message] if message else [],
            "truncated": False,
        },
    }


async def scan_dockerfile(content: str, stages: list[dict]) -> dict:

    settings = get_settings()
    if not settings.TRIVY_ENABLED:
        return empty_report("disabled", "Trivy scanning is disabled by configuration")

    try:
        version_info = await get_trivy_version()
    except TrivyUnavailable as e:
        logger.warning("trivy unavailable: %s", e)
        return empty_report("unavailable", str(e))
    except Exception as e:
        logger.warning("trivy version probe failed: %s", e)
        return empty_report("unavailable", f"Trivy could not be started: {e}")

    images, skipped = collect_base_images(stages)
    errors: list[str] = []

    config_task = asyncio.create_task(_scan_config(content))
    image_tasks = [asyncio.create_task(_scan_image(img)) for img in images]
    all_tasks = [config_task, *image_tasks]

    _, pending = await asyncio.wait(all_tasks, timeout=settings.TRIVY_TOTAL_TIMEOUT_SECONDS)
    if pending:
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    budget_msg = f"exceeded total scan budget of {settings.TRIVY_TOTAL_TIMEOUT_SECONDS}s"

    vulnerabilities: list[dict] = []
    misconfigurations: list[dict] = []
    scanned_images: list[str] = []

    if config_task.cancelled():
        errors.append(f"Dockerfile config scan {budget_msg}")
    elif config_task.exception():
        errors.append(f"Dockerfile config scan failed: {config_task.exception()}")
    else:
        misconfigurations.extend(config_task.result()["misconfigurations"])

    for image, task in zip(images, image_tasks):
        if task.cancelled():
            errors.append(f"{image}: {budget_msg}")
            skipped.append({"image": image, "reason": budget_msg, "benign": False})
        elif task.exception():
            errors.append(f"{image}: {task.exception()}")
            skipped.append({"image": image, "reason": str(task.exception()), "benign": False})
        else:
            scanned_images.append(image)
            vulnerabilities.extend(task.result()["vulnerabilities"])

    occurrences = len(vulnerabilities)
    vulnerabilities = _group_vulnerabilities(vulnerabilities)
    vulnerabilities.sort(key=_sort_key)
    misconfigurations.sort(key=_sort_key)

    summary = _summarize(vulnerabilities, misconfigurations, occurrences)

    total_found = len(vulnerabilities)
    truncated = total_found > settings.TRIVY_MAX_FINDINGS
    if truncated:
        logger.info(
            "trivy: storing top %d of %d vulnerabilities (TRIVY_MAX_FINDINGS)",
            settings.TRIVY_MAX_FINDINGS,
            total_found,
        )
        vulnerabilities = vulnerabilities[: settings.TRIVY_MAX_FINDINGS]
    summary["displayed"] = len(vulnerabilities)

    unscanned = [s for s in skipped if not s.get("benign")]
    if errors and not scanned_images and not misconfigurations:
        status = "unavailable"
    elif errors or unscanned or truncated:
        status = "partial"
    else:
        status = "ok"

    return {
        "vulnerabilities": vulnerabilities,
        "misconfigurations": misconfigurations,
        "scanSummary": summary,
        "scanner": {
            "name": "trivy",
            "status": status,
            "version": version_info["version"],
            "dbUpdatedAt": version_info["dbUpdatedAt"],
            "scannedImages": scanned_images,
            "skippedImages": skipped,
            "errors": errors,
            "truncated": truncated,
        },
    }
