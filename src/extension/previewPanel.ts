import * as vscode from 'vscode';
import { resolveDocumentPath, WireframeWatcher, type DocumentAnalyzer } from './documentFiles';
import { WEBVIEW_TITLES, type DiagramLook, type DiffView, type FromWebview, type PreviewTheme, type ToWebview, type WebviewState } from '../shared/protocol';
import { isExternalUrl, safeDecode, SCHEME_RE } from '../export/exportPage';
import { renderDiff } from '../diff/diffRender';
import { DEFAULT_MESSAGE_WRAP_WIDTH, isWrapWidth } from '../diagrams/sequenceWrap';
import { createMarkdown, escapeHtml, renderDocument, type RenderEnv } from '../markdown/render';

const VIEW_TYPE = 'mdDesignDoc.preview';
/** Custom editor shown in "Reopen Editor With..." for Markdown files. */
const EDITOR_VIEW_TYPE = 'mdDesignDoc.editor';
const UPDATE_DELAY_MS = 300;
/** Editor scroll events caused by our own reveal are ignored for this long. */
const SCROLL_SUPPRESS_MS = 500;

/** An exported document is rendered by the preview; it gives up after this long. */
const EXPORT_TIMEOUT_MS = 60_000;

export interface Settings {
  splitMinWidth: number;
  syncEditor: boolean;
  toc: boolean;
  headingNumbers: boolean;
  messageWrapWidth: number;
  frontMatter: boolean;
  diagramLook: DiagramLook;
  theme: PreviewTheme;
  limitContentWidth: boolean;
  stickyTableHeader: boolean;
  tableTreeHighlight: boolean;
}

export function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration('mdDesignDoc');
  return {
    splitMinWidth: c.get<number>('splitMinWidth', 1000),
    syncEditor: c.get<boolean>('syncEditor', true),
    toc: c.get<boolean>('toc', true),
    headingNumbers: c.get<boolean>('headingNumbers', true),
    messageWrapWidth: readWrapWidth(c.get<unknown>('messageWrapWidth')),
    frontMatter: c.get<boolean>('frontMatter', true),
    diagramLook: c.get<string>('diagramLook') === 'classic' ? 'classic' : 'neo',
    theme: readTheme(c.get<string>('theme')),
    limitContentWidth: c.get<boolean>('limitContentWidth', true),
    stickyTableHeader: c.get<boolean>('stickyTableHeader', true),
    tableTreeHighlight: c.get<boolean>('tableTreeHighlight', true),
  };
}

function readWrapWidth(value: unknown): number {
  return isWrapWidth(value) ? value : DEFAULT_MESSAGE_WRAP_WIDTH;
}

