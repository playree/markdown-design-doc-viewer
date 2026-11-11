/**
 * Prepares the npm package of the embeddable viewer (embed/: `createViewer`, and `DesignDocViewer` for React) in
 * .work/npm-embed, to be packed or published from there:
 *
 *   pnpm npm:embed-package && npm publish .work/npm-embed
 *
 * The package has the ES modules of embed/dist/ (`node esbuild.mjs --embed --production`), with the libraries they use
 * bundled but mermaid and React, which the app has (peerDependencies), its styles in one file, and the types of its
 * modules (emitted here by tsc). Its README is docs/embed.md. Its version is the extension's (package.json).
 *
 * At the end, the modules of the package are imported in Node, as an app rendered on a server would: they must not use
 * the document before a viewer is created.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.work/npm-embed');
const TYPES_TEMP = join(ROOT, '.work/embed-types');

const NAME = 'markdown-design-doc-viewer-embed';
const DESCRIPTION =
  'The viewer of Markdown Design Doc Viewer to embed in a web app (React or not): design documents in Markdown with their mermaid sequence diagrams, flowcharts, ER and state diagrams and wireframes linked to the steps after them.';
/** The page of the package, instead of the repository's README (the extension's). */
const HOMEPAGE = 'https://github.com/playree/markdown-design-doc-viewer/blob/main/docs/embed.md';
const KEYWORDS = ['markdown', 'mermaid', 'design document', 'viewer', 'react', 'sequence diagram', 'flowchart', 'specification', 'documentation', '設計書'];

/** The modules of the package (from embed/dist/), with their sources, whose types are emitted next to them. */
const MODULES = [
  { file: 'index.js', source: 'embed/viewer.ts', exportPath: '.' },
  { file: 'react.js', source: 'embed/react.tsx', exportPath: './react' },
];
const STYLES = 'viewer.css';

/** The other files of the package: [path in the package, path in the repository]. */
const FILES = [
  ['README.md', 'docs/embed.md'],
  ['README.ja.md', 'docs/embed.ja.md'],
  ['LICENSE', 'LICENSE'],
  ['ThirdPartyNotices.txt', 'ThirdPartyNotices.txt'],
];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
/** The range of a package the viewer is built and tested with, which the app is to have (a peer dependency). */
const devVersion = (name) => {
  const range = pkg.devDependencies?.[name];
  if (!/^\^\d+\.\d+\.\d+$/.test(range ?? '')) {
    throw new Error(`The devDependencies of package.json have no range ^x.y.z for ${name}: ${range}.`);
  }
  return range;
};

const dist = join(ROOT, 'embed/dist');
const built = [...MODULES.map((module) => module.file), STYLES];
const missing = [...built.map((file) => `embed/dist/${file}`), ...FILES.map(([, from]) => from)].filter((file) => !existsSync(join(ROOT, file)));
if (missing.length > 0) {
  throw new Error(`Missing ${missing.join(', ')}: build first with \`node esbuild.mjs --embed --production\`.`);
}
// A new file of the build (embedOptions in scripts/build-options.mjs) is to be added to the package.
const unlisted = readdirSync(dist).filter((name) => !built.includes(name));
if (unlisted.length > 0) {
  throw new Error(`embed/dist/${unlisted.join(', embed/dist/')}: add to the package in scripts/npm-embed-package.mjs.`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const file of built) {
  cpSync(join(dist, file), join(OUT, file));
}
for (const [to, from] of FILES) {
  cpSync(join(ROOT, from), join(OUT, to));
}

// The types: emitted by tsc with the options of the repository (and its declarations of untyped packages), then only
// the files the types of the modules use, with their relative imports ending in .js as Node's ES modules need them.
rmSync(TYPES_TEMP, { recursive: true, force: true });
mkdirSync(TYPES_TEMP, { recursive: true });
const tsconfig = join(TYPES_TEMP, 'tsconfig.json');
writeFileSync(
  tsconfig,
  JSON.stringify({
    extends: join(ROOT, 'tsconfig.json'),
    compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, rootDir: ROOT, outDir: join(TYPES_TEMP, 'out') },
    files: [...MODULES.map((module) => join(ROOT, module.source)), join(ROOT, 'src/markdown/markdown-it-footnote.d.ts')],
    include: [],
  }),
);
// Its script run by Node, not the shim of node_modules/.bin (a shell script, which Windows does not run).
execFileSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', tsconfig], { cwd: ROOT, stdio: 'inherit' });

const typesOf = (source) => source.replace(/\.tsx?$/, '.d.ts');
const copied = new Set();
/** Copies the declaration file `path` (relative to the root) and those it imports into types/. */
function copyTypes(path) {
  if (copied.has(path)) {
    return;
  }
  copied.add(path);
  const from = join(TYPES_TEMP, 'out', path);
  if (!existsSync(from)) {
    throw new Error(`${path}: not emitted by tsc.`);
  }
  const text = readFileSync(from, 'utf8').replace(/((?:from|import)\s*\(?\s*)(['"])(\.\.?\/[^'"]+)\2/g, (match, before, quote, specifier) => {
    const target = ['.d.ts', '/index.d.ts'].map((ending) => join(dirname(path), specifier + ending)).find((file) => existsSync(join(TYPES_TEMP, 'out', file)));
    if (target === undefined) {
      throw new Error(`${path}: the types of ${specifier} were not emitted.`);
    }
    copyTypes(target);
    const relativePath = relative(dirname(path), target).replace(/\\/g, '/').replace(/\.d\.ts$/, '.js');
    return `${before}${quote}${relativePath.startsWith('.') ? relativePath : `./${relativePath}`}${quote}`;
  });
  mkdirSync(dirname(join(OUT, 'types', path)), { recursive: true });
  writeFileSync(join(OUT, 'types', path), text);
}
for (const module of MODULES) {
  copyTypes(typesOf(module.source));
}
rmSync(TYPES_TEMP, { recursive: true, force: true });

const manifest = {
  name: NAME,
  version: pkg.version,
  description: DESCRIPTION,
  license: pkg.license,
  repository: { ...pkg.repository, url: pkg.repository.url.startsWith('https://') ? `git+${pkg.repository.url}` : pkg.repository.url },
  bugs: pkg.bugs,
  homepage: HOMEPAGE,
  keywords: KEYWORDS,
  type: 'module',
  // Importing the styles is what they are for. The modules only define functions and a component.
  sideEffects: [`./${STYLES}`],
  exports: {
    ...Object.fromEntries(MODULES.map((module) => [module.exportPath, { types: `./types/${typesOf(module.source)}`, default: `./${module.file}` }])),
    [`./${STYLES}`]: `./${STYLES}`,
    './package.json': './package.json',
  },
  // The app's: mermaid is bundled in it anyway (and its configuration is global), and React only for react.js.
  peerDependencies: { mermaid: devVersion('mermaid'), react: devVersion('react'), 'react-dom': devVersion('react-dom') },
  peerDependenciesMeta: { react: { optional: true }, 'react-dom': { optional: true } },
};
writeFileSync(join(OUT, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// As on a server: without a document (mermaid and React come from the node_modules of the repository).
for (const module of MODULES) {
  await import(pathToFileURL(join(OUT, module.file)).href);
}
console.log(`npm package ${manifest.name}@${manifest.version} prepared in ${OUT}`);
