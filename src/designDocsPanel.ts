/**
 * The list of the design documents of the workspace ("Show Design Docs"): a page of the editor area with a table of
 * them, the same as the list of the command line (`indexBody`), shown by the preview's webview with its search box
 * and sortable columns. It follows the changes of the files, and opens the preview of the document chosen.
 */
import * as vscode from 'vscode';
import type { DesignDoc, DesignDocIndex } from './designDocs';
import { indexBody } from './exportIndex';
import { readSettings, webviewShell } from './previewPanel';
import type { FromWebview, ToWebview } from './protocol';

const VIEW_TYPE = 'mdDesignDoc.designDocs';
/** `uri` of the updates of the list, for the webview (which tells it from a document). */
const LIST_URI = 'mdDesignDoc:designDocs';

/** The text of an empty list, also used by the tree of the Explorer. */
export const NO_DESIGN_DOCS = 'There are no design docs (Markdown files with type: design_doc in their front matter).';

export class DesignDocsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  /** The documents of the links of the list, by their href. */
  private links = new Map<string, vscode.Uri>();
  private readonly disposables: vscode.Disposable[] = [];
  /** Numbers the updates, so that an older list does not replace a newer one. */
  private updateSeq = 0;

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
    const docs = await this.index.designDocs();
    const panel = this.panel;
    if (seq !== this.updateSeq || !panel || !this.ready) {
      return;
    }
    const href = (doc: DesignDoc): string => encodeURI(doc.path);
    this.links = new Map(docs.map((doc) => [href(doc), doc.uri]));
    const t = vscode.l10n.t;
    const html = indexBody(
      t('Design Docs'),
      docs.map((doc) => ({ title: doc.title, meta: doc.meta, href: href(doc), folder: doc.folder, file: doc.file })),
      t,
      t(NO_DESIGN_DOCS),
    );
    const { splitMinWidth, toc, diagramLook, theme, limitContentWidth, stickyTableHeader, tableTreeHighlight } = readSettings();
    const message: ToWebview = { type: 'update', uri: LIST_URI, html, splitMinWidth, syncEditor: false, toc, diagramLook, theme, limitContentWidth, stickyTableHeader, tableTreeHighlight };
    void panel.webview.postMessage(message);
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
