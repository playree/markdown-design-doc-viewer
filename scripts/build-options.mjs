import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The root of the repository. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The options of the bundles: of the desktop app (desktop/, built to desktop/dist/ for Tauri) with `desktop`, of the
 * embeddable viewer (embed/, built to embed/dist/ for its npm package) with `embed`, else of the extension and the
 * command line. Built by esbuild.mjs, and by scripts/third-party-notices.mjs (without writing them) to find the bundled
 * packages.
 */
export function buildOptions({ production, desktop, embed }) {
  const common = {
    bundle: true,
    minify: production,
    sourcemap: !production,
    logLevel: 'info',
  };
  if (embed) {
    return embedOptions();
  }
  if (desktop) {
    return [
      {
        ...common,
        entryPoints: { app: 'desktop/main.ts' },
        outdir: 'desktop/dist',
        platform: 'browser',
        format: 'iife',
        // WebView2 on Windows, WebKitGTK on Linux, WKWebView on macOS.
        target: ['chrome120', 'safari16'],
      },
      {
        ...common,
        entryPoints: { app: 'desktop/app.css' },
        outdir: 'desktop/dist',
        target: ['chrome120', 'safari16'],
      },
      // The script and styles of an exported HTML file (File > Export as HTML...), built as in dist/ so that the file
      // is the same as the extension's (app.css has the theme of the app).
      {
        ...common,
        entryPoints: { export: 'webview/export.ts' },
        outdir: 'desktop/dist',
        platform: 'browser',
        format: 'iife',
        target: 'chrome120',
      },
      {
        ...common,
        entryPoints: { webview: 'webview/preview.css', export: 'webview/export.css' },
        outdir: 'desktop/dist',
      },
    ];
  }
  return [
    {
      ...common,
      entryPoints: ['src/extension/extension.ts'],
      outfile: 'dist/extension.js',
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['vscode'],
    },
    // The command line (`md-design-doc export`). Without `vscode`, so that it fails to build if it gets imported.
    {
      ...common,
      entryPoints: ['src/cli/cli.ts'],
      outfile: 'dist/cli.js',
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['playwright-core'],
      banner: { js: '#!/usr/bin/env node' },
    },
    {
      ...common,
      entryPoints: { webview: 'webview/main.ts', export: 'webview/export.ts' },
      outdir: 'dist',
      platform: 'browser',
      format: 'iife',
      target: 'chrome120',
    },
    {
      ...common,
      entryPoints: { webview: 'webview/preview.css', export: 'webview/export.css' },
      outdir: 'dist',
    },
  ];
}

/**
 * The embeddable viewer (embed/), as ES modules for the bundler of an app (scripts/npm-embed-package.mjs makes its npm
 * package): not minified, without source maps, and with the packages the app has (mermaid, React) left to it.
 */
function embedOptions() {
  const common = { bundle: true, logLevel: 'info', outdir: 'embed/dist' };
  const modules = {
    ...common,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    external: ['mermaid', 'react', 'react/*', 'react-dom', 'react-dom/*'],
  };
  return [
    { ...modules, entryPoints: { index: 'embed/viewer.ts' } },
    // A client component of React Server Components (Next.js), which a page rendered on the server can import.
    { ...modules, entryPoints: { react: 'embed/react.tsx' }, plugins: [viewerOfIndex], banner: { js: "'use client';" } },
    // exportHtml, with the styles and script of the exported page, which the viewer (index.js) does not carry.
    { ...modules, entryPoints: { export: 'embed/export.ts' }, plugins: [viewerOfIndex, exportAssets] },
    {
      ...common,
      entryPoints: { viewer: 'embed/viewer.css' },
    },
  ];
}

/**
 * Makes react.js and export.js import the viewer from index.js instead of bundling it again: one copy of its code and
 * its state.
 */
const viewerOfIndex = {
  name: 'viewer-of-index',
  setup(build) {
    build.onResolve({ filter: /^\.\/viewer$/ }, (args) => (/[\\/]embed[\\/](?:react\.tsx|export\.ts)$/.test(args.importer) ? { path: './index.js', external: true } : undefined));
  },
};

/**
 * The styles and script of an exported page (embed/exportAssets.ts) as strings, built as those of dist/ for the
 * extension's export (minified, as in its package). The packages they bundle are added to the metafile of the build,
 * for scripts/third-party-notices.mjs. Also used by the demo (scripts/embed-demo.mjs).
 */
export const exportAssets = {
  name: 'export-assets',
  setup(build) {
    const inputs = [];
    build.onStart(() => {
      inputs.length = 0;
    });
    build.onLoad({ filter: /[\\/]embed[\\/]exportAssets\.ts$/ }, async () => {
      // The paths of the metafile relative to the working directory of the build, as in its own.
      const absWorkingDir = build.initialOptions.absWorkingDir ?? process.cwd();
      const common = { bundle: true, minify: true, write: false, metafile: true, logLevel: 'silent', absWorkingDir, outdir: resolve(ROOT, 'embed/dist') };
      const [script, styles] = await Promise.all([
        build.esbuild.build({ ...common, entryPoints: { export: resolve(ROOT, 'webview/export.ts') }, platform: 'browser', format: 'iife', target: 'chrome120' }),
        build.esbuild.build({ ...common, entryPoints: { webview: resolve(ROOT, 'webview/preview.css'), export: resolve(ROOT, 'webview/export.css') } }),
      ]);
      const text = (result, name) => result.outputFiles.find((file) => file.path.endsWith(name)).text;
      for (const result of [script, styles]) {
        inputs.push(...Object.values(result.metafile.outputs).flatMap((output) => Object.entries(output.inputs)));
      }
      const contents = [
        `export const webviewCss = ${JSON.stringify(text(styles, 'webview.css'))};`,
        `export const exportCss = ${JSON.stringify(text(styles, 'export.css'))};`,
        `export const exportScript = ${JSON.stringify(text(script, 'export.js'))};`,
      ].join('\n');
      return { contents, loader: 'js', watchFiles: [...new Set(inputs.map(([input]) => resolve(absWorkingDir, input)))] };
    });
    build.onEnd((result) => {
      const output = Object.values(result.metafile?.outputs ?? {}).find((out) => /(?:^|\/)embed\/export\.ts$/.test(out.entryPoint ?? ''));
      if (output) {
        for (const [input, info] of inputs) {
          output.inputs[input] ??= info;
        }
      }
    });
  },
};
