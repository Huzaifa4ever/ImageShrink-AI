import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { config } from '../config';
import { log } from '../logger';
import * as cat from '../rules/catalog';
import type { Finding } from '../rules/catalog';
import * as lex from '../rules/lexer';
import type { ImageRef } from '../rules/lexer';
import type { SizeConfidence, SizeEstimate } from './types';

const run = promisify(execFile);

const ADD_ESTIMATES = {
  npmWithDev: 180,
  npmProdOnly: 60,
  pipInstall: 60,
  pipCache: 40,
  aptPerPackage: 12,
  aptLists: 40,
  apkPerPackage: 3,
  copyContext: 25,
  copyNarrow: 3,
  compile: 15,
};

let knownSizes: Map<string, number> | undefined;

function sizeIndex(): Map<string, number> {
  if (knownSizes) return knownSizes;

  knownSizes = new Map();
  for (const family of Object.values(cat.families())) {
    for (const rec of family.recommendations) {
      knownSizes.set(rec.image.toLowerCase(), rec.sizeMb);
    }
  }
  return knownSizes;
}

function familyFor(ref: ImageRef): cat.ImageFamily | undefined {
  if (ref.path.includes('dotnet')) return cat.family('dotnet');

  const aliases: Record<string, string> = {
    node: 'node', nodejs: 'node', python: 'python', python3: 'python',
    ubuntu: 'ubuntu', debian: 'debian', golang: 'golang', go: 'golang',
    openjdk: 'openjdk', 'eclipse-temurin': 'openjdk', temurin: 'openjdk',
    nginx: 'nginx', ruby: 'ruby', php: 'php',
  };
  const key = aliases[lex.imageName(ref).toLowerCase()];
  return key ? cat.family(key) : undefined;
}

async function measureLocally(image: string): Promise<number | null> {
  if (!config.useDockerForSizes()) return null;

  try {
    const { stdout } = await run('docker', ['image', 'inspect', image, '--format', '{{.Size}}'], {
      timeout: 5_000,
    });
    const bytes = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    return Math.round(bytes / (1024 * 1024));
  } catch {
    return null;
  }
}

function baseSize(ref: ImageRef | null): { mb: number | null; confidence: SizeConfidence } {
  if (!ref || ref.isStageReference) return { mb: null, confidence: 'unknown' };
  if (lex.isScratch(ref)) return { mb: 0, confidence: 'known' };

  const exact = sizeIndex().get(ref.raw.toLowerCase());
  if (exact !== undefined) return { mb: exact, confidence: 'known' };

  const family = familyFor(ref);
  if (family) {
    if (lex.isSlimVariant(ref)) {
      const slim = family.recommendations.find(
        (r) => r.image.includes('alpine') || r.image.includes('slim')
      );
      if (slim) return { mb: slim.sizeMb, confidence: 'estimated' };
    }
    return { mb: family.defaultSizeMb, confidence: 'estimated' };
  }

  if (lex.isDistroless(ref)) return { mb: 25, confidence: 'estimated' };
  return { mb: null, confidence: 'unknown' };
}

function countPackages(segment: string, after: RegExp): number {
  const match = after.exec(segment);
  if (!match) return 0;
  const rest = segment.slice(match.index + match[0].length).trim();
  const packages = rest.split(/\s+/).filter((t) => t && !t.startsWith('-'));
  return Math.max(packages.length, 1);
}

