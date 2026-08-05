

import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
const repoRoot = resolve(extensionRoot, '..');

const sharedDir = join(repoRoot, 'shared');
const outDir = join(extensionRoot, 'src', 'generated');

const FILES = ['rule-catalog.json', 'base-images.json'];

if (!existsSync(sharedDir)) {
  console.error(
    `[sync-shared] Could not find ${sharedDir}.\n` +
      'The extension is built from inside the ImageShrink-AI repository, which provides the ' +
      'shared rule catalog. Building it standalone is not supported.'
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
  const from = join(sharedDir, file);
  if (!existsSync(from)) {
    console.error(`[sync-shared] Missing required file: ${from}`);
    process.exit(1);
  }
  copyFileSync(from, join(outDir, file));
  console.log(`[sync-shared] ${file}`);
}
