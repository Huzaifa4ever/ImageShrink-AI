import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');

execFileSync('node', [join(here, 'sync-shared.mjs')], { stdio: 'ignore' });
const serverRoot = resolve(extensionRoot, '..', 'server');

const CASES = [
  ['neglected node app', `FROM node
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
`, { hasDockerignore: false, bloatCandidates: ['.git', 'node_modules'] }],

  ['idiomatic multi-stage', `# syntax=docker/dockerfile:1
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
`, { hasDockerignore: true }],

  ['ubuntu with apt', `FROM ubuntu:24.04
RUN apt-get update
RUN apt-get install -y build-essential curl
RUN apt-get upgrade -y
COPY . /src
CMD ["/src/run.sh"]
`, { hasDockerignore: true }],

  ['python single stage', `FROM python:3.12
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "main.py"]
`, { hasDockerignore: true }],

  ['go multi-stage to scratch', `FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app ./cmd/server

FROM scratch
COPY --from=build /app /app
ENTRYPOINT ["/app"]
`, { hasDockerignore: true }],

  ['multi-line continuations with comments', `FROM debian:bookworm-slim
RUN apt-get update \\
    # we need curl and git
    && apt-get install -y --no-install-recommends curl git \\
    && rm -rf /var/lib/apt/lists/*
RUN sudo echo hi
USER nobody
CMD ["bash"]
`, { hasDockerignore: true }],

  ['alpine with apk', `FROM alpine:3.20
RUN apk add curl
RUN apk add git
RUN apk add bash
COPY . .
CMD ["sh"]
`, { hasDockerignore: false }],

  ['global tool install', `FROM node:22.11-alpine
RUN npm install -g pnpm
USER node
CMD ["pnpm", "start"]
`, { hasDockerignore: true }],

  ['digest pinned', `FROM node:latest@sha256:abc123
USER node
CMD ["node"]
`, { hasDockerignore: true }],

  ['distroless nonroot', `FROM gcr.io/distroless/static-debian12:nonroot
COPY app /app
ENTRYPOINT ["/app"]
`, { hasDockerignore: true }],

  ['yarn and floating tag', `FROM node:lts
WORKDIR /app
COPY . .
RUN yarn install
USER node
CMD ["yarn", "start"]
`, { hasDockerignore: false }],

  ['unknown dockerignore state', `FROM node:22.11-alpine
COPY . .
USER node
CMD ["node", "x.js"]
`, {}],

  ['empty', '', {}],
  ['comments only', '# just a comment\n\n# another\n', {}],
  ['garbage', '}{ not a dockerfile at all\nrandom text\n', {}],
];

const outfile = join(mkdtempSync(join(tmpdir(), 'imageshrink-parity-')), 'engine.mjs');
await esbuild.build({
  entryPoints: [join(extensionRoot, 'src', 'rules', 'engine.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile,
  logLevel: 'error',
});

const { analyze, score } = await import(outfile);

function normalize(finding) {
  return {
    ruleId: finding.ruleId,
    line: finding.line,
    column: finding.column,
    endLine: finding.endLine,
    endColumn: finding.endColumn,
    severity: finding.severity,
    fixKind: finding.fixKind,
    replacement: finding.replacement,
    savingsMb: finding.savingsMb,
    suggestedImage: finding.suggestedImage,
    problem: finding.problem,
  };
}

const payload = JSON.stringify(
  CASES.map(([label, content, options]) => ({ label, content, options }))
);

const pythonScript = `
import json, sys
from app.services import rule_engine

cases = json.loads(sys.stdin.read())
out = []
for case in cases:
    opts = case["options"]
    findings = rule_engine.analyze(
        case["content"],
        has_dockerignore=opts.get("hasDockerignore"),
        dockerignore=opts.get("dockerignore"),
        bloat_candidates=opts.get("bloatCandidates") or [],
    )
    out.append({
        "label": case["label"],
        "findings": rule_engine.to_dicts(findings),
        "scores": rule_engine.score(findings),
    })
print(json.dumps(out))
`;

function resolvePython() {
  const candidates = [
    process.env.PARITY_PYTHON,
    join(serverRoot, 'venv', 'bin', 'python'),
    join(serverRoot, '.ci-venv', 'bin', 'python'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  console.error(
    'check-parity: no Python interpreter with the server dependencies installed.\n' +
      `  looked at: ${candidates.join(', ')}\n` +
      '  create server/venv (python3 -m venv venv && venv/bin/pip install -r requirements.txt)\n' +
      '  or set PARITY_PYTHON to an interpreter that can import app.services.rule_engine.'
  );
  process.exit(1);
}

const pythonOut = execFileSync(resolvePython(), ['-c', pythonScript], {
  cwd: serverRoot,
  input: payload,
  env: { ...process.env, PYTHONPATH: serverRoot },
  maxBuffer: 64 * 1024 * 1024,
});

const pythonResults = JSON.parse(pythonOut.toString());

let failures = 0;
let compared = 0;

for (const [index, [label, content, options]] of CASES.entries()) {
  const expected = pythonResults[index];
  const tsFindings = analyze(content, options).map(normalize);
  const pyFindings = expected.findings.map(normalize);
  const tsScores = score(analyze(content, options));

  const problems = [];

  const tsIds = tsFindings.map((f) => `${f.ruleId}@${f.line}`).sort();
  const pyIds = pyFindings.map((f) => `${f.ruleId}@${f.line}`).sort();
  if (JSON.stringify(tsIds) !== JSON.stringify(pyIds)) {
    problems.push(`  rules differ\n    ts: ${tsIds.join(', ') || '(none)'}\n    py: ${pyIds.join(', ') || '(none)'}`);
  } else {
    for (const [i, tsFinding] of tsFindings.entries()) {
      const pyFinding = pyFindings[i];
      for (const key of Object.keys(tsFinding)) {
        if (JSON.stringify(tsFinding[key]) !== JSON.stringify(pyFinding[key])) {
          problems.push(
            `  ${tsFinding.ruleId}.${key} differs\n    ts: ${JSON.stringify(tsFinding[key])}\n    py: ${JSON.stringify(pyFinding[key])}`
          );
        }
      }
    }
  }

  for (const key of ['optimizationScore', 'securityScore', 'performanceScore', 'estimatedSavingsMb']) {
    if (tsScores[key] !== expected.scores[key]) {
      problems.push(`  score ${key} differs: ts=${tsScores[key]} py=${expected.scores[key]}`);
    }
  }

  compared += 1;
  if (problems.length) {
    failures += 1;
    console.log(`FAIL  ${label}`);
    console.log(problems.join('\n'));
  } else {
    console.log(`PASS  ${label}  (${tsFindings.length} findings)`);
  }
}

console.log(`\n${'='.repeat(46)}\n  ${compared - failures}/${compared} cases in parity\n${'='.repeat(46)}`);
process.exit(failures ? 1 : 0);
