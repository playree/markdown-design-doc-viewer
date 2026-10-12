/**
 * Prepares the npm package of the command line (`md-design-doc`) in .work/npm, to be packed or published from there:
 *
 *   pnpm npm:package && npm publish .work/npm
 *
 * The package.json of the repository is the extension's: its texts are placeholders (`%description%`) translated by
 * package.nls.json, and most of it only matters to VS Code. The package gets its own package.json, with the
 * placeholders replaced by the English texts and only the fields npm uses.
 *
 * Expects a production build in dist/ (`node esbuild.mjs --production`).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.work/npm');

/** The files of the package besides package.json, relative to the repository root. */
const FILES = [
  'dist/cli.js',
  'dist/webview.js',
  'dist/webview.css',
  'dist/export.js',
  'dist/export.css',
  'l10n',
  'README.md',
  'README.ja.md',
  'LICENSE',
  'ThirdPartyNotices.txt',
];

/** The files of dist/ the command line does not use: the extension, and the screenshot script (`pnpm screenshots`). */
const DIST_EXCLUDED = ['extension.js', 'screenshots.cjs'];

/** The fields of package.json that npm uses for the command line. The others are the extension's. */
const FIELDS = ['name', 'version', 'description', 'license', 'repository', 'bugs', 'homepage', 'keywords', 'bin', 'engines', 'dependencies'];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const nls = JSON.parse(readFileSync(join(ROOT, 'package.nls.json'), 'utf8'));

/** Replaces the `%key%` placeholders of the strings in `value` by their English texts in package.nls.json. */
function localize(value, path) {
  if (typeof value === 'string') {
    const key = /^%(.+)%$/.exec(value)?.[1];
    if (key === undefined) {
      return value;
    }
    if (typeof nls[key] !== 'string') {
      throw new Error(`${path}: no "${key}" in package.nls.json`);
    }
    return nls[key];
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => localize(item, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(item, `${path}.${key}`)]));
  }
  return value;
}

const manifest = {};
for (const field of FIELDS) {
  if (pkg[field] !== undefined) {
    manifest[field] = localize(pkg[field], field);
  }
}
// Only Node matters to the command line.
if (!pkg.engines?.node) {
  throw new Error('No engines.node in package.json: the command line needs it.');
}
manifest.engines = { node: pkg.engines.node };
// The form npm normalizes it to, so that publishing does not warn about it.
if (manifest.repository?.url?.startsWith('https://')) {
  manifest.repository = { ...manifest.repository, url: `git+${manifest.repository.url}` };
}

const missing = FILES.filter((file) => !existsSync(join(ROOT, file)));
if (missing.length > 0) {
  throw new Error(`Missing ${missing.join(', ')}: build first with \`node esbuild.mjs --production\`.`);
}
// A new file of the build (esbuild.mjs) is to be added to FILES, or to these if the command line does not use it.
const unlisted = readdirSync(join(ROOT, 'dist')).filter((name) => !FILES.includes(`dist/${name}`) && !DIST_EXCLUDED.includes(name) && !name.endsWith('.map'));
if (unlisted.length > 0) {
  throw new Error(`dist/${unlisted.join(', dist/')}: add to FILES in scripts/npm-package.mjs, or to DIST_EXCLUDED if the command line does not need it.`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const file of FILES) {
  cpSync(join(ROOT, file), join(OUT, file), { recursive: true });
}
writeFileSync(join(OUT, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`npm package ${manifest.name}@${manifest.version} prepared in ${OUT}`);
