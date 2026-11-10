/**
 * Builds the demo of the embedded viewer (embed/demo/: a React page with two viewers, embed/react.tsx) into
 * .work/embed-demo/, with the examples next to it, which it shows. Not in dist/: it is not shipped.
 *
 *   pnpm embed:demo            # builds it
 *   pnpm embed:demo --serve    # builds it and serves it (http://127.0.0.1:8000/)
 */
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.work', 'embed-demo');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyFileSync(join(ROOT, 'embed', 'demo', 'index.html'), join(OUT, 'index.html'));
cpSync(join(ROOT, 'examples'), join(OUT, 'examples'), { recursive: true });

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
});
await context.rebuild();

if (process.argv.includes('--serve')) {
  const { hosts, port } = await context.serve({ servedir: OUT, host: '127.0.0.1', port: 8000 });
  console.log(`Serving the demo at http://${hosts[0]}:${port}/ (Ctrl+C to stop)`);
} else {
  await context.dispose();
}
