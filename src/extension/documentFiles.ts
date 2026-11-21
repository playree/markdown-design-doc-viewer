/**
 * The files a Markdown document uses besides itself, for its preview, its export and its diagnostics: the paths of its
 * images and links, and its wireframes (src/markdown/wireframe.ts).
 */
import type { MarkdownIt, Token } from 'markdown-it';
import { realpath } from 'node:fs/promises';
import * as vscode from 'vscode';
import { createMarkdown } from '../markdown/render';
import { attachWireframes, loadWireframes, wireframeDependencies, wireframeSources, type WireframeFiles } from '../markdown/wireframe';
import { DocumentCache, FreshComputations, RetainedFiles } from './documentCache';

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

/** The folders of `embeddableFolders`, with their symbolic links resolved (those that cannot be are left out). */
export async function realEmbeddableFolders(document: vscode.Uri): Promise<vscode.Uri[]> {
  return (await Promise.all(embeddableFolders(document).map(realUri))).filter((folder) => folder !== undefined);
}

/**
 * `uri` with its symbolic links resolved when it is in one of `folders` (from `realEmbeddableFolders`), else undefined:
 * compared by their real paths, so that a link in the folders does not let a file out of them be read.
 */
export async function embeddableFile(uri: vscode.Uri, folders: vscode.Uri[]): Promise<vscode.Uri | undefined> {
  const real = await realUri(uri);
  return real && folders.some((folder) => isIn(real, folder)) ? real : undefined;
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

/**
 * Reads the wireframes `srcs` of `document` and their style sheets with `read`, from the folders of `embeddableFolders`.
 * Without wireframes, nothing is looked at.
 */
async function loadDocumentWireframes(
  md: MarkdownIt,
  document: vscode.Uri,
  srcs: string[],
  read: (uri: vscode.Uri) => Promise<string | undefined>,
): Promise<DocumentWireframes> {
  if (srcs.length === 0) {
    return { files: {}, dependencies: new Set() };
  }
  const folders = await realEmbeddableFolders(document);
  const files = await loadWireframes(md, srcs, async (path) => {
    const uri = resolveDocumentPath(document, path);
    return (await embeddableFile(uri, folders)) ? read(uri) : undefined;
  });
  const dependencies = new Set(
    srcs.flatMap((src) => wireframeDependencies(md, src, files[src]).map((path) => resolveDocumentPath(document, path).toString())),
  );
  return { files, dependencies };
}

/** Reads the wireframes of `document` (`source`) and their style sheets, from the folders of `embeddableFolders`. */
export function readWireframes(md: MarkdownIt, document: vscode.Uri, source: string): Promise<DocumentWireframes> {
  return loadDocumentWireframes(md, document, wireframeSources(md.parse(source, {})), readText);
}

/** What the preview and the diagnostics need of a version of a document (`DocumentAnalyzer`). */
export interface DocumentAnalysis extends DocumentWireframes {
  /**
   * The document parsed with its wireframes, as with `{ t: vscode.l10n.t, wireframes: files }`. Shared: only to be
   * read (e.g. by `issuesOf`), not rendered, which changes the tokens.
   */
  tokens: Token[];
}

/**
 * Parses the documents and reads their wireframes once for the preview and the diagnostics: keeps them until the
 * document or one of the files of its wireframes changes. Keeps the text of those files too while something follows
 * their changes (`WireframeWatcher`), so that they are not read again at each edit of the document while they are
 * not modified.
 */
export class DocumentAnalyzer implements vscode.Disposable {
  private readonly md = createMarkdown();
  private readonly analyses = new DocumentCache<Promise<DocumentAnalysis>>();
  /** The analyses under way, done again when one of their files changes meanwhile. */
  private readonly computations = new FreshComputations();
  /**
   * The text of the files of the wireframes read from the disk, by their URI, with the time they were modified and
   * their size then: read again when those differ, also when the change was not seen by the watchers.
   */
  private readonly texts = new RetainedFiles<{ mtime: number; size: number; text: Promise<string | undefined> }>();
  /** Follow the changes of the files of `texts` on the disk. */
  private readonly watchers = new Map<string, vscode.Disposable>();
  private readonly fileChanged = new vscode.EventEmitter<string>();
  /** A file of the wireframes followed (`retain`), by its URI, was edited, saved, created or deleted. */
  readonly onDidChangeFile = this.fileChanged.event;
  private readonly listeners: vscode.Disposable;

  constructor() {
    this.listeners = vscode.Disposable.from(
      this.fileChanged,
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length > 0) {
          this.changed(e.document.uri.toString());
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        const key = document.uri.toString();
        // Opened again, its versions start over.
        this.analyses.delete(key);
        // Back to the file saved.
        this.changed(key);
      }),
      // The files a wireframe may be read from (`embeddableFolders`) changed.
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.analyses.clear()),
    );
  }

  /** The analysis of `document` as it is now. */
  analyze(document: vscode.TextDocument): Promise<DocumentAnalysis> {
    const key = document.uri.toString();
    const { version } = document;
    const kept = this.analyses.get(key, version);
    const dependencies = this.analyses.dependencies(key, version);
    // Unless its files may have changed unseen: not all followed (e.g. those of an update that was replaced).
    if (kept && (!dependencies || [...dependencies].every((file) => this.texts.isRetained(file)))) {
      return kept;
    }
    const source = document.getText();
    const analysis: Promise<DocumentAnalysis> = this.computations
      .run(() => this.read(document.uri, source), (result) => result.dependencies)
      .then(({ value, stale }) => {
        if (stale.length > 0) {
          // Its files kept changing: not kept, and its callers told once they follow the files of the result (after
          // their `await`), so that they analyze it again.
          this.analyses.delete(key, analysis);
          setTimeout(() => stale.forEach((file) => this.fileChanged.fire(file)));
        }
        return value;
      });
    this.analyses.set(key, version, analysis);
    analysis.then(
      ({ dependencies }) => this.analyses.setDependencies(key, analysis, dependencies),
      () => this.analyses.delete(key, analysis),
    );
    return analysis;
  }

  /** Follows the changes of `files` (`onDidChangeFile`), and keeps their text meanwhile, for one more holder. */
  retain(files: Iterable<string>): void {
    for (const file of this.texts.retain(files)) {
      // It may have changed while it was not followed.
      this.analyses.invalidate(file);
      const uri = vscode.Uri.parse(file);
      // One file: also outside the workspace, unlike a glob. Its name as a glob: with the characters of the patterns in brackets.
      const name = (uri.path.split('/').pop() ?? '').replace(/[[{}*?]/g, '[$&]');
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), name));
      const changed = (): void => this.changed(file);
      this.watchers.set(file, vscode.Disposable.from(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed)));
    }
  }

  /** Undoes `retain` for one holder of `files`. */
  release(files: Iterable<string>): void {
    for (const file of this.texts.release(files)) {
      this.watchers.get(file)?.dispose();
      this.watchers.delete(file);
    }
  }

  dispose(): void {
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers.clear();
    this.listeners.dispose();
  }

  private async read(document: vscode.Uri, source: string): Promise<DocumentAnalysis> {
    const tokens = this.md.parse(source, { t: vscode.l10n.t });
    const wireframes = await loadDocumentWireframes(this.md, document, wireframeSources(tokens), (uri) => this.readText(uri));
    attachWireframes(this.md, tokens, wireframes.files);
    return { tokens, ...wireframes };
  }

  /** `readText`, with the text read from the disk kept while the file is followed and not modified. */
  private async readText(uri: vscode.Uri): Promise<string | undefined> {
    const key = uri.toString();
    // An editor's text, with the changes not saved yet: not kept, as it is at hand.
    if (vscode.workspace.textDocuments.some((d) => d.uri.toString() === key)) {
      return readText(uri);
    }
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      return undefined;
    }
    const kept = this.texts.get(key);
    if (kept?.mtime === stat.mtime && kept.size === stat.size) {
      return kept.text;
    }
    const text = readText(uri);
    const entry = { mtime: stat.mtime, size: stat.size, text };
    this.texts.set(key, entry);
    // Read again next time after a failure, which may not last (unless another reading replaced it).
    void text.then((value) => {
      if (value === undefined && this.texts.get(key) === entry) {
        this.texts.delete(key);
      }
    });
    return text;
  }

  /** A file changed: the analyses made with it are dropped, and those that follow it told. */
  private changed(file: string): void {
    this.computations.changed(file);
    this.analyses.invalidate(file);
    if (this.texts.isRetained(file)) {
      this.texts.delete(file);
      this.fileChanged.fire(file);
    }
  }
}

/**
 * Follows the files of the wireframes of a document (`DocumentWireframes.dependencies`): calls `changed` when one of
 * them is edited, saved, created or deleted, in the workspace or not.
 */
export class WireframeWatcher implements vscode.Disposable {
  private files = new Set<string>();
  private readonly listener: vscode.Disposable;

  constructor(
    private readonly analyzer: DocumentAnalyzer,
    changed: () => void,
  ) {
    this.listener = analyzer.onDidChangeFile((file) => {
      if (this.files.has(file)) {
        changed();
      }
    });
  }

  /** Follows `files` (their URIs) instead of those before. */
  watch(files: Set<string>): void {
    if (files.size === this.files.size && [...files].every((file) => this.files.has(file))) {
      return;
    }
    // Before releasing the others, so that the text of the files still used is kept.
    this.analyzer.retain(files);
    this.analyzer.release(this.files);
    this.files = files;
  }

  dispose(): void {
    this.listener.dispose();
    this.analyzer.release(this.files);
    this.files = new Set();
  }
}
