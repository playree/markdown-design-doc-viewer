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
    { ...modules, entryPoints: { react: 'embed/react.tsx' }, plugins: [viewerOfReact], banner: { js: "'use client';" } },
    {
      ...common,
      entryPoints: { viewer: 'embed/viewer.css' },
    },
  ];
}

/** Makes react.js import the viewer from index.js instead of bundling it again: one copy of its code and its state. */
const viewerOfReact = {
  name: 'viewer-of-react',
  setup(build) {
    build.onResolve({ filter: /^\.\/viewer$/ }, (args) => (/[\\/]embed[\\/]react\.tsx$/.test(args.importer) ? { path: './index.js', external: true } : undefined));
  },
};
