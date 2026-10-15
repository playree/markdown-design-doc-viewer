/**
 * The list of the design documents of the workspace ("Show Design Docs"): a page of the editor area with a table of
 * them, the same as the list of the command line (`indexBody`), shown by the preview's webview with its search box
 * and sortable columns. It follows the changes of the files, and opens the preview of the document chosen.
 */
import * as vscode from 'vscode';
import type { DesignDoc, DesignDocIndex } from './designDocs';
import { indexBody, NO_DESIGN_DOCS } from './exportIndex';
import { readSettings, webviewShell } from './previewPanel';
import type { FromWebview, ToWebview } from './protocol';

const VIEW_TYPE = 'mdDesignDoc.designDocs';
/** `uri` of the updates of the list, for the webview (which tells it from a document). */
const LIST_URI = 'mdDesignDoc:designDocs';

export class DesignDocsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  /** The documents of the links of the list, by their href. */
  private links = new Map<string, vscode.Uri>();
  private readonly disposables: vscode.Disposable[] = [];
  /** Numbers the updates, so that an older list does not replace a newer one. */
  private updateSeq = 0;
  /** The last update sent to the webview of the panel. */
  private sent: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index: DesignDocIndex,
  ) {
    this.disposables.push(
      vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
        deserializeWebviewPanel: async (panel) => this.attach(panel),
      }),
      index.onDidChange(() => void this.update()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('mdDesignDoc')) {
          void this.update();
        }
      }),
    );
  }

  /** Shows the list, in the active column. */
  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.attach(
      vscode.window.createWebviewPanel(VIEW_TYPE, '', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
      }),
    );
  }

  private attach(panel: vscode.WebviewPanel): void {
    this.panel?.dispose();
    this.panel = panel;
    this.ready = false;
    this.sent = undefined;
    panel.title = vscode.l10n.t('Design Docs');
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'images', 'design-docs.svg');
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')] };
    panel.webview.html = webviewShell(panel.webview, this.extensionUri, readSettings().theme);
    const listener = panel.webview.onDidReceiveMessage((message: FromWebview) => this.onMessage(message));
    panel.onDidDispose(() => {
      listener.dispose();
      if (this.panel === panel) {
        this.panel = undefined;
      }
    });
  }

  private async onMessage(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.sent = undefined;
        await this.update();
        break;
      case 'openLink': {
        const uri = this.links.get(message.href);
        if (uri) {
          await vscode.commands.executeCommand('mdDesignDoc.openPreview', uri);
        }
        break;
      }
    }
  }

  private async update(): Promise<void> {
    const seq = ++this.updateSeq;
    if (!this.panel || !this.ready) {
      return;
    }
    const t = vscode.l10n.t;
    let docs: DesignDoc[] | undefined;
    let failure = '';
    try {
      docs = await this.index.designDocs();
    } catch (error) {
      failure = t('Could not list the design docs: {0}', error instanceof Error ? error.message : String(error));
    }
    const panel = this.panel;
    if (seq !== this.updateSeq || !panel || !this.ready) {
      return;
    }
    const href = (doc: DesignDoc): string => encodeURI(doc.path);
    this.links = new Map((docs ?? []).map((doc) => [href(doc), doc.uri]));
    const html = indexBody(
      t('Design Docs'),
      (docs ?? []).map((doc) => ({ title: doc.title, meta: doc.meta, href: href(doc), folder: doc.folder, file: doc.file })),
      t,
      docs ? t(NO_DESIGN_DOCS) : failure,
    );
    const { splitMinWidth, toc, diagramLook, theme, limitContentWidth, stickyTableHeader, tableTreeHighlight } = readSettings();
    const message: ToWebview = { type: 'update', uri: LIST_URI, html, splitMinWidth, syncEditor: false, toc, diagramLook, theme, limitContentWidth, stickyTableHeader, tableTreeHighlight };
    // Not rendered again when a file changed without changing the list.
    const sent = JSON.stringify(message);
    if (sent !== this.sent) {
      this.sent = sent;
      void panel.webview.postMessage(message);
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
