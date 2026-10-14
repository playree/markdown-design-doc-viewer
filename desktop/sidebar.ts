/**
 * The sidebar of the desktop app: the Markdown files of a folder and of its subfolders, to switch between the
 * documents. Fixed at the left of the window; the body makes room for it (desktop/sidebar.css), and the webview
 * lays out the preview in the width left (`data-seqnotes-inset-left`).
 */
import type { Translate } from '../src/l10n';
import { foldersOf, sortFolder, type FolderNode, type FolderTree } from './folderTree';

/** The width chosen by dragging the edge of the sidebar, kept for the next launch. */
const WIDTH_KEY = 'mdDesignDoc.sidebarWidth';
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;

export interface SidebarOptions {
  t: Translate;
  lang: string;
  /** A file chosen in the list. */
  onOpenFile: (path: string) => void;
  /** The button to choose the folder. */
  onChooseFolder: () => void;
}

export interface Sidebar {
  setShown(shown: boolean): void;
  /** Lists a folder. */
  setTree(tree: FolderTree): void;
  /** The folder could not be listed: `text` says why. */
  setError(folder: string, text: string): void;
  /** The file of the document shown, marked in the list and shown in it (its folders opened). */
  setCurrent(path: string | undefined): void;
}

/** The width chosen for the sidebar, or the default one. */
function savedWidth(): number {
  try {
    return Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** The name of a folder or file, at the end of its path. */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A folder, for the button that chooses one. */
function folderIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M1.5 3.5h4.5l1.5 1.5h7v8h-13z');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/** Adds the sidebar to the page, hidden until `setShown(true)`. */
export function createSidebar({ t, lang, onOpenFile, onChooseFolder }: SidebarOptions): Sidebar {
  const body = document.body;
  const nav = document.createElement('nav');
  nav.className = 'desktop-sidebar';
  nav.hidden = true;
  nav.setAttribute('aria-label', t('Files'));

  const header = document.createElement('div');
  header.className = 'desktop-sidebar-header';
  const title = document.createElement('span');
  title.className = 'desktop-sidebar-title';
  const chooseButton = document.createElement('button');
  chooseButton.type = 'button';
  chooseButton.className = 'desktop-sidebar-choose';
  chooseButton.title = t('Open Folder...');
  chooseButton.setAttribute('aria-label', t('Open Folder...'));
  chooseButton.append(folderIcon());
  chooseButton.addEventListener('click', onChooseFolder);
  header.append(title, chooseButton);

  const content = document.createElement('div');
  content.className = 'desktop-sidebar-content';

  const sash = document.createElement('div');
  sash.className = 'desktop-sidebar-sash';

  nav.append(header, content, sash);
  body.prepend(nav);

  let shown = false;
  let width = savedWidth();
  let tree: FolderTree | undefined;
  let error: { folder: string; text: string } | undefined;
  let current: string | undefined;
  /** The folders opened in the list, by path: kept while the list changes, until another folder is listed. */
  let expanded = new Set<string>();
  /** Opens the folders of the current file once it is listed. */
  let revealCurrent = false;

  /** Makes room for the sidebar, as wide as chosen but at most half the window. */
  function applyWidth(): void {
    if (!shown) {
      body.classList.remove('desktop-sidebar-shown');
      body.style.removeProperty('--desktop-sidebar-width');
      delete body.dataset.seqnotesInsetLeft;
      return;
    }
    const applied = Math.round(Math.max(MIN_WIDTH, Math.min(width, MAX_WIDTH, window.innerWidth / 2)));
    body.style.setProperty('--desktop-sidebar-width', `${applied}px`);
    body.dataset.seqnotesInsetLeft = String(applied);
    body.classList.add('desktop-sidebar-shown');
  }

  window.addEventListener('resize', applyWidth);

  sash.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    sash.setPointerCapture(e.pointerId);
    nav.classList.add('desktop-sidebar-resizing');
  });
  sash.addEventListener('pointermove', (e) => {
    if (sash.hasPointerCapture(e.pointerId)) {
      width = Math.max(MIN_WIDTH, Math.min(e.clientX, MAX_WIDTH));
      applyWidth();
    }
  });
  /** Keeps the width dragged to for the next launch. */
  const endResize = () => {
    if (!nav.classList.contains('desktop-sidebar-resizing')) {
      return;
    }
    nav.classList.remove('desktop-sidebar-resizing');
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // Not kept for the next launch.
    }
  };
  sash.addEventListener('pointerup', endResize);
  sash.addEventListener('lostpointercapture', endResize);

  /** A text in place of the list, or below it. */
  function message(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'desktop-sidebar-message';
    p.textContent = text;
    return p;
  }

  /** A file of the list, `depth` folders below the one listed: opens it when chosen. */
  function fileItem(file: { path: string; name: string }, depth: number): HTMLLIElement {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'desktop-tree-file';
    button.style.setProperty('--desktop-tree-depth', String(depth));
    button.textContent = file.name;
    button.title = file.path;
    if (file.path === current) {
      button.setAttribute('aria-current', 'page');
    }
    button.addEventListener('click', () => onOpenFile(file.path));
    item.append(button);
    return item;
  }

  /** A subfolder of the list, `depth` folders below the one listed, with its files: opens or closes when chosen. */
  function folderItem(folder: FolderNode, depth: number): HTMLLIElement {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'desktop-tree-folder';
    button.style.setProperty('--desktop-tree-depth', String(depth));
    button.textContent = folder.name;
    button.title = folder.path;
    const children = list(folder, depth + 1);
    const setOpen = (open: boolean) => {
      button.setAttribute('aria-expanded', String(open));
      children.hidden = !open;
    };
    setOpen(expanded.has(folder.path));
    button.addEventListener('click', () => {
      const open = !expanded.has(folder.path);
      if (open) {
        expanded.add(folder.path);
      } else {
        expanded.delete(folder.path);
      }
      setOpen(open);
    });
    item.append(button, children);
    return item;
  }

  /** The subfolders and files of `folder`, `depth` folders below the one listed. */
  function list(folder: FolderNode, depth: number): HTMLUListElement {
    const ul = document.createElement('ul');
    ul.append(...folder.folders.map((sub) => folderItem(sub, depth)), ...folder.files.map((file) => fileItem(file, depth)));
    return ul;
  }

  /** Shows the folder: its list, or why there is none. Keeps the scroll position of the list. */
  function render(): void {
    title.textContent = tree?.root.name ?? (error ? baseName(error.folder) : t('No Folder'));
    title.title = tree?.root.path ?? error?.folder ?? '';
    if (tree && current && revealCurrent) {
      const folders = foldersOf(tree.root, current);
      if (folders.length > 0 || tree.root.files.some((file) => file.path === current)) {
        folders.forEach((path) => expanded.add(path));
        revealCurrent = false;
      }
    }
    const scrollTop = content.scrollTop;
    content.replaceChildren();
    if (error) {
      content.append(message(error.text));
    } else if (!tree) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'desktop-sidebar-button';
      button.textContent = t('Open Folder...');
      button.addEventListener('click', onChooseFolder);
      content.append(message(t('No folder is open.')), button);
    } else if (tree.root.folders.length === 0 && tree.root.files.length === 0) {
      content.append(message(t('There are no Markdown files in this folder.')));
    } else {
      content.append(list(tree.root, 0));
      if (tree.truncated) {
        content.append(message(t('The folder has too many files: some of them are not listed.')));
      }
      if (!tree.watching) {
        content.append(message(t('The changes of the folder are not shown. Hide and show the sidebar to list it again.')));
      }
    }
    content.scrollTop = scrollTop;
  }

  /** Scrolls the list to the current file. By hand: scrollIntoView could scroll the preview too. */
  function scrollToCurrent(): void {
    const item = content.querySelector<HTMLElement>('[aria-current]');
    if (!item) {
      return;
    }
    const top = item.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
    if (top < content.scrollTop) {
      content.scrollTop = top;
    } else if (top + item.offsetHeight > content.scrollTop + content.clientHeight) {
      content.scrollTop = top + item.offsetHeight - content.clientHeight;
    }
  }

  render();

  return {
    setShown(value) {
      shown = value;
      nav.hidden = !value;
      applyWidth();
      if (value) {
        scrollToCurrent();
      }
    },
    setTree(value) {
      const sorted = { ...value, root: sortFolder(value.root, lang) };
      if (sorted.root.path !== tree?.root.path) {
        expanded = new Set();
        revealCurrent = true;
      }
      tree = sorted;
      error = undefined;
      const reveal = revealCurrent;
      render();
      if (reveal) {
        scrollToCurrent();
      }
    },
    setError(folder, text) {
      tree = undefined;
      error = { folder, text };
      render();
    },
    setCurrent(path) {
      if (path === current) {
        return;
      }
      current = path;
      revealCurrent = true;
      render();
      scrollToCurrent();
    },
  };
}
