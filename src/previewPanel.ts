import * as vscode from 'vscode';
import type { DiagramLook, FromWebview, ToWebview, WebviewState } from './protocol';
import { createMarkdown, escapeHtml, renderDocument } from './render';

const VIEW_TYPE = 'mdDesignDoc.preview';
/** Custom editor shown in "Reopen Editor With..." for Markdown files. */
const EDITOR_VIEW_TYPE = 'mdDesignDoc.editor';
const UPDATE_DELAY_MS = 300;
/** Editor scroll events caused by our own reveal are ignored for this long. */
const SCROLL_SUPPRESS_MS = 500;

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
/** An exported document is rendered by the preview; it gives up after this long. */
const EXPORT_TIMEOUT_MS = 60_000;

export interface Settings {
  splitMinWidth: number;
  syncEditor: boolean;
  toc: boolean;
  frontMatter: boolean;
  diagramLook: DiagramLook;
}

export function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration('mdDesignDoc');
  return {
    splitMinWidth: c.get<number>('splitMinWidth', 1000),
    syncEditor: c.get<boolean>('syncEditor', true),
    toc: c.get<boolean>('toc', true),
    frontMatter: c.get<boolean>('frontMatter', true),
    diagramLook: c.get<string>('diagramLook') === 'classic' ? 'classic' : 'neo',
  };
}

/** decodeURIComponent that leaves malformed escapes (e.g. `100%.md`) as they are. */
export function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** true for a URL that is not a path relative to the document (`https:`, `data:`, `//host`, `#id`). */
export const isExternalUrl = (src: string): boolean => SCHEME_RE.test(src) || src.startsWith('//') || src.startsWith('#');

/** Resolves a link or image path of a Markdown document: relative to it, or to its workspace folder with a leading `/`. */
export function resolveDocumentPath(document: vscode.Uri, path: string): vscode.Uri {
  if (path.startsWith('/')) {
    const folder = vscode.workspace.getWorkspaceFolder(document);
    return vscode.Uri.joinPath(folder?.uri ?? vscode.Uri.joinPath(document, '..'), path);
  }
  return vscode.Uri.joinPath(document, '..', path);
}

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

type PreviewKind = 'panel' | 'editor';

export class PreviewManager implements vscode.Disposable {
  /** A document can have both a panel preview and a custom editor open at once. */
  private readonly previews = new Map<string, Set<Preview>>();
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
            this.attach(panel, vscode.Uri.parse(state.uri), 'panel');
          } else {
            panel.dispose();
          }
        },
      }),
      vscode.window.registerCustomEditorProvider(
        EDITOR_VIEW_TYPE,
        {
          resolveCustomTextEditor: (document, panel) => {
            this.attach(panel, document.uri, 'editor');
          },
        },
        { webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true }, supportsMultipleEditorsPerDocument: true },
      ),
      vscode.workspace.onDidChangeTextDocument((e) => this.forEach(e.document.uri, (p) => p.scheduleUpdate())),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('mdDesignDoc')) {
          this.settings = readSettings();
          this.previews.forEach((set) => set.forEach((p) => p.update()));
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (this.settings.syncEditor) {
          this.forEach(e.textEditor.document.uri, (p) => p.post({ type: 'markLine', line: e.selections[0].active.line }));
        }
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (!this.settings.syncEditor || Date.now() < this.suppressScrollUntil || e.visibleRanges.length === 0) {
          return;
        }
        this.forEach(e.textEditor.document.uri, (p) => p.post({ type: 'scrollToLine', line: e.visibleRanges[0].start.line }));
      }),
    );
  }

  show(uri: vscode.Uri, column: vscode.ViewColumn): Preview {
    const existing = [...(this.previews.get(uri.toString()) ?? [])].find((p) => p.kind === 'panel');
    if (existing) {
      existing.panel.reveal(column);
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, '', { viewColumn: column, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
    });
    return this.attach(panel, uri, 'panel');
  }

  /** The document of the preview (panel or custom editor) that has the focus. */
  activeUri(): vscode.Uri | undefined {
    for (const set of this.previews.values()) {
      for (const preview of set) {
        if (preview.panel.active) {
          return preview.uri;
        }
      }
    }
    return undefined;
  }

  /** A preview of the document that has loaded, opened to the side if there is none. */
  async readyPreview(uri: vscode.Uri): Promise<Preview> {
    const preview = this.previews.get(uri.toString())?.values().next().value ?? this.show(uri, vscode.ViewColumn.Beside);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(vscode.l10n.t('The preview did not respond.'))), EXPORT_TIMEOUT_MS);
    });
    try {
      await Promise.race([preview.whenReady, timeout]);
    } finally {
      clearTimeout(timer);
    }
    return preview;
  }

  private forEach(uri: vscode.Uri, fn: (preview: Preview) => void): void {
    this.previews.get(uri.toString())?.forEach(fn);
  }

  private attach(panel: vscode.WebviewPanel, uri: vscode.Uri, kind: PreviewKind): Preview {
    const key = uri.toString();
    const preview = new Preview(panel, uri, kind, this.extensionUri, this.md, {
      settings: () => this.settings,
      // A custom editor occupies the document's tab, so the source opens beside it.
      revealLine: (line) => this.revealLine(uri, line, kind === 'editor' ? vscode.ViewColumn.Beside : vscode.ViewColumn.One),
    });
    let set = this.previews.get(key);
    if (!set) {
      set = new Set();
      this.previews.set(key, set);
    }
    set.add(preview);
    panel.onDidDispose(() => {
      preview.dispose();
      const current = this.previews.get(key);
      current?.delete(preview);
      if (current?.size === 0) {
        this.previews.delete(key);
      }
    });
    return preview;
  }

  private async revealLine(uri: vscode.Uri, line: number, fallbackColumn: vscode.ViewColumn): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const visible = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
    const position = new vscode.Position(Math.min(line, document.lineCount - 1), 0);
    this.suppressScrollUntil = Date.now() + SCROLL_SUPPRESS_MS;
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: visible?.viewColumn ?? fallbackColumn,
      selection: new vscode.Range(position, position),
    });
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  dispose(): void {
    this.previews.forEach((set) => set.forEach((p) => p.panel.dispose()));
    this.disposables.forEach((d) => d.dispose());
  }
}

