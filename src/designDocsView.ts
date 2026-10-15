/**
 * The tree of the design documents of the workspace in the Explorer ("Design Docs"): their titles by folder, with
 * their version and status. Choosing one opens its preview; the full list is "Show Design Docs" (designDocsPanel.ts).
 */
import * as vscode from 'vscode';
import type { DesignDoc, DesignDocIndex } from './designDocs';
import { groupByFolder } from './exportIndex';
import { DESIGN_DOC_META } from './markdownExtras';

export const VIEW_ID = 'mdDesignDoc.designDocs';

type Node = { kind: 'folder'; folder: string; docs: DesignDoc[] } | { kind: 'doc'; doc: DesignDoc };

export class DesignDocsView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];

  constructor(private readonly index: DesignDocIndex) {
    this.disposables.push(
      vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this, showCollapseAll: true }),
      index.onDidChange(() => this.changed.fire()),
    );
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node) {
      return node.kind === 'folder' ? node.docs.map((doc) => ({ kind: 'doc', doc })) : [];
    }
    // The documents at the top of the workspace first, then a node for each folder.
    return groupByFolder(await this.index.designDocs()).flatMap(({ folder, entries }): Node[] =>
      folder === '' ? entries.map((doc) => ({ kind: 'doc', doc })) : [{ kind: 'folder', folder, docs: entries }],
    );
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'folder') {
      const item = new vscode.TreeItem(node.folder, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `folder:${node.folder}`;
      item.iconPath = vscode.ThemeIcon.Folder;
      return item;
    }
    const { doc } = node;
    const item = new vscode.TreeItem(doc.title, vscode.TreeItemCollapsibleState.None);
    item.id = `doc:${doc.uri.toString()}`;
    item.resourceUri = doc.uri;
    item.iconPath = vscode.ThemeIcon.File;
    item.description = [doc.meta.version, doc.meta.status].filter((value) => value !== undefined).join(' · ');
    item.contextValue = 'designDoc';
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('**').appendText(doc.title).appendMarkdown('**\n\n');
    for (const { key, label } of DESIGN_DOC_META) {
      if (doc.meta[key] !== undefined) {
        tooltip.appendText(`${vscode.l10n.t(label)}: ${doc.meta[key]}`).appendMarkdown('  \n');
      }
    }
    tooltip.appendMarkdown('\n').appendText(doc.path);
    item.tooltip = tooltip;
    item.command = { command: 'mdDesignDoc.openPreview', title: vscode.l10n.t('Open Preview'), arguments: [doc.uri] };
    return item;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

/** The document of a node of the tree, for the commands of its context menu. */
export function nodeUri(node: unknown): vscode.Uri | undefined {
  const doc = (node as Partial<Extract<Node, { kind: 'doc' }>> | undefined)?.doc;
  return doc?.uri;
}