function estimateAdded(content: string, finalStage: number): { mb: number; notes: string[] } {
  const parsed = lex.parse(content);
  const notes: string[] = [];
  let total = 0;

  const inFinal = (stage: number): boolean => parsed.stageCount <= 1 || stage === finalStage;

  for (const instruction of lex.of(parsed, 'RUN')) {
    if (!inFinal(instruction.stageIndex)) continue;
    const value = instruction.value;

    if (/npm\s+(ci|install|i)\b/i.test(value) && !/-g\b|--global/.test(value)) {
      const omits = /--omit=dev|--production|--only=prod/i.test(value);
      total += omits ? ADD_ESTIMATES.npmProdOnly : ADD_ESTIMATES.npmWithDev;
      notes.push(omits ? 'npm production dependencies' : 'npm dependencies including devDependencies');
    } else if (/yarn(\s+install)?\b/i.test(value)) {
      total += ADD_ESTIMATES.npmWithDev;
      notes.push('yarn dependencies');
    }

    if (/pip3?\s+install/i.test(value)) {
      total += ADD_ESTIMATES.pipInstall;
      if (!value.includes('--no-cache-dir')) total += ADD_ESTIMATES.pipCache;
      notes.push('Python packages');
    }

    if (/apt(-get)?\s+install/i.test(value)) {
      const count = countPackages(value, /apt(?:-get)?\s+install(\s+-\S+)*/i);
      total += count * ADD_ESTIMATES.aptPerPackage;
      if (!value.includes('/var/lib/apt/lists')) {
        total += ADD_ESTIMATES.aptLists;
        notes.push('apt package lists left in the layer');
      }
      notes.push(`${count} apt package(s)`);
    }

    if (/apk\s+add/i.test(value)) {
      const count = countPackages(value, /apk\s+add(\s+-\S+)*/i);
      total += count * ADD_ESTIMATES.apkPerPackage;
      notes.push(`${count} apk package(s)`);
    }

    if (/go\s+build|cargo\s+build|mvn\b|gradle\b|npm\s+run\s+build/i.test(value)) {
      total += ADD_ESTIMATES.compile;
    }
  }

  for (const instruction of lex.of(parsed, 'COPY', 'ADD')) {
    if (!inFinal(instruction.stageIndex)) continue;
    if (instruction.value.includes('--from=')) continue;

    const tokens = instruction.value.split(/\s+/).filter((t) => t && !t.startsWith('--'));
    if (tokens[0] === '.' || tokens[0] === './') {
      total += ADD_ESTIMATES.copyContext;
      notes.push('whole build context copied in');
    } else {
      total += ADD_ESTIMATES.copyNarrow;
    }
  }

  return { mb: total, notes };
}

export async function estimate(content: string, findings: Finding[]): Promise<SizeEstimate> {
  const parsed = lex.parse(content);
  const aliases = lex.stageNames(parsed);
  const finalStage = lex.finalStageIndex(parsed);

  const fromInstructions = lex.of(parsed, 'FROM');
  const finalFrom = fromInstructions[fromInstructions.length - 1];
  const ref = finalFrom ? lex.parseFrom(finalFrom, aliases) : null;

  let { mb: baseMb, confidence: baseConfidence } = baseSize(ref);

  if (ref && !ref.isStageReference && !lex.isScratch(ref)) {
    const measured = await measureLocally(ref.raw);
    if (measured !== null) {
      baseMb = measured;
      baseConfidence = 'measured';
      log.debug(`size: measured ${ref.raw} at ${measured} MB via docker`);
    }
  }

  const { mb: addedMb, notes } = estimateAdded(content, finalStage);
  const totalMb = baseMb === null ? null : baseMb + addedMb;

  const savedMb = findings.reduce((sum, f) => sum + f.savingsMb, 0);

  let optimizedMb: number | null = null;
  if (totalMb !== null) {
    const family = ref ? familyFor(ref) : undefined;
    const best = family ? cat.bestRecommendation(family) : undefined;
    const floor = (best?.sizeMb ?? 20) + 10;
    optimizedMb = Math.max(floor, totalMb - savedMb);
    if (optimizedMb > totalMb) optimizedMb = totalMb;
  }

  const savingsPercent =
    totalMb && optimizedMb !== null && totalMb > 0
      ? Math.round((1 - optimizedMb / totalMb) * 1000) / 10
      : 0;

  const confidence: SizeConfidence =
    baseConfidence === 'unknown' ? 'unknown' : baseConfidence === 'measured' ? 'estimated' : baseConfidence;

  return {
    baseImage: ref?.raw ?? null,
    baseMb,
    baseConfidence,
    addedMb,
    totalMb,
    optimizedMb,
    savedMb: totalMb !== null && optimizedMb !== null ? totalMb - optimizedMb : 0,
    savingsPercent,
    confidence,
    notes: [...new Set(notes)],
  };
}
