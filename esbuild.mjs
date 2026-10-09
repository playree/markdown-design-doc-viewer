import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  }),
  esbuild.context({
    ...common,
    entryPoints: { webview: 'webview/main.ts', export: 'webview/export.ts' },
    outdir: 'dist',
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
  }),
  esbuild.context({
    ...common,
    entryPoints: { webview: 'webview/preview.css', export: 'webview/export.css' },
    outdir: 'dist',
  }),
]);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
