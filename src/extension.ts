import * as vscode from 'vscode';
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
      void vscode.window.showWarningMessage('Open a Markdown file to preview it with Sequence Side Notes.');
      return;
    }
    manager.show(uri, column);
  };

  context.subscriptions.push(
    manager,
    vscode.commands.registerCommand('seqNotes.openPreview', open(vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('seqNotes.openPreviewToSide', open(vscode.ViewColumn.Beside)),
  );
}

export function deactivate(): void {}
