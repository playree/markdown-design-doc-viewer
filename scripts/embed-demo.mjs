/**
 * Builds the demo of the embedded viewer (embed/demo/: a React page with two viewers, embed/react.tsx) into
 * .work/embed-demo/, with the examples next to it, which it shows. Not in dist/: it is not shipped.
 *
 *   pnpm embed:demo            # builds it
 *   pnpm embed:demo --serve    # builds it and serves it (http://127.0.0.1:8000/)
 *   pnpm embed:demo --package  # with the npm package of .work/npm-embed (pnpm npm:embed-package) instead of the sources
 *
 * The demo imports the viewer by the name of its npm package, resolved to the sources (embed/) or to the package.
 * It can also put Tailwind's preflight on the page (a checkbox), as in an app that uses Tailwind CSS.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { exportAssets } from './build-options.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.work', 'embed-demo');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyFileSync(join(ROOT, 'embed', 'demo', 'index.html'), join(OUT, 'index.html'));
cpSync(join(ROOT, 'examples'), join(OUT, 'examples'), { recursive: true });

// Tailwind's preflight, in its layer as Tailwind puts it, with the defaults of its theme (`--theme(--name, default)`).
const preflight = readFileSync(join(ROOT, 'node_modules/tailwindcss/preflight.css'), 'utf8').replace(/--theme\(\s*--[\w-]+,\s*([^;]*?)\s*\)\s*;/g, '$1;');
writeFileSync(join(OUT, 'preflight.css'), `@layer base {\n${preflight}\n}\n`);

const PACKAGE = 'markdown-design-doc-viewer-embed';
const usePackage = process.argv.includes('--package');
const packageDir = join(ROOT, '.work', 'npm-embed');
if (usePackage && !existsSync(join(packageDir, 'package.json'))) {
  throw new Error('No package in .work/npm-embed: make it first with `pnpm npm:embed-package`.');
}
/** The modules of the package, in the sources or in the package. */
const modules = usePackage
  ? { '': join(packageDir, 'index.js'), '/react': join(packageDir, 'react.js'), '/export': join(packageDir, 'export.js'), '/viewer.css': join(packageDir, 'viewer.css') }
  : { '': join(ROOT, 'embed', 'viewer.ts'), '/react': join(ROOT, 'embed', 'react.tsx'), '/export': join(ROOT, 'embed', 'export.ts'), '/viewer.css': join(ROOT, 'embed', 'viewer.css') };
const viewerPackage = {
  name: 'viewer-package',
  setup(build) {
    build.onResolve({ filter: new RegExp(`^${PACKAGE}(/.*)?$`) }, (args) => {
      const path = modules[args.path.slice(PACKAGE.length)];
      return path ? { path } : { errors: [{ text: `${args.path}: not a module of the package.` }] };
    });
  },
};

const context = await esbuild.context({
  entryPoints: { demo: join(ROOT, 'embed', 'demo', 'main.tsx') },
  outdir: OUT,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"development"' },
  // exportAssets: the styles and script of the exported page, which the sources of export.js leave to the build.
  plugins: [viewerPackage, exportAssets],
});
console.log(`The demo uses the viewer of ${usePackage ? '.work/npm-embed' : 'embed/'}.`);
await context.rebuild();

if (process.argv.includes('--serve')) {
  const { hosts, port } = await context.serve({ servedir: OUT, host: '127.0.0.1', port: 8000 });
  console.log(`Serving the demo at http://${hosts[0]}:${port}/ (Ctrl+C to stop)`);
} else {
  await context.dispose();
}
