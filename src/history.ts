/** The command comparing a document with one of its revisions in git, shown as differences in its preview. */
import * as vscode from 'vscode';
import { GitError, gitLog, gitShow } from './gitCli';
import { formatRevisionDate, type Revision } from './gitLog';
import type { PreviewManager } from './previewPanel';

/** The git of VS Code's setting `git.path` (a path, or paths tried in turn), else the one on the PATH. */
function gitPath(): string {
  const value = vscode.workspace.getConfiguration('git').get<string | string[] | null>('path');
  const path = Array.isArray(value) ? value[0] : value;
  return path || 'git';
}

function showGitError(error: unknown, uri: vscode.Uri): void {
  let message: string;
  if (error instanceof GitError && error.kind === 'notFound') {
    message = vscode.l10n.t('Git was not found. Install Git, or set its path in the setting git.path.');
  } else if (error instanceof GitError && error.kind === 'notRepository') {
    message = vscode.l10n.t('{0} is not in a Git repository.', uri.path.split('/').pop() ?? '');
  } else {
    message = vscode.l10n.t('Git failed: {0}', error instanceof Error ? error.message : String(error));
  }
  void vscode.window.showWarningMessage(message);
}

/** Lets the user choose a revision of the document, and shows its differences from it in the preview. */
export async function compareWithRevision(manager: PreviewManager, uri: vscode.Uri): Promise<void> {
  if (uri.scheme !== 'file') {
    void vscode.window.showWarningMessage(vscode.l10n.t('Only a file on the disk can be compared with its Git history.'));
    return;
  }
  const git = gitPath();
  // The preview it was run from, rather than another one of the same document.
  const active = manager.activePreview();
  let revisions: Revision[];
  try {
    revisions = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: vscode.l10n.t('Reading the Git history...') }, () =>
      gitLog(git, uri.fsPath),
    );
  } catch (error) {
    showGitError(error, uri);
    return;
  }
  if (revisions.length === 0) {
    void vscode.window.showInformationMessage(vscode.l10n.t('{0} has no Git history yet.', uri.path.split('/').pop() ?? ''));
    return;
  }
  const picked = await vscode.window.showQuickPick(
    revisions.map((revision) => ({
      label: revision.subject,
      description: `${revision.shortHash} · ${revision.author} · ${formatRevisionDate(revision.date, vscode.env.language)}`,
      revision,
    })),
    { placeHolder: vscode.l10n.t('Select a commit to compare the document with'), matchOnDescription: true },
  );
  if (!picked) {
    return;
  }
  const { revision } = picked;
  let source: string;
  try {
    const content = await gitShow(git, uri.fsPath, revision);
    // In the encoding of the document (`files.encoding`, or the one it was reopened with).
    const { encoding } = await vscode.workspace.openTextDocument(uri);
    source = (await vscode.workspace.decode(content, { encoding })).replace(/^\uFEFF/, '');
  } catch (error) {
    showGitError(error, uri);
    return;
  }
  let preview = active?.uri.toString() === uri.toString() ? active : undefined;
  if (!preview) {
    preview = await manager.readyPreview(uri);
    // Run from the editor, the preview may be in a tab behind.
    preview.panel.reveal(undefined, true);
  }
  await preview.compare({
    label: vscode.l10n.t('Compared with {0}: {1} ({2})', revision.shortHash, revision.subject, formatRevisionDate(revision.date, vscode.env.language)),
    source,
  });
}
