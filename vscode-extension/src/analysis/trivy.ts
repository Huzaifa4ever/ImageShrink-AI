import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { config } from '../config';
import { log } from '../logger';
import * as lex from '../rules/lexer';
import type {
  AffectedPackage,
  Misconfiguration,
  ScanResult,
  ScanSummary,
  Severity,
  Vulnerability,
} from './types';
import { EMPTY_SUMMARY, emptyScan } from './types';

const run = promisify(execFile);

const MAX_BUFFER = 64 * 1024 * 1024;

let cachedVersion: { value: string | null; at: number } | undefined;
const VERSION_CACHE_MS = 60_000;

const imageCache = new Map<string, { at: number; vulnerabilities: Vulnerability[] }>();

function severityOf(raw: unknown): Severity {
  const value = String(raw ?? '').toLowerCase();
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'unknown';
}

export async function trivyVersion(): Promise<string | null> {
  const now = Date.now();
  if (cachedVersion && now - cachedVersion.at < VERSION_CACHE_MS) return cachedVersion.value;

  try {
    const { stdout } = await run(config.trivyPath(), ['--version'], { timeout: 10_000 });
    const match = /Version:\s*(\S+)/i.exec(stdout);
    const value = match?.[1] ?? stdout.trim().split('\n')[0] ?? 'unknown';
    cachedVersion = { value, at: now };
    return value;
  } catch {
    cachedVersion = { value: null, at: now };
    return null;
  }
}

function scannableImages(content: string): { images: string[]; skipped: { image: string; reason: string }[] } {
  const parsed = lex.parse(content);
  const aliases = lex.stageNames(parsed);

  const images: string[] = [];
  const skipped: { image: string; reason: string }[] = [];

  for (const instruction of lex.of(parsed, 'FROM')) {
    const ref = lex.parseFrom(instruction, aliases);
    if (!ref) continue;

    if (ref.isStageReference) continue;
    if (lex.isScratch(ref)) {
      skipped.push({ image: ref.raw, reason: 'scratch has nothing to scan' });
      continue;
    }
    if (ref.raw.includes('$')) {
      skipped.push({ image: ref.raw, reason: 'contains an unresolved build argument' });
      continue;
    }
    if (!images.includes(ref.raw)) images.push(ref.raw);
  }

  return { images, skipped };
}

interface TrivyResultBlock {
  Target?: string;
  Vulnerabilities?: Array<Record<string, unknown>>;
  Misconfigurations?: Array<Record<string, unknown>>;
}

function parseVulnerabilities(raw: string, image: string): Vulnerability[] {
  const parsed = JSON.parse(raw) as { Results?: TrivyResultBlock[] };
  const byCve = new Map<string, Vulnerability>();

  for (const block of parsed.Results ?? []) {
    for (const row of block.Vulnerabilities ?? []) {
      const cveId = String(row['VulnerabilityID'] ?? '');
      if (!cveId) continue;

      const pkg: AffectedPackage = {
        name: String(row['PkgName'] ?? ''),
        installedVersion: String(row['InstalledVersion'] ?? ''),
        fixedVersion: row['FixedVersion'] ? String(row['FixedVersion']) : null,
      };

      const existing = byCve.get(cveId);
      if (existing) {
        if (!existing.packages.some((p) => p.name === pkg.name)) existing.packages.push(pkg);
        if (pkg.fixedVersion) existing.fixable = true;
        continue;
      }

      byCve.set(cveId, {
        cveId,
        severity: severityOf(row['Severity']),
        title: String(row['Title'] ?? cveId),
        description: String(row['Description'] ?? '').slice(0, 600),
        packages: [pkg],
        referenceUrl: row['PrimaryURL'] ? String(row['PrimaryURL']) : null,
        image,
        fixable: Boolean(pkg.fixedVersion),
      });
    }
  }

  return [...byCve.values()];
}

function parseMisconfigurations(raw: string): Misconfiguration[] {
  const parsed = JSON.parse(raw) as { Results?: TrivyResultBlock[] };
  const out: Misconfiguration[] = [];

  for (const block of parsed.Results ?? []) {
    for (const row of block.Misconfigurations ?? []) {
      const cause = row['CauseMetadata'] as { StartLine?: number } | undefined;
      out.push({
        checkId: String(row['ID'] ?? ''),
        severity: severityOf(row['Severity']),
        title: String(row['Title'] ?? ''),
        description: String(row['Description'] ?? '').slice(0, 400),
        resolution: String(row['Resolution'] ?? ''),
        line: cause?.StartLine ?? 0,
      });
    }
  }

  return out;
}

