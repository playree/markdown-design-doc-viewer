import { copyFileSync, mkdirSync } from 'node:fs';
import * as esbuild from 'esbuild';
import { buildOptions } from './scripts/build-options.mjs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
// The desktop app (desktop/, built to desktop/dist/ for Tauri) instead of the extension and the command line.
const desktop = process.argv.includes('--desktop');

const contexts = await Promise.all(buildOptions({ production, desktop }).map((options) => esbuild.context(options)));

if (desktop) {
  mkdirSync('desktop/dist', { recursive: true });
  copyFileSync('desktop/index.html', 'desktop/dist/index.html');
}

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
