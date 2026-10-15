/**
 * The design documents of the workspace (Markdown files with `type: design_doc` in their front matter), for their
 * list (designDocsPanel.ts) and the tree of the Explorer (designDocsView.ts). Read once one of them asks for them,
 * then only the files that changed; the workspace is looked through again when files are added, deleted or renamed.
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
  /** Path from the workspace folder, with `/` (after the name of the workspace folder in a multi-root workspace). */
  path: string;
  /** Folder of `path` (`''` at the top). */
  folder: string;
  /** File name. */
  file: string;
}

/** A Markdown file of the workspace, and the design document it is (none for the others, or until it is read). */
interface MarkdownFile {
  uri: vscode.Uri;
  doc?: DesignDoc;
}

/** Whether a path from a workspace folder is in node_modules or in a folder starting with a dot, as the desktop app and the command line skip them. */
function isSkipped(path: string): boolean {
  return path
    .split('/')
    .slice(0, -1)
    .some((name) => name === 'node_modules' || name.startsWith('.'));
}

/** The names of the workspace folders in the paths, by their URI: numbered when two have the same name. */
function rootNames(): Map<string, string> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const twice = (name: string) => folders.filter((folder) => folder.name === name).length > 1;
  return new Map(folders.map((folder) => [folder.uri.toString(), twice(folder.name) ? `${folder.name} (${folder.index + 1})` : folder.name]));
}

export class DesignDocIndex implements vscode.Disposable {
  private readonly md = createMarkdown();
  private readonly changed = new vscode.EventEmitter<void>();
  /** The list of the design documents changed: read it again with `designDocs()`. */
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];
  /** The Markdown files of the workspace by URI; undefined until the workspace is looked through (again). */
  private files: Map<string, MarkdownFile> | undefined;
  /** The files of `files` changed since they were read. */
  private readonly changedFiles = new Set<string>();
  /** The list read, or being read; undefined once a file changed. */
  private reading: Promise<DesignDoc[]> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher(MARKDOWN_GLOB);
    const lookAgain = () => {
      this.files = undefined;
      this.scheduleChange();
    };
    this.disposables.push(
      watcher,
      watcher.onDidChange((uri) => {
        if (this.files?.has(uri.toString())) {
          this.changedFiles.add(uri.toString());
          this.scheduleChange();
        }
      }),
      // A file added may be one of `files.exclude`, which only a search tells.
      watcher.onDidCreate(lookAgain),
      watcher.onDidDelete((uri) => {
        if (this.files?.delete(uri.toString())) {
          this.scheduleChange();
        }
      }),
      // Also the folders deleted or renamed in VS Code, which the watcher of the Markdown files does not see.
      vscode.workspace.onDidDeleteFiles(lookAgain),
      vscode.workspace.onDidRenameFiles(lookAgain),
      vscode.workspace.onDidChangeWorkspaceFolders(lookAgain),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('files.exclude')) {
          lookAgain();
        }
      }),
    );
  }

  /** The design documents of the workspace, by path. */
  designDocs(): Promise<DesignDoc[]> {
    if (!this.reading) {
      const reading = this.read();
      // Read again next time after a failure.
      reading.catch(() => {
        if (this.reading === reading) {
          this.reading = undefined;
        }
      });
      this.reading = reading;
    }
    return this.reading;
  }

  /** Looks through the workspace again (the Refresh button), e.g. after changes not seen by the watcher. */
  refresh(): void {
    clearTimeout(this.timer);
    this.files = undefined;
    this.reading = undefined;
    this.changed.fire();
  }

  private scheduleChange(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.reading = undefined;
      this.changed.fire();
    }, CHANGE_DELAY_MS);
  }

  private async read(): Promise<DesignDoc[]> {
    let files = this.files;
    let toRead: MarkdownFile[];
    if (files) {
      toRead = [...this.changedFiles].flatMap((key) => files!.get(key) ?? []);
    } else {
      // The files of `files.exclude` are left out by the search.
      const uris = await vscode.workspace.findFiles(MARKDOWN_GLOB);
      files = new Map(uris.filter((uri) => !isSkipped(vscode.workspace.asRelativePath(uri, false))).map((uri) => [uri.toString(), { uri }]));
      this.files = files;
      toRead = [...files.values()];
    }
    this.changedFiles.clear();
    const roots = rootNames();
    for (let i = 0; i < toRead.length; i += READ_BATCH) {
      await Promise.all(
        toRead.slice(i, i + READ_BATCH).map(async (file) => {
          file.doc = await this.readDoc(file.uri, roots);
        }),
      );
    }
    return [...files.values()].flatMap((file) => file.doc ?? []).sort((a, b) => a.path.localeCompare(b.path));
  }

  /** The design document a file is, if any. */
  private async readDoc(uri: vscode.Uri, roots: Map<string, string>): Promise<DesignDoc | undefined> {
    let source: string;
    try {
      source = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      // Deleted meanwhile, or not readable.
      return undefined;
    }
    if (!mayHaveFrontMatter(source)) {
      return undefined;
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const relative = vscode.workspace.asRelativePath(uri, false);
    const path = folder && roots.size > 1 ? `${roots.get(folder.uri.toString()) ?? folder.name}/${relative}` : relative;
    const slash = path.lastIndexOf('/');
    const file = path.slice(slash + 1);
    // With the entries of the front matter even when the preview hides it (`mdDesignDoc.frontMatter`): they are
    // what the list is for.
    const { designDoc, ...info } = documentInfo(this.md, source, file);
    return designDoc ? { ...info, uri, path, folder: slash < 0 ? '' : path.slice(0, slash), file } : undefined;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
