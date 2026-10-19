/**
 * Builds the site of GitHub Pages in .work/site (after `pnpm build`, which makes dist/cli.js):
 *
 *   pnpm pages
 *
 * - `/` and `/ja/`: the landing page in English and in Japanese (site/), with the images it uses from images/.
 * - `/sample/` and `/ja/sample/`: examples/screenshot.md and screenshot.ja.md exported to HTML by the command line, with
 *   `--strict` so that a link warning fails the build. Chrome is looked up the same way as the command line does.
 *
 * The `width` and `height` of the landing page's screenshots and animations must be the size of their PNG or GIF (retaken by `pnpm screenshots`), or it fails.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.work/site');
const EXPORT = join(ROOT, '.work/pages');
const CLI = join(ROOT, 'dist/cli.js');

/** The images of images/ used by the landing page: the icon, the screenshots and the animation (not preview.svg, the extension's). */
const IMAGES = readdirSync(join(ROOT, 'images')).filter((file) => /^(icon\.(png|svg)|screenshot.*\.png|demo.*\.gif)$/.test(file));

/** The pages of the landing page, in site/. */
const PAGES = ['index.html', 'ja/index.html'];

/** The samples: the document, the options of the export, and where its HTML goes in the site. */
const SAMPLES = [
  { file: 'examples/screenshot.md', args: [], to: 'sample/index.html' },
  { file: 'examples/screenshot.ja.md', args: ['--lang', 'ja'], to: 'ja/sample/index.html' },
];

if (!existsSync(CLI)) {
  console.error('dist/cli.js is not found: run pnpm build first.');
  process.exit(1);
}

/** The width and height of a PNG file (from its IHDR chunk) or a GIF file (from its logical screen descriptor). */
function imageSize(file) {
  const data = readFileSync(file);
  return file.endsWith('.gif') ? { width: data.readUInt16LE(6), height: data.readUInt16LE(8) } : { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Errors for the screenshots and animations of `page` (in site/) whose `width` and `height` are not the size of their image. */
function checkImageSizes(page) {
  const errors = [];
  const html = readFileSync(join(ROOT, 'site', page), 'utf8');
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    const src = /\bsrc="(?:\.\.\/)*images\/(screenshot[^"]*\.png|demo[^"]*\.gif)"/.exec(tag)?.[1];
    if (!src) continue;
    const { width, height } = imageSize(join(ROOT, 'images', src));
    const attr = (name) => Number(new RegExp(`\\b${name}="(\\d+)"`).exec(tag)?.[1]);
    if (attr('width') !== width || attr('height') !== height) {
      errors.push(`site/${page}: ${src} is ${width}x${height}, but its <img> has width="${attr('width')}" height="${attr('height')}".`);
    }
  }
  return errors;
}

const errors = PAGES.flatMap(checkImageSizes);
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
rmSync(EXPORT, { recursive: true, force: true });

cpSync(join(ROOT, 'site'), OUT, { recursive: true });
mkdirSync(join(OUT, 'images'), { recursive: true });
for (const file of IMAGES) {
  cpSync(join(ROOT, 'images', file), join(OUT, 'images', file));
}

for (const { file, args, to } of SAMPLES) {
  execFileSync(process.execPath, [CLI, 'export', file, '--root', 'examples', '-o', EXPORT, '--strict', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const html = join(EXPORT, file.replace(/^examples\//, '').replace(/\.md$/, '.html'));
  mkdirSync(dirname(join(OUT, to)), { recursive: true });
  renameSync(html, join(OUT, to));
}

console.log(`Wrote the site to ${OUT}`);
