/**
 * The preview webview of VS Code (and of the desktop app, whose desktop/vscodeShim.ts stands in for VS Code): the
 * preview (preview.ts) takes the whole page, and talks to the extension host with the messages of the webview.
 */
import type { FromWebview, ToWebview, WebviewState } from '../src/protocol';
import { createPreview } from './preview';
import { windowScrollHost } from './viewerContext';

interface VsCodeApi {
  postMessage(message: FromWebview): void;
  getState(): WebviewState | undefined;
  setState(state: WebviewState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

const preview = createPreview({
  el: document.body,
  root: document.getElementById('seqnotes-root')!,
  scroll: windowScrollHost(),
  idPrefix: 'seqnotes',
  post: (message) => vscode.postMessage(message),
  getState: () => vscode.getState(),
  setState: (state) => vscode.setState(state),
});

window.addEventListener('message', (event: MessageEvent<ToWebview>) => void preview.handle(event.data));

vscode.postMessage({ type: 'ready' });
