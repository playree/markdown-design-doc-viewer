/**
 * The desktop app: the preview webview of the extension (webview/main.ts), with the app (host.ts) in place of the
 * extension host. esbuild runs the modules in the order of the imports: the shim defines `acquireVsCodeApi` and
 * the translated titles before the webview reads them.
 */
import './vscodeShim';
import '../webview/main';