interface PreviewHost {
  settings(): Settings;
  revealLine(line: number): void;
}

export class Preview {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private disposed = false;
  private readonly messageListener: vscode.Disposable;
  private setReady!: () => void;
  private setClosed!: (error: Error) => void;
  /** Resolved once the webview has loaded and received the document, rejected when it is closed before. */
  readonly whenReady = new Promise<void>((resolve, reject) => {
    this.setReady = resolve;
    this.setClosed = reject;
  });
  private exportId = 0;
  private readonly exports = new Map<number, { resolve: (body: string) => void; reject: (error: Error) => void }>();

  constructor(
    readonly panel: vscode.WebviewPanel,
    readonly uri: vscode.Uri,
    readonly kind: PreviewKind,
    private readonly extensionUri: vscode.Uri,
    private readonly md: ReturnType<typeof createMarkdown>,
    private readonly host: PreviewHost,
  ) {
    const documentDir = vscode.Uri.joinPath(uri, '..');
    // A custom editor's tab is titled by VS Code after the document.
    if (kind === 'panel') {
      panel.title = vscode.l10n.t('Preview {0}', uri.path.split('/').pop() ?? '');
      panel.iconPath = vscode.Uri.joinPath(extensionUri, 'images', 'preview.svg');
    }
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
    // Only awaited by an export.
    this.whenReady.catch(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.messageListener.dispose();
    const closed = new Error(vscode.l10n.t('The preview was closed.'));
    this.setClosed(closed);
    this.exports.forEach(({ reject }) => reject(closed));
    this.exports.clear();
  }

  /** Has the webview render `html` (from `renderDocument`) for an exported file, and returns the rendered body. */
  renderForExport(html: string): Promise<string> {
    if (this.disposed) {
      return Promise.reject(new Error(vscode.l10n.t('The preview was closed.')));
    }
    const id = ++this.exportId;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.exports.delete(id);
        reject(new Error(vscode.l10n.t('The preview did not respond.')));
      }, EXPORT_TIMEOUT_MS);
      const done = (fn: () => void) => {
        clearTimeout(timer);
        this.exports.delete(id);
        fn();
      };
      this.exports.set(id, { resolve: (body) => done(() => resolve(body)), reject: (error) => done(() => reject(error)) });
      this.post({ type: 'export', id, html });
    });
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
    const { frontMatter, ...settings } = this.host.settings();
    const html = renderDocument(this.md, document.getText(), { resolveResource: (src) => this.resolveResource(src), t: vscode.l10n.t, frontMatter });
    this.post({ type: 'update', uri: this.uri.toString(), html, ...settings });
  }

  private async onMessage(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready': {
        this.ready = true;
        await this.update();
        this.setReady();
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
      case 'exported': {
        const pending = this.exports.get(message.id);
        if (message.body !== undefined) {
          pending?.resolve(message.body);
        } else {
          pending?.reject(new Error(message.error ?? ''));
        }
        break;
      }
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
    const target = resolveDocumentPath(this.uri, safeDecode(path));
    await vscode.commands.executeCommand('vscode.open', fragment ? target.with({ fragment }) : target);
  }

  private resolveResource(src: string): string {
    if (isExternalUrl(src)) {
      return src;
    }
    const [path] = src.split(/[?#]/, 1);
    return this.panel.webview.asWebviewUri(resolveDocumentPath(this.uri, safeDecode(path))).toString();
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
    const splitterTitle = escapeHtml(vscode.l10n.t('Drag to resize, double-click to reset'));
    const hideWarningsTitle = escapeHtml(vscode.l10n.t('Hide warnings'));
    const tocTitle = escapeHtml(vscode.l10n.t('Contents'));
    const zoomTitles = [
      ['zoom-title', vscode.l10n.t('Zoom diagram')],
      ['zoom-in-title', vscode.l10n.t('Zoom in')],
      ['zoom-out-title', vscode.l10n.t('Zoom out')],
      ['zoom-fit-title', vscode.l10n.t('Fit to window')],
      ['zoom-close-title', vscode.l10n.t('Close')],
    ]
      .map(([name, title]) => ` data-seqnotes-${name}="${escapeHtml(title)}"`)
      .join('');
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
</head>
<body data-seqnotes-splitter-title="${splitterTitle}" data-seqnotes-hide-warnings-title="${hideWarningsTitle}" data-seqnotes-toc-title="${tocTitle}"${zoomTitles}>
<div id="seqnotes-root"></div>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
  }
}
