
import * as vscode from 'vscode';

import { log } from '../logger';

const BLOAT_CANDIDATES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'vendor',
  '.terraform',
  '.pytest_cache',
  '.mypy_cache',
  '.gradle',
  '.idea',
  '.vscode',
  '.env',
  '.DS_Store',
];

const MANIFESTS = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'Cargo.toml',
];

const MAX_FILE_BYTES = 200_000;

export interface WorkspaceContext {

  contextDir: vscode.Uri | undefined;
  hasDockerignore: boolean | undefined;
  dockerignore: string | undefined;
  packageJson: string | undefined;
  bloatCandidates: string[];
}

async function readTextFile(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return new TextDecoder().decode(bytes.slice(0, MAX_FILE_BYTES));
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function alreadyIgnored(name: string, dockerignore: string | undefined): boolean {
  if (!dockerignore) return false;

  return dockerignore
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .some((pattern) => {
      const cleaned = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
      if (cleaned === name) return true;
      if (cleaned === `**/${name}` || cleaned === `${name}/**`) return true;
      if (cleaned.startsWith('*.') && name.endsWith(cleaned.slice(1))) return true;
      return false;
    });
}


export async function gather(dockerfileUri: vscode.Uri): Promise<WorkspaceContext> {
  const empty: WorkspaceContext = {
    contextDir: undefined,
    hasDockerignore: undefined,
    dockerignore: undefined,
    packageJson: undefined,
    bloatCandidates: [],
  };
  if (dockerfileUri.scheme !== 'file') return empty;

  const contextDir = vscode.Uri.joinPath(dockerfileUri, '..');

  try {
    const dockerignoreUri = vscode.Uri.joinPath(contextDir, '.dockerignore');
    const dockerignore = await readTextFile(dockerignoreUri);
    const hasDockerignore = dockerignore !== undefined || (await exists(dockerignoreUri));

    let packageJson: string | undefined;
    for (const manifest of MANIFESTS) {
      const content = await readTextFile(vscode.Uri.joinPath(contextDir, manifest));
      if (content !== undefined) {
        packageJson = content;
        break;
      }
    }

    const present = await Promise.all(
      BLOAT_CANDIDATES.map(async (name) =>
        (await exists(vscode.Uri.joinPath(contextDir, name))) ? name : undefined
      )
    );
    const bloatCandidates = present
      .filter((name): name is string => name !== undefined)
      // Already excluded is not a problem worth reporting.
      .filter((name) => !alreadyIgnored(name, dockerignore));

    return { contextDir, hasDockerignore, dockerignore, packageJson, bloatCandidates };
  } catch (error) {
    log.debug(`could not gather workspace context: ${(error as Error).message}`);
    return { ...empty, contextDir };
  }
}

export async function writeDockerignore(
  dockerfileUri: vscode.Uri,
  content: string
): Promise<vscode.Uri | undefined> {
  if (dockerfileUri.scheme !== 'file') {
    void vscode.window.showWarningMessage(
      'ImageShrink: save this Dockerfile to a folder first, so the .dockerignore has somewhere to go.'
    );
    return undefined;
  }

  const target = vscode.Uri.joinPath(dockerfileUri, '..', '.dockerignore');

  if (await exists(target)) {
    const choice = await vscode.window.showWarningMessage(
      'A .dockerignore already exists in this folder.',
      'Open It',
      'Cancel'
    );
    if (choice === 'Open It') {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
    }
    return undefined;
  }

  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
  log.info(`created ${target.fsPath}`);
  return target;
}
