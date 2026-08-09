import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execFileSync } from 'node:child_process';

import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

execFileSync('node', [join(here, 'sync-shared.mjs')], { stdio: 'ignore' });
const work = mkdtempSync(join(tmpdir(), 'imageshrink-standalone-'));

let pass = 0;
let fail = 0;

function check(label, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} ${extra}`);
  }
}

const VSCODE_STUB = `
const defaults = {
  'enableAutoAnalysis': true, 'analyzeWhileTyping': true, 'analyzeOnSave': true,
  'debounceMs': 400, 'minimumSeverity': 'info', 'diagnosticsSeverity': 'warning',
  'security.enabled': true, 'security.trivyPath': 'trivy',
  'security.severities': 'CRITICAL,HIGH,MEDIUM,LOW', 'security.maxImages': 4,
  'security.maxFindings': 100, 'security.timeoutSeconds': 180, 'security.cacheMinutes': 60,
  'size.useDocker': true,
};
const noop = () => {};
export const workspace = {
  getConfiguration: () => ({ get: (key, fallback) => defaults[key] ?? fallback }),
  onDidChangeConfiguration: () => ({ dispose: noop }),
};
export const window = {
  createOutputChannel: () => ({
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, show: noop, dispose: noop,
  }),
};
export default { workspace, window };
`;

const stubPath = join(work, 'vscode-stub.mjs');
writeFileSync(stubPath, VSCODE_STUB);

const outfile = join(work, 'analyzer.mjs');
await esbuild.build({
  entryPoints: [join(root, 'src', 'analysis', 'analyzer.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile,
  logLevel: 'error',
  plugins: [
    {
      name: 'vscode-stub',
      setup(build) {
        build.onResolve({ filter: /^vscode$/ }, () => ({ path: stubPath }));
      },
    },
  ],
});

const { analyze } = await import(outfile);

const NEGLECTED = `FROM node
ENV API_KEY=sk-live-abc123def456
WORKDIR /app
COPY . .
RUN npm install
RUN apt-get update
RUN apt-get install -y curl python3
RUN pip install flask
EXPOSE 3000
CMD ["node", "server.js"]
`;

const IDIOMATIC = `FROM node:22.11-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.11-alpine AS runner
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/server.js"]
`;

const dockerfilePath = join(work, 'Dockerfile');
writeFileSync(dockerfilePath, NEGLECTED);

console.log('\n--- findings, offline ---');
const bad = await analyze({
  content: NEGLECTED,
  filename: 'Dockerfile',
  options: { hasDockerignore: false, bloatCandidates: ['.git', 'node_modules'] },
  skipScan: true,
});

const ids = new Set(bad.findings.map((f) => f.ruleId));
check('finds the obvious problems', ['unpinned-base-image', 'large-base-image', 'copy-entire-context',
  'missing-dockerignore', 'apt-missing-cleanup', 'hardcoded-secret'].every((id) => ids.has(id)),
  [...ids].join(', '));
check('scores are in range', [bad.scores.optimizationScore, bad.scores.securityScore,
  bad.scores.performanceScore].every((s) => s >= 0 && s <= 100));
check('bad Dockerfile scores poorly', bad.scores.securityScore < 70, String(bad.scores.securityScore));

console.log('\n--- size estimate, no backend ---');
check('base image identified', bad.size.baseImage === 'node', String(bad.size.baseImage));
check('base size known', bad.size.baseMb !== null && bad.size.baseMb > 500, String(bad.size.baseMb));
check('layers add weight', bad.size.addedMb > 0, String(bad.size.addedMb));
check('total computed', bad.size.totalMb !== null && bad.size.totalMb > bad.size.baseMb);
check('optimized is smaller', bad.size.optimizedMb !== null && bad.size.optimizedMb < bad.size.totalMb,
  `${bad.size.totalMb} -> ${bad.size.optimizedMb}`);
check('savings percent sane', bad.size.savingsPercent > 0 && bad.size.savingsPercent < 100,
  String(bad.size.savingsPercent));
check('confidence is declared', ['measured', 'known', 'estimated', 'unknown'].includes(bad.size.baseConfidence),
  bad.size.baseConfidence);

console.log('\n--- generated Dockerfile ---');
const optimized = bad.optimized.content;
check('produced changes', bad.optimized.changes.length >= 4, String(bad.optimized.changes.length));
check('swapped the base image', /FROM node:\S+-alpine/.test(optimized), optimized.split('\n')[0]);
check('npm ci replaces npm install', optimized.includes('npm ci'), '');
check('apt lists cleaned up', optimized.includes('rm -rf /var/lib/apt/lists'), '');
check('pip cache disabled', optimized.includes('--no-cache-dir'), '');
check('non-root user added', /^USER /m.test(optimized), '');
check('no duplicated keyword', !/FROM\s+FROM|RUN\s+RUN|COPY\s+COPY/.test(optimized), '');
check('still starts with FROM', optimized.trimStart().startsWith('FROM') ||
  optimized.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.startsWith('FROM'), '');

console.log('\n--- the generated file is genuinely better ---');
const reanalyzed = await analyze({
  content: optimized,
  filename: 'Dockerfile',
  options: { hasDockerignore: false, bloatCandidates: ['.git'] },
  skipScan: true,
});
check('fewer findings than before', reanalyzed.findings.length < bad.findings.length,
  `${bad.findings.length} -> ${reanalyzed.findings.length}`);
check('optimization score improved', reanalyzed.scores.optimizationScore > bad.scores.optimizationScore,
  `${bad.scores.optimizationScore} -> ${reanalyzed.scores.optimizationScore}`);
const newIds = [...new Set(reanalyzed.findings.map((f) => f.ruleId))].filter((id) => !ids.has(id));
check('introduced no new problems', newIds.length === 0, newIds.join(', '));

console.log('\n--- a good Dockerfile is left alone ---');
const good = await analyze({
  content: IDIOMATIC,
  filename: 'Dockerfile',
  options: { hasDockerignore: true },
  skipScan: true,
});
check('no findings', good.findings.length === 0, good.findings.map((f) => f.ruleId).join(', '));
check('perfect scores', good.scores.optimizationScore === 100 && good.scores.securityScore === 100);
check('nothing to change', good.optimized.changes.length === 0, good.optimized.changes.join('; '));

console.log('\n--- security scan (real Trivy) ---');
const scanned = await analyze({
  content: 'FROM alpine:3.20\nUSER nobody\nCMD ["sh"]\n',
  filename: 'Dockerfile',
  dockerfilePath,
  options: { hasDockerignore: true },
});

if (scanned.scan.status === 'unavailable') {
  console.log(`  SKIP  Trivy not usable: ${scanned.scan.reason}`);
  check('reports unavailability honestly, not as "clean"', scanned.scan.summary.total === 0 &&
    scanned.scan.reason.length > 0);
} else {
  check('scan ran', ['ok', 'partial'].includes(scanned.scan.status), scanned.scan.status);
  check('reports the Trivy version', Boolean(scanned.scan.version), String(scanned.scan.version));
  check('scanned the base image', scanned.scan.scannedImages.includes('alpine:3.20'),
    scanned.scan.scannedImages.join(', '));
  check('summary matches the findings', scanned.scan.summary.total >= scanned.scan.vulnerabilities.length);
  if (scanned.scan.vulnerabilities.length) {
    const cve = scanned.scan.vulnerabilities[0];
    check('CVEs carry an id and severity', Boolean(cve.cveId) &&
      ['critical', 'high', 'medium', 'low', 'unknown'].includes(cve.severity), JSON.stringify(cve.severity));
    check('CVEs name the affected package', cve.packages.length > 0 && Boolean(cve.packages[0].name));
  }
}

console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}`);
process.exit(fail ? 1 : 0);
