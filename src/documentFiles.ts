/**
 * The files a Markdown document uses besides itself, for its preview, its export and its diagnostics: the paths of its
 * images and links, and its wireframes (src/wireframe.ts).
 */
import type { MarkdownIt } from 'markdown-it';
import { realpath } from 'node:fs/promises';
import * as vscode from 'vscode';
import { loadWireframes, wireframeDependencies, wireframeSources, type WireframeFiles } from './wireframe';

/** Resolves a link or image path of a Markdown document: relative to it, or to its workspace folder with a leading `/`. */
export function resolveDocumentPath(document: vscode.Uri, path: string): vscode.Uri {
  if (path.startsWith('/')) {
    const folder = vscode.workspace.getWorkspaceFolder(document);
    return vscode.Uri.joinPath(folder?.uri ?? vscode.Uri.joinPath(document, '..'), path);
  }
  return vscode.Uri.joinPath(document, '..', path);
}

/** true when `uri` is in `folder` (or is it). */
export function isIn(uri: vscode.Uri, folder: vscode.Uri): boolean {
  const dir = folder.path.endsWith('/') ? folder.path : `${folder.path}/`;
  return uri.scheme === folder.scheme && uri.authority === folder.authority && (uri.path === folder.path || uri.path.startsWith(dir));
}

/**
 * The folders whose files a document may show: those the preview can load (`localResourceRoots`), so that an export
 * does not put other local files into a file to be shared.
 */
export function embeddableFolders(document: vscode.Uri): vscode.Uri[] {
  return [vscode.Uri.joinPath(document, '..'), ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri)];
}

/**
 * `uri` with its symbolic links resolved when it is a local file (undefined when it cannot be), so that a link in a
 * folder does not let a file out of it be read, as in the CLI and the desktop app.
 */
async function realUri(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri.scheme !== 'file') {
    return uri;
  }
  try {
    return vscode.Uri.file(await realpath(uri.fsPath));
  } catch {
    return undefined;
  }
}

/** The text of a file: that of its editor when it is open (with the changes not saved yet), or else read. */
async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) {
    return open.getText();
  }
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

export interface DocumentWireframes {
  files: WireframeFiles;
  /** The files read (or that could not be read), by their URI: the wireframes change with them. */
  dependencies: Set<string>;
}

/** Reads the wireframes of `document` (`source`) and their style sheets, from the folders of `embeddableFolders`. */
export async function readWireframes(md: MarkdownIt, document: vscode.Uri, source: string): Promise<DocumentWireframes> {
  const folders = (await Promise.all(embeddableFolders(document).map(realUri))).filter((folder) => folder !== undefined);
  const srcs = wireframeSources(md.parse(source, {}));
  const files = await loadWireframes(md, srcs, async (path) => {
    const uri = resolveDocumentPath(document, path);
    const real = await realUri(uri);
    return real && folders.some((folder) => isIn(real, folder)) ? readText(uri) : undefined;
  });
  const dependencies = new Set(
    srcs.flatMap((src) => wireframeDependencies(md, src, files[src]).map((path) => resolveDocumentPath(document, path).toString())),
  );
  return { files, dependencies };
}

/**
 * Follows the files of the wireframes of a document (`DocumentWireframes.dependencies`): calls `changed` when one of
 * them is edited, saved, created or deleted, in the workspace or not.
 */
export class WireframeWatcher implements vscode.Disposable {
  private files = new Set<string>();
  private watchers: vscode.Disposable[] = [];
  private readonly listeners: vscode.Disposable;

  constructor(private readonly changed: () => void) {
    const notify = (uri: vscode.Uri): void => {
      if (this.files.has(uri.toString())) {
        this.changed();
      }
    };
    this.listeners = vscode.Disposable.from(
      vscode.workspace.onDidChangeTextDocument((e) => notify(e.document.uri)),
      // Back to the file saved.
      vscode.workspace.onDidCloseTextDocument((document) => notify(document.uri)),
    );
  }

  /** Follows `files` (their URIs) instead of those before. */
  watch(files: Set<string>): void {
    if (files.size === this.files.size && [...files].every((file) => this.files.has(file))) {
      return;
    }
    this.watchers.forEach((watcher) => watcher.dispose());
    this.files = files;
    this.watchers = [...files].map((file) => {
      const uri = vscode.Uri.parse(file);
      // One file: also outside the workspace, unlike a glob.
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), uri.path.split('/').pop() ?? ''));
      return vscode.Disposable.from(watcher, watcher.onDidChange(this.changed), watcher.onDidCreate(this.changed), watcher.onDidDelete(this.changed));
    });
  }

  dispose(): void {
    this.watchers.forEach((watcher) => watcher.dispose());
    this.listeners.dispose();
  }
}
