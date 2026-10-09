import * as vscode from 'vscode';
import { registerAuthoringProviders } from './authoringProviders';
import { DiagnosticsManager } from './diagnostics';
import { exportHtml } from './exportHtml';
import { PreviewManager } from './previewPanel';

function targetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId === 'markdown') {
    return editor.document.uri;
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const manager = new PreviewManager(context.extensionUri);

  const open = (column: vscode.ViewColumn) => (arg: unknown) => {
    const uri = targetUri(arg);
    if (!uri) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Open a Markdown file to preview it.'));
      return;
    }
    manager.show(uri, column);
  };

  context.subscriptions.push(
    manager,
    new DiagnosticsManager(),
    registerAuthoringProviders(),
    vscode.commands.registerCommand('mdDesignDoc.openPreview', open(vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('mdDesignDoc.openPreviewToSide', open(vscode.ViewColumn.Beside)),
    vscode.commands.registerCommand('mdDesignDoc.exportHtml', (arg: unknown) => {
      // From the preview's context menu, the argument is not the document but the preview has the focus.
      const uri = arg instanceof vscode.Uri ? arg : (manager.activeUri() ?? targetUri(undefined));
      if (!uri) {
        void vscode.window.showWarningMessage(vscode.l10n.t('Open a Markdown file to export it.'));
        return;
      }
      return exportHtml(manager, context.extensionUri, uri);
    }),
  );
}

export function deactivate(): void {}
