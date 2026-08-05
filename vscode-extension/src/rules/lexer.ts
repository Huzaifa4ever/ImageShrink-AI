export interface Span {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface Instruction {
  keyword: string;
  value: string;
  line: number;
  endLine: number;
  raw: string;
  stageIndex: number;
}

export interface ParsedDockerfile {
  instructions: Instruction[];
  directives: Record<string, string>;
  stageCount: number;
}

const KEYWORDS = new Set([
  'FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT',
  'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL',
  'MAINTAINER',
]);

const DIRECTIVE_RE = /^#\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(.+?)\s*$/;
const KEYWORD_RE = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(.*)$/;

export function parse(content: string): ParsedDockerfile {
  const result: ParsedDockerfile = { instructions: [], directives: {}, stageCount: 0 };
  const lines = content.split('\n');

  let stageIndex = -1;
  let seenInstruction = false;
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i] ?? '';
    const stripped = rawLine.trim();

    if (!stripped) {
      i += 1;
      continue;
    }

    if (stripped.startsWith('#')) {
      if (!seenInstruction) {
        const match = DIRECTIVE_RE.exec(stripped);
        if (match?.[1] && match[2]) result.directives[match[1].toLowerCase()] = match[2];
      }
      i += 1;
      continue;
    }

    const keywordMatch = KEYWORD_RE.exec(rawLine);
    if (!keywordMatch?.[1]) {
      i += 1;
      continue;
    }

    const keyword = keywordMatch[1].toUpperCase();
    if (!KEYWORDS.has(keyword)) {
      i += 1;
      continue;
    }

    const startLine = i + 1;
    const rawParts: string[] = [rawLine];
    const valueParts: string[] = [(keywordMatch[2] ?? '').trim()];
    let continuing = rawLine.trimEnd().endsWith('\\');

    while (continuing && i + 1 < lines.length) {
      i += 1;
      const next = lines[i] ?? '';
      rawParts.push(next);
      if (next.trim().startsWith('#')) continue;
      valueParts.push(next.trim());
      continuing = next.trimEnd().endsWith('\\');
    }

    const joined = valueParts
      .filter((part) => part.trim())
      .map((part) => (part.trimEnd().endsWith('\\') ? part.slice(0, -1).trim() : part.trim()))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (keyword === 'FROM') {
      stageIndex += 1;
      result.stageCount = stageIndex + 1;
    }

    result.instructions.push({
      keyword,
      value: joined,
      line: startLine,
      endLine: i + 1,
      raw: rawParts.join('\n'),
      stageIndex,
    });
    seenInstruction = true;
    i += 1;
  }

  return result;
}

export function of(parsed: ParsedDockerfile, ...keywords: string[]): Instruction[] {
  const wanted = new Set(keywords.map((k) => k.toUpperCase()));
  return parsed.instructions.filter((instruction) => wanted.has(instruction.keyword));
}

export function inStage(parsed: ParsedDockerfile, stageIndex: number): Instruction[] {
  return parsed.instructions.filter((instruction) => instruction.stageIndex === stageIndex);
}

export function finalStageIndex(parsed: ParsedDockerfile): number {
  return parsed.stageCount ? parsed.stageCount - 1 : -1;
}

export function has(parsed: ParsedDockerfile, keyword: string): boolean {
  return parsed.instructions.some((i) => i.keyword === keyword.toUpperCase());
}

export function isMultiline(instruction: Instruction): boolean {
  return instruction.endLine > instruction.line;
}

export function fullSpan(instruction: Instruction): Span {
  const lines = instruction.raw.split('\n');
  const last = lines[lines.length - 1] ?? '';
  return {
    line: instruction.line,
    column: 1,
    endLine: instruction.endLine,
    endColumn: last.length + 1,
  };
}

export function columnOf(instruction: Instruction, needle: string): Span {
  const lines = instruction.raw.split('\n');
  for (let offset = 0; offset < lines.length; offset += 1) {
    const found = (lines[offset] ?? '').indexOf(needle);
    if (found !== -1) {
      return {
        line: instruction.line + offset,
        column: found + 1,
        endLine: instruction.line + offset,
        endColumn: found + 1 + needle.length,
      };
    }
  }
  return fullSpan(instruction);
}

export interface ImageRef {
  raw: string;
  registry: string | null;
  path: string;
  tag: string | null;
  digest: string | null;
  alias: string | null;
  isStageReference: boolean;
}

export function imageName(ref: ImageRef): string {
  const parts = ref.path.split('/');
  return parts[parts.length - 1] ?? ref.path;
}

export function isScratch(ref: ImageRef): boolean {
  return ref.path === 'scratch';
}

export function isDistroless(ref: ImageRef): boolean {
  return ref.path.includes('distroless');
}

export function isSlimVariant(ref: ImageRef): boolean {
  const tag = (ref.tag ?? '').toLowerCase();
  return tag.includes('slim') || tag.includes('alpine') || ref.path.endsWith('alpine');
}

export function stageNames(parsed: ParsedDockerfile): Set<string> {
  const names = new Set<string>();
  for (const instruction of of(parsed, 'FROM')) {
    const tokens = instruction.value.split(/\s+/).filter((t) => t && !t.startsWith('--'));
    if (tokens.length >= 3 && tokens[1]?.toUpperCase() === 'AS' && tokens[2]) {
      names.add(tokens[2]);
    }
  }
  return names;
}

export function parseFrom(instruction: Instruction, knownStageNames: Set<string>): ImageRef | null {
  if (instruction.keyword !== 'FROM') return null;

  const tokens = instruction.value.split(/\s+/).filter((t) => t && !t.startsWith('--'));
  const reference = tokens[0];
  if (!reference) return null;

  let alias: string | null = null;
  if (tokens.length >= 3 && tokens[1]?.toUpperCase() === 'AS' && tokens[2]) {
    alias = tokens[2];
  }

  if (knownStageNames.has(reference)) {
    return {
      raw: reference,
      registry: null,
      path: reference,
      tag: null,
      digest: null,
      alias,
      isStageReference: true,
    };
  }

  let remainder = reference;
  let digest: string | null = null;
  const atIndex = reference.indexOf('@');
  if (atIndex !== -1) {
    remainder = reference.slice(0, atIndex);
    digest = reference.slice(atIndex + 1);
  }

  let registry: string | null = null;
  let path = remainder;
  if (remainder.includes('/')) {
    const head = remainder.slice(0, remainder.indexOf('/'));
    if (head.includes('.') || head.includes(':') || head === 'localhost') {
      registry = head;
      path = remainder.slice(remainder.indexOf('/') + 1);
    }
  }

  let tag: string | null = null;
  const colonIndex = path.lastIndexOf(':');
  if (colonIndex !== -1) {
    tag = path.slice(colonIndex + 1);
    path = path.slice(0, colonIndex);
  }

  return { raw: reference, registry, path, tag, digest, alias, isStageReference: false };
}
