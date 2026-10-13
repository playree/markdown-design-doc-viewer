/**
 * What VS Code gives the preview webview: `acquireVsCodeApi`, whose messages go to the app (host.ts), and the
 * translated titles that the extension host writes on the body (`shell()` in src/previewPanel.ts).
 */
import { WEBVIEW_TITLES, type FromWebview, type WebviewState } from '../src/protocol';
import { onWebviewMessage } from './host';
import { lang, t } from './l10n';

/** The state of the webview (the width of the diagram column), kept for the next launch. */
const STATE_KEY = 'mdDesignDoc.webviewState';

function getState(): WebviewState | undefined {
  try {
    const saved = localStorage.getItem(STATE_KEY);
    return saved ? (JSON.parse(saved) as WebviewState) : undefined;
  } catch {
    return undefined;
  }
}

function setState(state: WebviewState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Not kept.
  }
}

(window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage: (message: FromWebview) => onWebviewMessage(message),
  getState,
  setState,
});

document.documentElement.lang = lang;
for (const [name, title] of Object.entries(WEBVIEW_TITLES)) {
  document.body.setAttribute(`data-seqnotes-${name}`, t(title));
}