function readTheme(value: string | undefined): PreviewTheme {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/**
 * The page of a webview that shows the preview (webview/main.ts): the document is sent to it with `update` once it
 * is `ready`. Also that of the list of the design documents (designDocsPanel.ts).
 */
export function webviewShell(webview: vscode.Webview, extensionUri: vscode.Uri, theme: PreviewTheme): string {
  const dist = vscode.Uri.joinPath(extensionUri, 'dist');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${n}'`,
    // mermaid writes inline <style> elements and style attributes into its SVGs
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} https: data:`,
    // The fonts of the wireframes captured by `md-design-doc capture` are embedded in their styles
    `font-src ${webview.cspSource} data:`,
  ].join('; ');
  const titles = Object.entries(WEBVIEW_TITLES)
    .map(([name, title]) => ` data-seqnotes-${name}="${escapeHtml(vscode.l10n.t(title))}"`)
    .join('');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
</head>
<body class="seqnotes-viewer" data-seqnotes-theme="${theme}"${titles}>
<div id="seqnotes-root" class="seqnotes-viewer-root"></div>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
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

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly analyzer: DocumentAnalyzer,
  ) {
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
      vscode.workspace.onDidChangeTextDocument((e) => {
        // Not when only its state changed (saved, or dirty).
        if (e.contentChanges.length > 0) {
          this.forEach(e.document.uri, (p) => p.scheduleUpdate());
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('mdDesignDoc')) {
          this.settings = readSettings();
          this.previews.forEach((set) => set.forEach((p) => p.refresh()));
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
    return this.activePreview()?.uri;
  }

  /** The preview (panel or custom editor) that has the focus. */
  activePreview(): Preview | undefined {
    for (const set of this.previews.values()) {
      for (const preview of set) {
        if (preview.panel.active) {
          return preview;
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
    const preview = new Preview(panel, uri, kind, this.extensionUri, this.md, this.analyzer, {
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

/** A revision the preview compares its document with. */
export interface Comparison {
  /** What it is compared with, for the preview (translated). */
  label: string;
  /** What it is compared with, for the exported HTML (translated): its date, which tells more to its readers than its commit. */
  exportLabel: string;
  /** The content of the document in the revision. */
  source: string;
}

interface PreviewHost {
  settings(): Settings;
  revealLine(line: number): void;
}

export class Preview {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private disposed = false;
  /** An update was asked while the preview was hidden: done when it is shown. */
  private outdated = false;
  /** The last `update` message the webview received (its HTML, and the rest in JSON), so that the same one is not sent again. */
  private lastUpdate: { html: string; rest: string } | undefined;
  private readonly listeners: vscode.Disposable;
  private setReady!: () => void;
  private setClosed!: (error: Error) => void;
  /** Resolved once the webview has loaded and received the document, rejected when it is closed before. */
  readonly whenReady = new Promise<void>((resolve, reject) => {
    this.setReady = resolve;
    this.setClosed = reject;
  });
  private exportId = 0;
  /** The revision whose differences are shown, if any. */
  private compared: Comparison | undefined;
  /** Follows the files of the wireframes shown. */
  private readonly wireframeWatcher: WireframeWatcher;
  /** The last update, so that an earlier one that ends later (reading the wireframes) does not replace it. */
  private updates = 0;
  private readonly exports = new Map<number, { resolve: (body: string) => void; reject: (error: Error) => void }>();

  constructor(
    readonly panel: vscode.WebviewPanel,
    readonly uri: vscode.Uri,
    readonly kind: PreviewKind,
    private readonly extensionUri: vscode.Uri,
    private readonly md: ReturnType<typeof createMarkdown>,
    private readonly analyzer: DocumentAnalyzer,
    private readonly host: PreviewHost,
  ) {
    this.wireframeWatcher = new WireframeWatcher(analyzer, () => this.scheduleUpdate());
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
    this.listeners = vscode.Disposable.from(
      panel.webview.onDidReceiveMessage((message: FromWebview) => {
        this.onMessage(message).catch((error: unknown) => console.error('Could not handle a message of the preview', error));
      }),
      panel.onDidChangeViewState(() => {
        if (panel.visible && this.outdated) {
          this.refresh();
        }
      }),
    );
    // Only awaited by an export.
    this.whenReady.catch(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.listeners.dispose();
    this.wireframeWatcher.dispose();
    const closed = new Error(vscode.l10n.t('The preview was closed.'));
    this.setClosed(closed);
    this.exports.forEach(({ reject }) => reject(closed));
    this.exports.clear();
  }

  /** Whether the preview was closed. */
  get closed(): boolean {
    return this.disposed;
  }

  /** The revision whose differences are shown, if any (exported with the document). */
  get comparison(): Comparison | undefined {
    return this.compared;
  }


  /**
   * Has the webview render `html` (from `renderForExport`, or `renderDiffForExport` with `diff`) for an exported file,
   * and returns the rendered body.
   */
  renderForExport(html: string, diagramLook: DiagramLook, diff?: DiffView): Promise<string> {
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
      this.post({ type: 'export', id, html, diagramLook, ...(diff ? { diff } : {}) });
    });
  }

  post(message: ToWebview): void {
    if (this.ready && !this.disposed) {
      void this.panel.webview.postMessage(message);
    }
  }

  /** Shows the differences of the document from a revision, or the document alone without. */
  compare(comparison: Comparison | undefined): Promise<void> {
    this.compared = comparison;
    return this.update();
  }

  scheduleUpdate(): void {
    clearTimeout(this.timer);
    if (this.deferred()) {
      return;
    }
    this.timer = setTimeout(() => this.refresh(), UPDATE_DELAY_MS);
  }

  /**
   * `update`, for the updates nothing waits for: a failure (e.g. the document deleted) is logged instead of left unhandled.
   * Left for when the preview is shown while it is hidden.
   */
  refresh(): void {
    if (this.deferred()) {
      return;
    }
    this.update().catch((error: unknown) => console.error('Could not update the preview', error));
  }

  /** true when the preview is hidden: it is updated when shown instead (`onDidChangeViewState`). */
  private deferred(): boolean {
    if (this.panel.visible) {
      return false;
    }
    this.outdated = true;
    return true;
  }

  async update(): Promise<void> {
    clearTimeout(this.timer);
    this.outdated = false;
    const update = ++this.updates;
    const document = await vscode.workspace.openTextDocument(this.uri);
    const source = document.getText();
    const analysis = await this.analyzer.analyze(document);
    if (this.disposed || update !== this.updates) {
      return;
    }
    this.wireframeWatcher.watch(analysis.dependencies);
    const { frontMatter, headingNumbers, messageWrapWidth, ...settings } = this.host.settings();
    const env: RenderEnv = { resolveResource: (src) => this.resolveResource(src), t: vscode.l10n.t, frontMatter, headingNumbers, messageWrapWidth, wireframes: analysis.files };
    // Rendered from its own tokens: rendering changes them, unlike those of the analysis, which are shared.
    if (this.compared) {
      const { html, old, stats } = renderDiff(this.md, this.compared.source, source, env);
      this.postUpdate({ type: 'update', uri: this.uri.toString(), html, ...settings, diff: { label: this.compared.label, old, stats } });
    } else {
      this.postUpdate({ type: 'update', uri: this.uri.toString(), html: renderDocument(this.md, source, env), ...settings });
    }
  }

  /** Posts an update, unless the webview has it already (e.g. after a change undone, or a setting of another extension). */
  private postUpdate(message: Extract<ToWebview, { type: 'update' }>): void {
    if (!this.ready || this.disposed) {
      return;
    }
    const { html, ...others } = message;
    const rest = JSON.stringify(others);
    if (html !== this.lastUpdate?.html || rest !== this.lastUpdate.rest) {
      this.lastUpdate = { html, rest };
      this.post(message);
    }
  }

  private async onMessage(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready': {
        this.ready = true;
        // A new page (e.g. the webview reloaded), which has nothing yet.
        this.lastUpdate = undefined;
        try {
          await this.update();
        } finally {
          // Also when the document could not be shown: an export does not wait for it.
          this.setReady();
        }
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
      case 'closeDiff':
        await this.compare(undefined);
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
    return webviewShell(this.panel.webview, this.extensionUri, this.host.settings().theme);
  }
}
