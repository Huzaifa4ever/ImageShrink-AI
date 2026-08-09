
import * as cat from './catalog';
import type { Finding, FixKind, Severity, Span } from './catalog';
import * as lex from './lexer';
import type { ImageRef, Instruction, ParsedDockerfile } from './lexer';

export const FIX_REPLACE: FixKind = 'replace';
export const FIX_INSERT: FixKind = 'insert';
export const FIX_CREATE_DOCKERIGNORE: FixKind = 'createDockerignore';
export const FIX_AI_REWRITE: FixKind = 'aiRewrite';

export interface AnalyzeOptions {
  hasDockerignore?: boolean | undefined;
  dockerignore?: string | undefined;
  bloatCandidates?: string[];
}

interface Context {
  content: string;
  parsed: ParsedDockerfile;
  hasDockerignore: boolean | undefined;
  bloatCandidates: string[];
  images: Map<number, ImageRef>;
  finalStage: number;
  multiStage: boolean;
}

interface Raw {
  detail?: string;
  message?: string;
  replacement?: string | null;
  fixKind?: FixKind | null;
  fixSpan?: Span;
  sizeImpactMb?: number;
  savingsMb?: number;
  compatibility?: number;
  suggestedImage?: string;
}

function make(ruleId: string, span: Span, extra: Raw = {}): Finding {
  const r = cat.rule(ruleId);
  return {
    ruleId,
    title: r.title,
    severity: r.severity,
    category: r.category,
    instruction: r.instruction,
    problem: extra.message ?? r.problem,
    explanation: r.explanation,
    securityImpact: r.securityImpact,
    performanceImpact: r.performanceImpact,
    docsUrl: r.docsUrl,
    quickFixTitle: r.quickFixTitle,
    detail: extra.detail ?? '',
    line: span.line,
    column: span.column,
    endLine: span.endLine,
    endColumn: span.endColumn,
    replacement: extra.replacement ?? null,
    fixKind: extra.fixKind ?? null,
    fixRange: extra.fixSpan ?? span,
    autoFixable: (extra.fixKind ?? null) !== null,
    sizeImpactMb: extra.sizeImpactMb ?? r.sizeImpactMb,
    savingsMb: extra.savingsMb ?? r.savingsMb,
    compatibility: extra.compatibility ?? null,
    suggestedImage: extra.suggestedImage ?? null,
  };
}

const FAMILY_ALIASES: Record<string, string> = {
  node: 'node',
  nodejs: 'node',
  python: 'python',
  python3: 'python',
  ubuntu: 'ubuntu',
  debian: 'debian',
  golang: 'golang',
  go: 'golang',
  openjdk: 'openjdk',
  'eclipse-temurin': 'openjdk',
  temurin: 'openjdk',
  amazoncorretto: 'openjdk',
  nginx: 'nginx',
  ruby: 'ruby',
  php: 'php',
};

function familyFor(ref: ImageRef): [string, cat.ImageFamily] | null {
  if (ref.path.includes('dotnet')) {
    const fam = cat.family('dotnet');
    return fam ? ['dotnet', fam] : null;
  }
  const key = FAMILY_ALIASES[lex.imageName(ref).toLowerCase()];
  if (!key) return null;
  const fam = cat.family(key);
  return fam ? [key, fam] : null;
}

