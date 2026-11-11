import { copyFileSync, mkdirSync } from 'node:fs';
import * as esbuild from 'esbuild';
import { buildOptions } from './scripts/build-options.mjs';
import { writeSkill } from './scripts/skill-files.mjs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
// The desktop app (desktop/, built to desktop/dist/ for Tauri) instead of the extension and the command line.
const desktop = process.argv.includes('--desktop');
// The embeddable viewer (embed/, built to embed/dist/ for its npm package) instead of the extension and the command line.
const embed = process.argv.includes('--embed');

const contexts = await Promise.all(buildOptions({ production, desktop, embed }).map((options) => esbuild.context(options)));

if (embed) {
  // Nothing more: scripts/npm-embed-package.mjs makes the package of embed/dist/.
} else if (desktop) {
  mkdirSync('desktop/dist', { recursive: true });
  copyFileSync('desktop/index.html', 'desktop/dist/index.html');
} else {
  // The Agent Skill for AI assistants, registered for Copilot (`chatSkills` in package.json) and installed by the
  // extension's command. Not rebuilt on changes while watching: it is made of documents that seldom change.
  writeSkill('dist/skill');
}

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