function summarize(
  vulnerabilities: Vulnerability[],
  misconfigurations: Misconfiguration[]
): ScanSummary {
  const summary: ScanSummary = { ...EMPTY_SUMMARY };
  for (const v of vulnerabilities) {
    summary[v.severity] += 1;
    if (v.fixable) summary.fixable += 1;
  }
  summary.total = vulnerabilities.length;
  summary.misconfigurations = misconfigurations.length;
  return summary;
}

async function scanImage(image: string, signal?: AbortSignal): Promise<Vulnerability[]> {
  const cached = imageCache.get(image);
  if (cached && Date.now() - cached.at < config.trivyCacheMinutes() * 60_000) {
    log.debug(`trivy: reusing cached result for ${image}`);
    return cached.vulnerabilities;
  }

  const args = [
    'image',
    '--quiet',
    '--format', 'json',
    '--scanners', 'vuln',
    '--severity', config.trivySeverities(),
    image,
  ];

  const { stdout } = await run(config.trivyPath(), args, {
    timeout: config.trivyTimeoutSeconds() * 1000,
    maxBuffer: MAX_BUFFER,
    ...(signal ? { signal } : {}),
  });

  const vulnerabilities = parseVulnerabilities(stdout, image);
  imageCache.set(image, { at: Date.now(), vulnerabilities });
  return vulnerabilities;
}

async function scanConfig(dockerfilePath: string, signal?: AbortSignal): Promise<Misconfiguration[]> {
  const args = ['config', '--quiet', '--format', 'json', dockerfilePath];
  const { stdout } = await run(config.trivyPath(), args, {
    timeout: config.trivyTimeoutSeconds() * 1000,
    maxBuffer: MAX_BUFFER,
    ...(signal ? { signal } : {}),
  });
  return parseMisconfigurations(stdout);
}

export const TRIVY_INSTALL_HINT =
  'Install Trivy to scan base images for CVEs: https://github.com/aquasecurity/trivy#installation';

export async function scan(
  content: string,
  dockerfilePath: string | undefined,
  signal?: AbortSignal
): Promise<ScanResult> {
  if (!config.trivyEnabled()) {
    return emptyScan('disabled', 'Security scanning is turned off in settings.');
  }

  const version = await trivyVersion();
  if (!version) {
    return emptyScan(
      'unavailable',
      `Trivy was not found at "${config.trivyPath()}". ${TRIVY_INSTALL_HINT}`
    );
  }

  const { images, skipped } = scannableImages(content);
  const limit = config.trivyMaxImages();
  const selected = images.slice(0, limit);
  for (const extra of images.slice(limit)) {
    skipped.push({ image: extra, reason: `over the ${limit}-image limit for one analysis` });
  }

  const vulnerabilities: Vulnerability[] = [];
  const scannedImages: string[] = [];
  const errors: string[] = [];

  for (const image of selected) {
    try {
      vulnerabilities.push(...(await scanImage(image, signal)));
      scannedImages.push(image);
    } catch (error) {
      const message = (error as Error).message.split('\n')[0] ?? 'scan failed';
      log.warn(`trivy: ${image} failed — ${message}`);
      skipped.push({ image, reason: message });
      errors.push(image);
    }
  }

  let misconfigurations: Misconfiguration[] = [];
  if (dockerfilePath) {
    try {
      misconfigurations = await scanConfig(dockerfilePath, signal);
    } catch (error) {
      log.warn(`trivy config failed: ${(error as Error).message.split('\n')[0]}`);
      errors.push('Dockerfile checks');
    }
  }

  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'unknown'];
  vulnerabilities.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  const capped = vulnerabilities.slice(0, config.trivyMaxFindings());
  const status = errors.length && !scannedImages.length ? 'unavailable' : errors.length ? 'partial' : 'ok';

  return {
    status,
    reason: errors.length ? `Could not scan: ${errors.join(', ')}.` : '',
    version,
    scannedImages,
    skippedImages: skipped,
    vulnerabilities: capped,
    misconfigurations,
    summary: summarize(vulnerabilities, misconfigurations),
  };
}

export function clearCache(): void {
  imageCache.clear();
  cachedVersion = undefined;
}