function segments(command: string): string[] {
  return command
    .split(/&&|\|\||;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isBareInstall(segment: string, pattern: RegExp): boolean {
  const match = pattern.exec(segment);
  if (!match || match.index !== 0) return false;
  const rest = segment.slice(match[0].length).trim();
  if (!rest) return true;
  return rest.split(/\s+/).every((token) => token.startsWith('-'));
}

function isGlobalInstall(segment: string): boolean {
  const tokens = segment.split(/\s+/);
  return tokens.includes('-g') || tokens.includes('--global');
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteFrom(instruction: Instruction, ref: ImageRef, newImage: string): string {
  return instruction.raw.replace(new RegExp(escapeRe(ref.raw)), newImage);
}

function subInRaw(instruction: Instruction, pattern: RegExp, replacement: string): string | null {
  const flags = pattern.flags.includes('i') ? 'i' : '';
  const once = new RegExp(pattern.source, flags);
  if (!once.test(instruction.raw)) return null;
  return instruction.raw.replace(new RegExp(pattern.source, flags), replacement);
}

const OMIT_FLAGS = ['--omit=dev', '--production', '--only=production', '--only=prod', '--no-dev'];

function hasOmitFlag(segment: string): boolean {
  return OMIT_FLAGS.some((flag) => segment.includes(flag));
}

const FLOATING_TAGS = new Set([
  'lts', 'stable', 'current', 'edge', 'alpine', 'slim', 'mainline', 'jre', 'jdk',
]);

function ruleBaseImageSize(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  for (const instruction of lex.of(ctx.parsed, 'FROM')) {
    const ref = ctx.images.get(instruction.stageIndex);
    if (!ref || ref.isStageReference || lex.isScratch(ref) || lex.isDistroless(ref)) continue;

    const fam = familyFor(ref);
    if (!fam) continue;
    const [name, data] = fam;

    if (name === 'ubuntu') continue;
    if (lex.isSlimVariant(ref)) continue;

    let best = cat.bestRecommendation(data);
    if (!best) continue;

    const currentMb = data.defaultSizeMb;
    let savings = currentMb - best.sizeMb;
    if (savings < 40) continue;

    if (best.image.includes('distroless') && instruction.stageIndex !== ctx.finalStage) {
      const alternative = data.recommendations.find((r) => !r.image.includes('distroless'));
      if (!alternative) continue;
      best = alternative;
      savings = currentMb - best.sizeMb;
    }

    findings.push(
      make(
        'large-base-image',
        lex.columnOf(instruction, ref.raw),
        {
          message: `${ref.raw} is roughly ${currentMb} MB - ${best.image} does the same job in about ${best.sizeMb} MB.`,
          detail: `Estimated saving: ~${savings} MB. Compatibility: ~${best.compatibility}% likely to be a drop-in swap. ${best.note ?? ''}`.trim(),
          replacement: rewriteFrom(instruction, ref, best.image),
          fixKind: FIX_REPLACE,
          fixSpan: lex.fullSpan(instruction),
          sizeImpactMb: currentMb,
          savingsMb: savings,
          compatibility: best.compatibility,
          suggestedImage: best.image,
        }
      )
    );
  }

  return findings;
}

function ruleUbuntuBase(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  const fam = cat.family('ubuntu');
  if (!fam) return findings;
  const best = cat.bestRecommendation(fam);
  if (!best) return findings;

  for (const instruction of lex.of(ctx.parsed, 'FROM')) {
    const ref = ctx.images.get(instruction.stageIndex);
    if (!ref || ref.isStageReference || lex.imageName(ref).toLowerCase() !== 'ubuntu') continue;

    findings.push(
      make('ubuntu-base-image', lex.columnOf(instruction, ref.raw), {
        detail: `${best.image} is about ${best.sizeMb} MB against ~${fam.defaultSizeMb} MB, and shares almost all package names. Compatibility: ~${best.compatibility}%. ${best.note ?? ''}`.trim(),
        replacement: rewriteFrom(instruction, ref, best.image),
        fixKind: FIX_REPLACE,
        fixSpan: lex.fullSpan(instruction),
        savingsMb: Math.max(fam.defaultSizeMb - best.sizeMb, 0),
        compatibility: best.compatibility,
        suggestedImage: best.image,
      })
    );
  }

  return findings;
}

function ruleUnpinnedBase(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  for (const instruction of lex.of(ctx.parsed, 'FROM')) {
    const ref = ctx.images.get(instruction.stageIndex);
    if (!ref || ref.isStageReference || lex.isScratch(ref)) continue;
    if (ref.digest) continue;
    if (ref.tag !== null && ref.tag !== 'latest') continue;

    const fam = familyFor(ref);
    const suggestion = fam ? cat.bestRecommendation(fam[1])?.image : undefined;

    findings.push(
      make('unpinned-base-image', lex.columnOf(instruction, ref.raw), {
        message:
          ref.tag === null
            ? `${ref.raw} has no version tag - it resolves to :latest.`
            : `${ref.raw} uses the mutable :latest tag.`,
        detail: suggestion
          ? `Suggested: ${suggestion}, which pins a version.`
          : 'Pin at least a major and minor version, or a digest for a fully reproducible build.',
        replacement: suggestion ? rewriteFrom(instruction, ref, suggestion) : null,
        fixKind: suggestion ? FIX_REPLACE : null,
        fixSpan: lex.fullSpan(instruction),
        ...(suggestion ? { suggestedImage: suggestion } : {}),
      })
    );
  }

  return findings;
}

function ruleFloatingTag(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  for (const instruction of lex.of(ctx.parsed, 'FROM')) {
    const ref = ctx.images.get(instruction.stageIndex);
    if (!ref || ref.isStageReference || lex.isScratch(ref) || ref.digest) continue;

    const tag = (ref.tag ?? '').toLowerCase();
    if (!tag || tag === 'latest') continue;

    const baseComponent = tag.split('-')[0] ?? '';
    const floats =
      FLOATING_TAGS.has(tag) || FLOATING_TAGS.has(baseComponent) || /^\d+$/.test(baseComponent);
    if (!floats) continue;

    findings.push(
      make('floating-major-tag', lex.columnOf(instruction, ref.raw), {
        message: `The tag '${ref.tag}' moves to new releases without warning.`,
        detail: 'Pin the minor version so upgrades arrive as a reviewable change.',
      })
    );
  }

  return findings;
}

const COMPILE_MARKERS = [
  /npm\s+run\s+build/i,
  /yarn\s+build/i,
  /pnpm\s+(run\s+)?build/i,
  /go\s+build/i,
  /cargo\s+build/i,
  /mvn\b/i,
  /gradle\b/i,
  /dotnet\s+(build|publish)/i,
  /\bmake\b/i,
  /\btsc\b/i,
  /webpack/i,
  /vite\s+build/i,
  /\bjavac\b/i,
  /\brustc\b/i,
  /build-essential/i,
  /\bgcc\b/i,
  /\bg\+\+/i,
];

function hasBuildStep(ctx: Context): boolean {
  for (const instruction of lex.of(ctx.parsed, 'RUN')) {
    if (COMPILE_MARKERS.some((re) => re.test(instruction.value))) return true;

    for (const segment of segments(instruction.value)) {
      if (isGlobalInstall(segment)) continue;
      if (hasOmitFlag(segment)) continue;
      if (isBareInstall(segment, /(?:npm|pnpm)\s+(?:ci|install|i)\b/i)) return true;
      if (isBareInstall(segment, /yarn(?:\s+install)?\b/i)) return true;
    }
  }
  return false;
}

function ruleSingleStage(ctx: Context): Finding[] {
  if (ctx.parsed.stageCount !== 1) return [];
  if (!hasBuildStep(ctx)) return [];

  const instruction = lex.of(ctx.parsed, 'FROM')[0];
  if (!instruction) return [];

  const ref = ctx.images.get(instruction.stageIndex);
  let finalHint = '';
  if (ref) {
    const fam = familyFor(ref);
    const suggested = fam ? cat.distrolessFinalStage(fam[0]) : undefined;
    if (suggested) finalHint = ` A good final stage for this project would be ${suggested}.`;
  }

  return [
    make('single-stage-build', lex.fullSpan(instruction), {
      detail: `Build in one stage, then copy only the built artefact into a clean final stage.${finalHint} Run ImageShrink: Optimize Dockerfile to generate the rewrite.`,
      fixKind: FIX_AI_REWRITE,
    }),
  ];
}

function ruleNpm(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  for (const instruction of lex.of(ctx.parsed, 'RUN')) {
    const segs = segments(instruction.value).filter((s) => !isGlobalInstall(s));

    for (const segment of segs) {
      if (isBareInstall(segment, /npm\s+(?:install|i)\b/i)) {
        const fixed = subInRaw(instruction, /npm\s+(?:install|i)\b/i, 'npm ci --omit=dev');
        findings.push(
          make('npm-install-not-ci', lex.columnOf(instruction, 'npm'), {
            detail:
              'npm ci installs exactly what package-lock.json specifies and skips resolution, so it is faster and deterministic. Requires a lockfile to be committed and COPYed in.',
            replacement: fixed,
            fixKind: fixed ? FIX_REPLACE : null,
            fixSpan: lex.fullSpan(instruction),
          })
        );
        break;
      }
    }

    if (instruction.stageIndex !== ctx.finalStage) continue;
    for (const segment of segs) {
      if (!/npm\s+(?:ci|install|i)\b/i.test(segment)) continue;
      if (hasOmitFlag(segment)) continue;

      const fixed = subInRaw(instruction, /(npm\s+(?:ci|install|i))\b/i, '$1 --omit=dev');
      findings.push(
        make('npm-includes-dev-dependencies', lex.columnOf(instruction, 'npm'), {
          detail:
            'This is the final stage, so devDependencies installed here ship to production. Test runners and bundlers routinely outweigh the app.',
          replacement: fixed,
          fixKind: fixed ? FIX_REPLACE : null,
          fixSpan: lex.fullSpan(instruction),
        })
      );
      break;
    }
  }

  return findings;
}

function ruleYarn(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  for (const instruction of lex.of(ctx.parsed, 'RUN')) {
    for (const segment of segments(instruction.value)) {
      if (!isBareInstall(segment, /yarn(?:\s+install)?\b/i)) continue;
      if (segment.includes('--immutable') || segment.includes('--frozen-lockfile')) continue;

      const fixed = subInRaw(
        instruction,
        /yarn(\s+install)?\b/i,
        'yarn install --immutable --production'
      );
      findings.push(
        make('yarn-install-not-immutable', lex.columnOf(instruction, 'yarn'), {
          detail:
            'Use --immutable on Yarn 2+ or --frozen-lockfile on Yarn 1 so a lockfile mismatch fails the build instead of resolving silently.',
          replacement: fixed,
          fixKind: fixed ? FIX_REPLACE : null,
          fixSpan: lex.fullSpan(instruction),
        })
      );
      break;
    }
  }

  return findings;
}

function ruleApt(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  const installRe = /apt(?:-get)?\s+install/i;
  const runs = lex.of(ctx.parsed, 'RUN');
  const aptInstalls = runs.filter((i) => installRe.test(i.value));

  for (const instruction of runs) {
    const value = instruction.value;
    const installs = installRe.test(value);

    if (installs && !value.includes('/var/lib/apt/lists')) {
      const fixed =
        instruction.raw.trimEnd() +
        (lex.isMultiline(instruction)
          ? ' \\\n    && rm -rf /var/lib/apt/lists/*'
          : ' && rm -rf /var/lib/apt/lists/*');
      findings.push(
        make('apt-missing-cleanup', lex.columnOf(instruction, 'apt'), {
          detail:
            'Deleting the lists in a later RUN does not help - they are already committed to this layer and both copies ship.',
          replacement: fixed,
          fixKind: FIX_REPLACE,
          fixSpan: lex.fullSpan(instruction),
        })
      );
    }

    if (installs && !value.includes('--no-install-recommends')) {
      const fixed = subInRaw(
        instruction,
        /(apt(?:-get)?\s+install)/i,
        '$1 --no-install-recommends'
      );
      findings.push(
        make('apt-missing-no-install-recommends', lex.columnOf(instruction, 'apt'), {
          detail:
            'Recommended packages are conveniences for interactive systems. Install anything genuinely required by name instead.',
          replacement: fixed,
          fixKind: fixed ? FIX_REPLACE : null,
          fixSpan: lex.fullSpan(instruction),
        })
      );
    }

    if (/apt(?:-get)?\s+(dist-)?upgrade/i.test(value)) {
      findings.push(
        make('apt-get-upgrade', lex.columnOf(instruction, 'apt'), {
          detail:
            'Pin a base image that is already patched and rebuild on a schedule, so upgrades arrive as a reviewable change of tag.',
        })
      );
    }

    if (/apt(?:-get)?\s+update/i.test(value) && !installs) {
      if (aptInstalls.some((other) => other.line > instruction.line)) {
        findings.push(
          make('apt-update-in-separate-layer', lex.columnOf(instruction, 'apt'), {
            detail:
              'Docker will reuse this cached layer while the install layer re-runs, so apt looks for versions the mirror no longer has and the build fails with a 404. Chain update and install in one RUN.',
          })
        );
      }
    }
  }

  return findings;
}

function rulePip(ctx: Context): Finding[] {
  if (/PIP_NO_CACHE_DIR/i.test(ctx.content)) return [];

  const findings: Finding[] = [];
  const pipSource = '(?:python3?\\s+-m\\s+)?pip3?\\s+install';

  for (const instruction of lex.of(ctx.parsed, 'RUN')) {
    if (!new RegExp(pipSource, 'i').test(instruction.value)) continue;
    if (instruction.value.includes('--no-cache-dir')) continue;

    const fixed = subInRaw(instruction, new RegExp(`(${pipSource})`, 'i'), '$1 --no-cache-dir');
    findings.push(
      make('pip-missing-no-cache-dir', lex.columnOf(instruction, 'pip'), {
        detail:
          "A container installs once, so pip's wheel cache has no second install to accelerate - it is pure overhead in the layer.",
        replacement: fixed,
        fixKind: fixed ? FIX_REPLACE : null,
        fixSpan: lex.fullSpan(instruction),
      })
    );
  }

  return findings;
}

function ruleApk(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  for (const instruction of lex.of(ctx.parsed, 'RUN')) {
    const value = instruction.value;
    if (!/apk\s+add/i.test(value)) continue;
    if (value.includes('--no-cache') || value.includes('/var/cache/apk')) continue;

    const fixed = subInRaw(instruction, /(apk\s+add)/i, '$1 --no-cache');
    findings.push(
      make('apk-missing-no-cache', lex.columnOf(instruction, 'apk'), {
        detail: '--no-cache fetches the index, installs, and discards it in one step.',
        replacement: fixed,
        fixKind: fixed ? FIX_REPLACE : null,
        fixSpan: lex.fullSpan(instruction),
      })
    );
  }

  return findings;
}

function ruleCurlPipeShell(ctx: Context): Finding[] {
  const pattern = /(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b/i;
  return lex
    .of(ctx.parsed, 'RUN')
    .filter((instruction) => pattern.test(instruction.value))
    .map((instruction) =>
      make('curl-pipe-to-shell', lex.fullSpan(instruction), {
        detail:
          'Download to a file, verify a checksum or signature, then execute - so a compromised upstream host cannot run arbitrary code in your build.',
      })
    );
}

function ruleSudo(ctx: Context): Finding[] {
  return lex
    .of(ctx.parsed, 'RUN')
    .filter((instruction) => /\bsudo\b/.test(instruction.value))
    .map((instruction) =>
      make('sudo-in-container', lex.columnOf(instruction, 'sudo'), {
        detail:
          'Build steps already run as root, so sudo adds a package and an escalation path for nothing. Use USER to change accounts.',
        replacement: subInRaw(instruction, /sudo\s+/i, ''),
        fixKind: FIX_REPLACE,
        fixSpan: lex.fullSpan(instruction),
      })
    );
}

function ruleConsecutiveRuns(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  const flush = (streak: Instruction[]): void => {
    if (streak.length < 3) return;
    const first = streak[0]!;
    const last = streak[streak.length - 1]!;
    const lastLines = last.raw.split('\n');
    findings.push(
      make(
        'separate-run-layers',
        {
          line: first.line,
          column: 1,
          endLine: last.endLine,
          endColumn: (lastLines[lastLines.length - 1] ?? '').length + 1,
        },
        {
          message: `${streak.length} consecutive RUN instructions create ${streak.length} layers.`,
          detail:
            'Chaining related commands with && keeps intermediate files out of the image. Keep commands that change at different rates separate, though - merging those throws away useful caching.',
        }
      )
    );
  };

  for (let stage = 0; stage < Math.max(ctx.parsed.stageCount, 1); stage += 1) {
    let streak: Instruction[] = [];
    for (const instruction of lex.inStage(ctx.parsed, stage)) {
      if (instruction.keyword === 'RUN') {
        streak.push(instruction);
      } else {
        flush(streak);
        streak = [];
      }
    }
    flush(streak);
  }

  return findings;
}

export const DOCKERIGNORE_TEMPLATE = `# Version control
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
`;

function copiesWholeContext(instruction: Instruction): boolean {
  const tokens = instruction.value.split(/\s+/).filter((t) => t && !t.startsWith('--'));
  if (tokens.length < 2) return false;
  return tokens[0] === '.' || tokens[0] === './';
}

function ruleCopyEntireContext(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  for (const instruction of lex.of(ctx.parsed, 'COPY', 'ADD')) {
    if (!copiesWholeContext(instruction)) continue;

    const unbounded = ctx.hasDockerignore === false;
    const shipsToProduction = instruction.stageIndex === ctx.finalStage && ctx.multiStage;
    if (!unbounded && !shipsToProduction) continue;

    let extra = '';
    if (ctx.bloatCandidates.length) {
      extra = ` Paths in this workspace that would come along: ${ctx.bloatCandidates.slice(0, 6).join(', ')}.`;
    } else if (unbounded) {
      extra = ' There is no .dockerignore, so nothing is excluded.';
    }

    findings.push(
      make('copy-entire-context', lex.fullSpan(instruction), {
        detail: `Copy the paths you need explicitly, or keep a complete .dockerignore.${extra}`,
        replacement: unbounded ? DOCKERIGNORE_TEMPLATE : null,
        fixKind: unbounded ? FIX_CREATE_DOCKERIGNORE : null,
      })
    );
  }

  return findings;
}

function ruleMissingDockerignore(ctx: Context): Finding[] {
  if (ctx.hasDockerignore !== false) return [];

  const broad = lex.of(ctx.parsed, 'COPY', 'ADD').filter(copiesWholeContext);
  const anchor = broad[0];
  if (!anchor) return [];

  const extra = ctx.bloatCandidates.length
    ? ` Detected in this workspace: ${ctx.bloatCandidates.slice(0, 8).join(', ')}.`
    : '';

  return [
    make('missing-dockerignore', lex.fullSpan(anchor), {
      detail: `Everything in the context is uploaded to the daemon before the build starts, and anything a COPY matches lands in the image.${extra}`,
      replacement: DOCKERIGNORE_TEMPLATE,
      fixKind: FIX_CREATE_DOCKERIGNORE,
    }),
  ];
}

const DEPENDENCY_MANIFESTS = [
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'requirements.txt',
  'pyproject.toml', 'poetry.lock', 'go.mod', 'go.sum', 'Gemfile', 'composer.json', 'Cargo.toml',
];

const DEPENDENCY_INSTALL_RE =
  /(npm\s+(ci|install|i)\b|yarn(\s+install)?\b|pnpm\s+(install|i)\b|pip3?\s+install|poetry\s+install|bundle\s+install|composer\s+install|go\s+mod\s+download|cargo\s+fetch|dotnet\s+restore)/i;

function ruleCopyBeforeInstall(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  for (let stage = 0; stage < Math.max(ctx.parsed.stageCount, 1); stage += 1) {
    const instructions = lex.inStage(ctx.parsed, stage);

    const broadCopy = instructions.find(
      (i) => (i.keyword === 'COPY' || i.keyword === 'ADD') && copiesWholeContext(i)
    );
    if (!broadCopy) continue;

    const install = instructions.find(
      (i) => i.keyword === 'RUN' && i.line > broadCopy.line && DEPENDENCY_INSTALL_RE.test(i.value)
    );
    if (!install) continue;

    const earlierManifestCopy = instructions.some(
      (i) =>
        i.keyword === 'COPY' &&
        i.line < broadCopy.line &&
        DEPENDENCY_MANIFESTS.some((manifest) => i.value.includes(manifest))
    );
    if (earlierManifestCopy) continue;

    findings.push(
      make('copy-before-dependency-install', lex.fullSpan(broadCopy), {
        detail: `The install on line ${install.line} re-runs whenever any file changes. Copy the manifest and lockfile first, install, then copy the source.`,
      })
    );
  }

  return findings;
}

const ARCHIVE_SUFFIXES = [
  '.tar', '.tar.gz', '.tgz', '.tar.bz2', '.tbz2', '.tar.xz', '.txz', '.gz', '.bz2', '.xz', '.zip',
];

function ruleAddInsteadOfCopy(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  for (const instruction of lex.of(ctx.parsed, 'ADD')) {
    const tokens = instruction.value.split(/\s+/).filter((t) => t && !t.startsWith('--'));
    const source = tokens[0];
    if (!source) continue;

    if (/^(https?:\/\/|git@)/.test(source)) continue;
    if (ARCHIVE_SUFFIXES.some((suffix) => source.toLowerCase().endsWith(suffix))) continue;

    findings.push(
      make('add-instead-of-copy', lex.columnOf(instruction, 'ADD'), {
        detail: 'COPY does exactly one thing, so it is the safer default here.',
        replacement: subInRaw(instruction, /^(\s*)ADD\b/i, '$1COPY'),
        fixKind: FIX_REPLACE,
        fixSpan: lex.fullSpan(instruction),
      })
    );
  }

  return findings;
}

function ruleMissingUser(ctx: Context): Finding[] {
  if (ctx.parsed.stageCount === 0) return [];

  const stageInstructions = lex.inStage(ctx.parsed, ctx.finalStage);
  if (
    stageInstructions.some(
      (i) => i.keyword === 'USER' && i.value.trim() !== 'root' && i.value.trim() !== '0'
    )
  ) {
    return [];
  }

  const final = ctx.images.get(ctx.finalStage);
  if (final && (final.tag ?? '').toLowerCase().endsWith('nonroot')) return [];

  const starters = stageInstructions.filter(
    (i) => i.keyword === 'CMD' || i.keyword === 'ENTRYPOINT'
  );
  const anchorLine = starters[0]
    ? starters[0].line
    : (stageInstructions[stageInstructions.length - 1]?.endLine ?? 0) + 1;

  const fam = final ? familyFor(final) : null;
  let block: string;
  if (final && (lex.isScratch(final) || lex.isDistroless(final))) {
    block = 'USER 65534:65534\n';
  } else if (fam && fam[0] === 'node') {
    block = 'USER node\n';
  } else if (final && `${final.tag ?? ''}${final.path}`.toLowerCase().includes('alpine')) {
    block =
      'RUN addgroup -S -g 1001 appuser \\\n    && adduser -S -u 1001 -G appuser appuser\nUSER appuser\n';
  } else {
    block =
      'RUN groupadd --system --gid 1001 appuser \\\n    && useradd --system --uid 1001 --gid appuser appuser\nUSER appuser\n';
  }

  return [
    make(
      'missing-user-instruction',
      { line: anchorLine, column: 1, endLine: anchorLine, endColumn: 1 },
      {
        detail:
          'Switch to an unprivileged user after the last step that needs elevated permissions. Make sure any paths the process writes to are owned by it.',
        replacement: block,
        fixKind: FIX_INSERT,
      }
    ),
  ];
}

const SECRET_KEY_RE =
  /(API[_-]?KEY|SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL|AUTH)/i;

function keyValues(value: string): Array<[string, string]> {
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (!trimmed.includes('=')) {
    const spaceIndex = trimmed.search(/\s/);
    if (spaceIndex === -1) return [[trimmed, '']];
    return [[trimmed.slice(0, spaceIndex), trimmed.slice(spaceIndex + 1).trim()]];
  }

  const pairs: Array<[string, string]> = [];
  const re = /(\S+?)=("[^"]*"|'[^']*'|\S*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null) {
    pairs.push([match[1] ?? '', (match[2] ?? '').replace(/^['"]|['"]$/g, '')]);
  }
  return pairs;
}

function ruleHardcodedSecret(ctx: Context): Finding[] {
  const findings: Finding[] = [];

  for (const instruction of lex.of(ctx.parsed, 'ENV', 'ARG')) {
    for (const [key, value] of keyValues(instruction.value)) {
      if (!SECRET_KEY_RE.test(key)) continue;
      if (!value || value.startsWith('$')) continue;
      if (value.length < 6) continue;

      findings.push(
        make('hardcoded-secret', lex.columnOf(instruction, key), {
          message: `${key} appears to have a credential written directly into the Dockerfile.`,
          detail:
            'Values in ENV and ARG are readable via docker history by anyone who can pull the image, and removing the line later does not remove it from earlier layers. Treat this value as leaked and rotate it. Pass secrets at runtime, or use a BuildKit secret mount at build time.',
        })
      );
    }
  }

  return findings;
}

function ruleMissingHealthcheck(ctx: Context): Finding[] {
  if (lex.has(ctx.parsed, 'HEALTHCHECK') || ctx.parsed.stageCount === 0) return [];

  const starters = lex.of(ctx.parsed, 'CMD', 'ENTRYPOINT');
  const anchor = starters[0];
  if (!anchor) return [];

  const exposed = lex.of(ctx.parsed, 'EXPOSE')[0];
  let port = '8080';
  let note = ' Port 8080 is a guess - set it to the port your app listens on.';
  const firstExposed = exposed?.value.split('/')[0]?.split(/\s+/)[0];
  if (firstExposed && /^\d+$/.test(firstExposed)) {
    port = firstExposed;
    note = '';
  }

  return [
    make(
      'missing-healthcheck',
      { line: anchor.line, column: 1, endLine: anchor.line, endColumn: 1 },
      {
        detail: `Point this at an endpoint that fails when the app is genuinely unhealthy; a check that only proves the process exists is little better than none.${note}`,
        replacement:
          'HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\\n' +
          `    CMD wget -qO- http://127.0.0.1:${port}/health || exit 1\n`,
        fixKind: FIX_INSERT,
      }
    ),
  ];
}

const RULES: Array<(ctx: Context) => Finding[]> = [
  ruleBaseImageSize,
  ruleUbuntuBase,
  ruleUnpinnedBase,
  ruleFloatingTag,
  ruleSingleStage,
  ruleNpm,
  ruleYarn,
  ruleApt,
  rulePip,
  ruleApk,
  ruleCurlPipeShell,
  ruleSudo,
  ruleConsecutiveRuns,
  ruleCopyEntireContext,
  ruleMissingDockerignore,
  ruleCopyBeforeInstall,
  ruleAddInsteadOfCopy,
  ruleMissingUser,
  ruleHardcodedSecret,
  ruleMissingHealthcheck,
];

function buildContext(content: string, options: AnalyzeOptions): Context {
  const parsed = lex.parse(content);
  const aliases = lex.stageNames(parsed);

  const images = new Map<number, ImageRef>();
  for (const instruction of lex.of(parsed, 'FROM')) {
    const ref = lex.parseFrom(instruction, aliases);
    if (ref) images.set(instruction.stageIndex, ref);
  }

  const hasDockerignore =
    options.dockerignore !== undefined && options.dockerignore !== null
      ? true
      : options.hasDockerignore;

  return {
    content,
    parsed,
    hasDockerignore,
    bloatCandidates: options.bloatCandidates ?? [],
    images,
    finalStage: lex.finalStageIndex(parsed),
    multiStage: parsed.stageCount > 1,
  };
}

export function analyze(content: string, options: AnalyzeOptions = {}): Finding[] {
  const ctx = buildContext(content, options);

  const findings: Finding[] = [];
  for (const rule of RULES) {
    try {
      findings.push(...rule(ctx));
    } catch (error) {
      console.error(`[imageshrink] rule ${rule.name} failed`, error);
    }
  }

  findings.sort(
    (a, b) =>
      cat.SEVERITY_ORDER[a.severity] - cat.SEVERITY_ORDER[b.severity] ||
      a.line - b.line ||
      a.column - b.column
  );
  return findings;
}

export function score(findings: Finding[]): cat.Scores {
  const weights: Record<Severity, number> = {
    critical: 34,
    high: 16,
    medium: 8,
    low: 3,
    info: 1,
  };
  const buckets: Array<[keyof cat.Scores, string[]]> = [
    ['optimizationScore', ['size', 'maintainability']],
    ['securityScore', ['security']],
    ['performanceScore', ['performance']],
  ];

  const scores: Record<string, number> = {};
  for (const [label, categories] of buckets) {
    let penalty = 0;
    let seen = 0;
    for (const finding of findings.filter((f) => categories.includes(f.category))) {
      seen += 1;
      penalty += weights[finding.severity] / seen;
    }
    scores[label] = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  }

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<Severity, number>;
  for (const finding of findings) bySeverity[finding.severity] += 1;

  return {
    optimizationScore: scores.optimizationScore ?? 100,
    securityScore: scores.securityScore ?? 100,
    performanceScore: scores.performanceScore ?? 100,
    findingCount: findings.length,
    bySeverity,
    estimatedSavingsMb: findings.reduce((total, f) => total + f.savingsMb, 0),
  };
}
