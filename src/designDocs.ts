/**
 * The design documents of the workspace (Markdown files with `type: design_doc` in their front matter), for their
 * list (designDocsPanel.ts) and the tree of the Explorer (designDocsView.ts). Read again when a Markdown file
 * changes, but only once one of them asks for them.
 */
import * as vscode from 'vscode';
import { documentInfo, mayHaveFrontMatter, type DocumentInfo } from './exportIndex';
import { createMarkdown } from './render';

const MARKDOWN_GLOB = '**/*.{md,markdown}';
/** The changes of the files are gathered for this long before the list is read again. */
const CHANGE_DELAY_MS = 300;
/** How many files are read at once. */
const READ_BATCH = 64;

export interface DesignDoc extends Omit<DocumentInfo, 'designDoc'> {
  uri: vscode.Uri;
  /** Path from the workspace folder, with `/` (from the workspaces with their names in a multi-root workspace). */
  path: string;
  /** Folder of `path` (`''` at the top). */
  folder: string;
  /** File name. */
  file: string;
}

/**
 * The files not looked into: those of `files.exclude`, and as in the desktop app and the command line, node_modules
 * and the folders starting with a dot.
 */
function excludePattern(): string {
  const excluded = vscode.workspace.getConfiguration('files').get<Record<string, unknown>>('exclude') ?? {};
  const globs = ['**/node_modules/**', '**/.*/**', ...Object.keys(excluded).filter((glob) => excluded[glob] === true)];
  return `{${globs.join(',')}}`;
}

export class DesignDocIndex implements vscode.Disposable {
  private readonly md = createMarkdown();
  private readonly changed = new vscode.EventEmitter<void>();
  /** The list of the design documents changed: read it again with `designDocs()`. */
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];
  /** The list read, or being read; undefined once a file changed. */
  private reading: Promise<DesignDoc[]> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher(MARKDOWN_GLOB);
    const change = () => this.scheduleChange();
    this.disposables.push(
      watcher,
      watcher.onDidCreate(change),
      watcher.onDidChange(change),
      watcher.onDidDelete(change),
      vscode.workspace.onDidChangeWorkspaceFolders(change),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('files.exclude')) {
          change();
        }
      }),
    );
  }

  /** The design documents of the workspace, by path. */
  designDocs(): Promise<DesignDoc[]> {
    this.reading ??= this.read();
    return this.reading;
  }

  /** Reads the list again (the Refresh button), e.g. after changes not seen by the watcher. */
  refresh(): void {
    clearTimeout(this.timer);
    this.reading = undefined;
    this.changed.fire();
  }

  private scheduleChange(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), CHANGE_DELAY_MS);
  }

  private async read(): Promise<DesignDoc[]> {
    const uris = await vscode.workspace.findFiles(MARKDOWN_GLOB, excludePattern());
    const decoder = new TextDecoder();
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    const readDoc = async (uri: vscode.Uri): Promise<DesignDoc | undefined> => {
      let source: string;
      try {
        source = decoder.decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        // Deleted meanwhile, or not readable.
        return undefined;
      }
      if (!mayHaveFrontMatter(source)) {
        return undefined;
      }
      const path = vscode.workspace.asRelativePath(uri, multiRoot);
      const slash = path.lastIndexOf('/');
      const file = path.slice(slash + 1);
      // With the entries of the front matter even when the preview hides it (`mdDesignDoc.frontMatter`): they are
      // what the list is for.
      const { designDoc, ...info } = documentInfo(this.md, source, file);
      return designDoc ? { ...info, uri, path, folder: slash < 0 ? '' : path.slice(0, slash), file } : undefined;
    };
    const docs: DesignDoc[] = [];
    for (let i = 0; i < uris.length; i += READ_BATCH) {
      for (const doc of await Promise.all(uris.slice(i, i + READ_BATCH).map(readDoc))) {
        if (doc) {
          docs.push(doc);
        }
      }
    }
    return docs.sort((a, b) => a.path.localeCompare(b.path));
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
