import * as vscode from 'vscode';
import type { FromWebview, ToWebview, WebviewState } from './protocol';
import { createMarkdown, renderDocument } from './render';

const VIEW_TYPE = 'seqNotes.preview';
const UPDATE_DELAY_MS = 300;
/** Editor scroll events caused by our own reveal are ignored for this long. */
const SCROLL_SUPPRESS_MS = 500;

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

interface Settings {
  splitMinWidth: number;
  syncEditor: boolean;
}

function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration('seqNotes');
  return {
    splitMinWidth: c.get<number>('splitMinWidth', 1000),
    syncEditor: c.get<boolean>('syncEditor', true),
  };
}

/** decodeURIComponent that leaves malformed escapes (e.g. `100%.md`) as they are. */
function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export class PreviewManager implements vscode.Disposable {
  private readonly previews = new Map<string, Preview>();
  private readonly md = createMarkdown();
  private readonly disposables: vscode.Disposable[] = [];
  private suppressScrollUntil = 0;
  /** Cached because it is read on every editor scroll / selection event. */
  private settings = readSettings();

  constructor(private readonly extensionUri: vscode.Uri) {
    this.disposables.push(
      vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
        deserializeWebviewPanel: async (panel, state: WebviewState | undefined) => {
          if (state?.uri) {
            this.attach(panel, vscode.Uri.parse(state.uri));
          } else {
            panel.dispose();
          }
        },
      }),
      vscode.workspace.onDidChangeTextDocument((e) => this.previews.get(e.document.uri.toString())?.scheduleUpdate()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('seqNotes')) {
          this.settings = readSettings();
          this.previews.forEach((p) => p.update());
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (this.settings.syncEditor) {
          this.previews.get(e.textEditor.document.uri.toString())?.post({ type: 'markLine', line: e.selections[0].active.line });
        }
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (!this.settings.syncEditor || Date.now() < this.suppressScrollUntil || e.visibleRanges.length === 0) {
          return;
        }
        this.previews.get(e.textEditor.document.uri.toString())?.post({ type: 'scrollToLine', line: e.visibleRanges[0].start.line });
      }),
    );
  }

  show(uri: vscode.Uri, column: vscode.ViewColumn): void {
    const existing = this.previews.get(uri.toString());
    if (existing) {
      existing.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, '', { viewColumn: column, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.attach(panel, uri);
  }

  private attach(panel: vscode.WebviewPanel, uri: vscode.Uri): void {
    const preview = new Preview(panel, uri, this.extensionUri, this.md, {
      settings: () => this.settings,
      revealLine: (line) => this.revealLine(uri, line),
    });
    this.previews.set(uri.toString(), preview);
    panel.onDidDispose(() => {
      preview.dispose();
      this.previews.delete(uri.toString());
    });
  }

  private async revealLine(uri: vscode.Uri, line: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const visible = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
    const position = new vscode.Position(Math.min(line, document.lineCount - 1), 0);
    this.suppressScrollUntil = Date.now() + SCROLL_SUPPRESS_MS;
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: visible?.viewColumn ?? vscode.ViewColumn.One,
      selection: new vscode.Range(position, position),
    });
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  dispose(): void {
    this.previews.forEach((p) => p.panel.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}

interface PreviewHost {
  settings(): Settings;
  revealLine(line: number): void;
}

class Preview {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private disposed = false;
  private readonly messageListener: vscode.Disposable;

  constructor(
    readonly panel: vscode.WebviewPanel,
    private readonly uri: vscode.Uri,
    private readonly extensionUri: vscode.Uri,
    private readonly md: ReturnType<typeof createMarkdown>,
    private readonly host: PreviewHost,
  ) {
    const documentDir = vscode.Uri.joinPath(uri, '..');
    panel.title = `Preview ${uri.path.split('/').pop()}`;
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'images', 'preview.svg');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'dist'),
        documentDir,
        ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri),
      ],
    };
    panel.webview.html = this.shell();
    this.messageListener = panel.webview.onDidReceiveMessage((message: FromWebview) => this.onMessage(message));
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.messageListener.dispose();
  }

  post(message: ToWebview): void {
    if (this.ready && !this.disposed) {
      void this.panel.webview.postMessage(message);
    }
  }

  scheduleUpdate(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), UPDATE_DELAY_MS);
  }

  async update(): Promise<void> {
    clearTimeout(this.timer);
    const document = await vscode.workspace.openTextDocument(this.uri);
    if (this.disposed) {
      return;
    }
    const html = renderDocument(this.md, document.getText(), { resolveResource: (src) => this.resolveResource(src) });
    this.post({ type: 'update', uri: this.uri.toString(), html, ...this.host.settings() });
  }

  private async onMessage(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready': {
        this.ready = true;
        await this.update();
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === this.uri.toString());
        if (editor && this.host.settings().syncEditor) {
          this.post({ type: 'markLine', line: editor.selection.active.line });
        }
        break;
      }
      case 'revealLine':
        this.host.revealLine(message.line);
        break;
      case 'openLink':
        await this.openLink(message.href);
        break;
    }
  }

  private async openLink(href: string): Promise<void> {
    if (SCHEME_RE.test(href)) {
      if (/^(https?|mailto):/i.test(href)) {
        await vscode.env.openExternal(vscode.Uri.parse(href));
      }
      return;
    }
    const [path, fragment] = href.split('#', 2);
    const target = this.resolvePath(safeDecode(path));
    await vscode.commands.executeCommand('vscode.open', fragment ? target.with({ fragment }) : target);
  }

  private resolvePath(path: string): vscode.Uri {
    if (path.startsWith('/')) {
      const folder = vscode.workspace.getWorkspaceFolder(this.uri);
      return vscode.Uri.joinPath(folder?.uri ?? vscode.Uri.joinPath(this.uri, '..'), path);
    }
    return vscode.Uri.joinPath(this.uri, '..', path);
  }

  private resolveResource(src: string): string {
    if (SCHEME_RE.test(src) || src.startsWith('//') || src.startsWith('#')) {
      return src;
    }
    const [path] = src.split(/[?#]/, 1);
    return this.panel.webview.asWebviewUri(this.resolvePath(safeDecode(path))).toString();
  }

  private shell(): string {
    const webview = this.panel.webview;
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    const n = nonce();
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${n}'`,
      // mermaid writes inline <style> elements and style attributes into its SVGs
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
</head>
<body>
<div id="seqnotes-root"></div>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
  }
}
