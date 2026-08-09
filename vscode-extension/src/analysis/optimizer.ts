import type { Finding } from '../rules/catalog';
import * as engine from '../rules/engine';
import type { AnalyzeOptions } from '../rules/engine';
import * as lex from '../rules/lexer';
import type { OptimizedDockerfile } from './types';

const MANIFESTS: Array<{ match: RegExp; copy: string }> = [
  { match: /npm\s+(ci|install|i)\b/i, copy: 'package.json package-lock.json ./' },
  { match: /pnpm\s+(install|i)\b/i, copy: 'package.json pnpm-lock.yaml ./' },
  { match: /yarn(\s+install)?\b/i, copy: 'package.json yarn.lock ./' },
  { match: /pip3?\s+install\s+-r\s+requirements\.txt/i, copy: 'requirements.txt ./' },
  { match: /poetry\s+install/i, copy: 'pyproject.toml poetry.lock ./' },
  { match: /go\s+mod\s+download/i, copy: 'go.mod go.sum ./' },
  { match: /bundle\s+install/i, copy: 'Gemfile Gemfile.lock ./' },
  { match: /composer\s+install/i, copy: 'composer.json composer.lock ./' },
  { match: /cargo\s+(fetch|build)/i, copy: 'Cargo.toml Cargo.lock ./' },
];

interface Edit {
  startLine: number;
  endLine: number;
  replacement: string;
  insert: boolean;
  label: string;
}

function applyEdits(lines: string[], edits: Edit[]): { lines: string[]; applied: string[] } {
  const ordered = [...edits].sort((a, b) => b.startLine - a.startLine || b.endLine - a.endLine);

  const claimed: Array<[number, number]> = [];
  const applied: string[] = [];
  let out = [...lines];

  for (const edit of ordered) {
    const overlaps = claimed.some(
      ([start, end]) => !edit.insert && !(edit.endLine < start || edit.startLine > end)
    );
    if (overlaps) continue;

    const head = out.slice(0, edit.startLine - 1);
    const body = edit.replacement.replace(/\n+$/, '').split('\n');
    const tail = edit.insert ? out.slice(edit.startLine - 1) : out.slice(edit.endLine);

    out = [...head, ...body, ...tail];
    claimed.push([edit.startLine, edit.endLine]);
    applied.push(edit.label);
  }

  return { lines: out, applied: applied.reverse() };
}

function editsFrom(findings: Finding[]): Edit[] {
  const edits: Edit[] = [];

  for (const finding of findings) {
    if (!finding.replacement) continue;

    if (finding.fixKind === engine.FIX_REPLACE) {
      edits.push({
        startLine: finding.fixRange.line,
        endLine: finding.fixRange.endLine,
        replacement: finding.replacement,
        insert: false,
        label: finding.quickFixTitle ?? finding.title,
      });
    } else if (finding.fixKind === engine.FIX_INSERT) {
      edits.push({
        startLine: finding.fixRange.line,
        endLine: finding.fixRange.line,
        replacement: finding.replacement,
        insert: true,
        label: finding.quickFixTitle ?? finding.title,
      });
    }
  }

  return edits;
}

function reorderForCache(lines: string[]): { lines: string[]; change: string | null } {
  const content = lines.join('\n');
  const parsed = lex.parse(content);

  for (let stage = 0; stage < Math.max(parsed.stageCount, 1); stage += 1) {
    const instructions = lex.inStage(parsed, stage);

    const broadCopy = instructions.find((i) => {
      if (i.keyword !== 'COPY' && i.keyword !== 'ADD') return false;
      const tokens = i.value.split(/\s+/).filter((t) => t && !t.startsWith('--'));
      return tokens.length >= 2 && (tokens[0] === '.' || tokens[0] === './');
    });
    if (!broadCopy) continue;

    const install = instructions.find(
      (i) =>
        i.keyword === 'RUN' &&
        i.line > broadCopy.line &&
        MANIFESTS.some((m) => m.match.test(i.value))
    );
    if (!install) continue;

    const manifest = MANIFESTS.find((m) => m.match.test(install.value));
    if (!manifest) continue;

    const alreadyCopied = instructions.some(
      (i) => i.keyword === 'COPY' && i.line < broadCopy.line && manifest.copy.split(' ')[0] &&
             i.value.includes(manifest.copy.split(' ')[0]!)
    );
    if (alreadyCopied) continue;

    const copyText = lines.slice(broadCopy.line - 1, broadCopy.endLine);
    const rest = [...lines];

    rest.splice(broadCopy.line - 1, broadCopy.endLine - broadCopy.line + 1, `COPY ${manifest.copy}`);

    const shift = copyText.length - 1;
    const insertAfter = install.endLine - shift;
    rest.splice(insertAfter, 0, ...copyText);

    return {
      lines: rest,
      change: 'Copy the manifest first, install, then copy the source — so editing a file no longer reinstalls every dependency',
    };
  }

  return { lines, change: null };
}

const MULTISTAGE_HINT = [
  '# ImageShrink: this builds and runs in one stage, so compilers and dev dependencies ship',
  '# to production. Splitting it gives the largest single size win available:',
  '#',
  '#   FROM <builder-image> AS builder',
  '#   WORKDIR /app',
  '#   ... install dependencies and build ...',
  '#',
  '#   FROM <slim-runtime-image>',
  '#   WORKDIR /app',
  '#   COPY --from=builder /app/<build-output> ./',
  '#   USER <non-root>',
  '#   CMD [...]',
];

export function optimize(content: string, options: AnalyzeOptions = {}): OptimizedDockerfile {
  const changes: string[] = [];
  let lines = content.split('\n');

  const MAX_PASSES = 6;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const findings = engine.analyze(lines.join('\n'), options);
    const result = applyEdits(lines, editsFrom(findings));
    if (!result.applied.length) break;

    lines = result.lines;
    for (const label of result.applied) {
      if (!changes.includes(label)) changes.push(label);
    }
  }

  const reordered = reorderForCache(lines);
  if (reordered.change) changes.push(reordered.change);
  lines = reordered.lines;

  const needsMultiStage = engine
    .analyze(lines.join('\n'), options)
    .some((f) => f.ruleId === 'single-stage-build');
  if (needsMultiStage) {
    lines = [...MULTISTAGE_HINT, '', ...lines];
    changes.push('Flagged a multi-stage opportunity (needs your input on which files to keep)');
  }

  const cleaned = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');

  return {
    content: `${cleaned}\n`,
    changes,
    needsReview: needsMultiStage,
  };
}
