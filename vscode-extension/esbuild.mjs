

import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {# Everything is bundled into dist/extension.js, so no sources ship.
    build.onStart(() => console.log('[build] started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) console.error(`    ${location.file}:${location.line}:${location.column}`);
      }
      console.log(`[build] finished with ${result.errors.length} error(s)`);
    });
  },
};

const context = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  minify: production,
  sourcemap: !production,
  keepNames: true,
  logLevel: 'warning',
  plugins: [problemMatcherPlugin],
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
