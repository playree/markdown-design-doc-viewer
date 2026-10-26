/**
 * The files a Markdown document uses besides itself, for its preview, its export and its diagnostics: the paths of its
 * images and links, and its wireframes (src/wireframe.ts).
 */
import type { MarkdownIt } from 'markdown-it';
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
  const folders = embeddableFolders(document);
  const srcs = wireframeSources(md.parse(source, {}));
  const files = await loadWireframes(srcs, async (path) => {
    const uri = resolveDocumentPath(document, path);
    return folders.some((folder) => isIn(uri, folder)) ? readText(uri) : undefined;
  });
  const dependencies = new Set(srcs.flatMap((src) => wireframeDependencies(src, files[src]).map((path) => resolveDocumentPath(document, path).toString())));
  return { files, dependencies };
}

/**
 * Calls `changed` with the URI of a file of a wireframe (HTML or CSS) that changed: edited, saved, created or deleted.
 */
export function onWireframeFileChanged(changed: (uri: string) => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{html,htm,css}');
  const notify = (uri: vscode.Uri): void => changed(uri.toString());
  return vscode.Disposable.from(
    watcher,
    watcher.onDidChange(notify),
    watcher.onDidCreate(notify),
    watcher.onDidDelete(notify),
    vscode.workspace.onDidChangeTextDocument((e) => notify(e.document.uri)),
    // Back to the file saved.
    vscode.workspace.onDidCloseTextDocument((document) => notify(document.uri)),
  );
}
