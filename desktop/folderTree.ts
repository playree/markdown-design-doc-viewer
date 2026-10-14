/**
 * The Markdown files of a folder, as the sidebar of the desktop app lists them (`open_folder` in src-tauri/src/lib.rs).
 * Without the DOM, so that it is tested on its own.
 */

/** A Markdown file of a folder. */
export interface FileNode {
  path: string;
  name: string;
}

/** A folder and the Markdown files below it: only the subfolders that have some. */
export interface FolderNode {
  path: string;
  name: string;
  folders: FolderNode[];
  files: FileNode[];
}

/** What `open_folder` returns. */
export interface FolderTree {
  root: FolderNode;
  /** true when the folder has too many files or subfolders to list them all. */
  truncated: boolean;
}

/**
 * The folder with its subfolders and files sorted by name, as a file manager does: ignoring the case, and with the
 * numbers in the order of their values (`2-login.md` before `10-logout.md`).
 */
export function sortFolder(folder: FolderNode, lang: string): FolderNode {
  const collator = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' });
  const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const sort = (node: FolderNode): FolderNode => ({
    ...node,
    folders: node.folders.map(sort).sort(byName),
    files: [...node.files].sort(byName),
  });
  return sort(folder);
}

/** The folders of `folder` (itself excluded) that the file `path` is in, from the top: those to open to show it. */
export function foldersOf(folder: FolderNode, path: string): string[] {
  for (const sub of folder.folders) {
    if (sub.files.some((file) => file.path === path)) {
      return [sub.path];
    }
    const below = foldersOf(sub, path);
    if (below.length > 0) {
      return [sub.path, ...below];
    }
  }
  return [];
}
