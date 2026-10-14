/**
 * Builds the site of GitHub Pages in .work/site (after `pnpm build`, which makes dist/cli.js):
 *
 *   pnpm pages
 *
 * - `/` and `/ja/`: the landing page in English and in Japanese (site/), with the images it uses from images/.
 * - `/sample/` and `/ja/sample/`: examples/screenshot.md and screenshot.ja.md exported to HTML by the command line, with
 *   `--strict` so that a link warning fails the build. Chrome is looked up the same way as the command line does.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.work/site');
const EXPORT = join(ROOT, '.work/pages');

/** The images of images/ used by the landing page: the icon and the screenshots (not preview.svg, the extension's). */
const IMAGES = readdirSync(join(ROOT, 'images')).filter((file) => /^(icon\.(png|svg)|screenshot.*\.png)$/.test(file));

/** The samples: the document, the options of the export, and where its HTML goes in the site. */
const SAMPLES = [
  { file: 'examples/screenshot.md', args: [], to: 'sample/index.html' },
  { file: 'examples/screenshot.ja.md', args: ['--lang', 'ja'], to: 'ja/sample/index.html' },
];

rmSync(OUT, { recursive: true, force: true });
rmSync(EXPORT, { recursive: true, force: true });

cpSync(join(ROOT, 'site'), OUT, { recursive: true });
mkdirSync(join(OUT, 'images'));
for (const file of IMAGES) {
  cpSync(join(ROOT, 'images', file), join(OUT, 'images', file));
}

for (const { file, args, to } of SAMPLES) {
  execFileSync(
    process.execPath,
    [join(ROOT, 'dist/cli.js'), 'export', file, '--root', 'examples', '-o', EXPORT, '--strict', ...args],
    { cwd: ROOT, stdio: 'inherit' },
  );
  const html = join(EXPORT, file.replace(/^examples\//, '').replace(/\.md$/, '.html'));
  mkdirSync(dirname(join(OUT, to)), { recursive: true });
  renameSync(html, join(OUT, to));
}

console.log(`Wrote the site to ${OUT}`);
