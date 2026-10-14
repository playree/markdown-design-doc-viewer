/**
 * The options of the bundles: of the desktop app (desktop/, built to desktop/dist/ for Tauri) with `desktop`, else of
 * the extension and the command line. Built by esbuild.mjs, and by
 * scripts/third-party-notices.mjs (without writing them) to find the bundled packages.
 */
export function buildOptions({ production, desktop }) {
  const common = {
    bundle: true,
    minify: production,
    sourcemap: !production,
    logLevel: 'info',
  };
  if (desktop) {
    return [
      {
        ...common,
        // export.js: the script of an exported HTML file (File > Export as HTML...), as in dist/.
        entryPoints: { app: 'desktop/main.ts', export: 'webview/export.ts' },
        outdir: 'desktop/dist',
        platform: 'browser',
        format: 'iife',
        // WebView2 on Windows, WebKitGTK on Linux, WKWebView on macOS.
        target: ['chrome120', 'safari16'],
      },
      {
        ...common,
        // webview.css and export.css: the styles of an exported HTML file, as in dist/ (app.css has the theme of the app).
        entryPoints: { app: 'desktop/app.css', webview: 'webview/preview.css', export: 'webview/export.css' },
        outdir: 'desktop/dist',
        target: ['chrome120', 'safari16'],
      },
    ];
  }
  return [
    {
      ...common,
      entryPoints: ['src/extension.ts'],
      outfile: 'dist/extension.js',
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['vscode'],
    },
    // The command line (`md-design-doc export`). Without `vscode`, so that it fails to build if it gets imported.
    {
      ...common,
      entryPoints: ['src/cli.ts'],
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
