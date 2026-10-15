/**
 * The sidebar of the desktop app, in two tabs: the Markdown files of a folder and of its subfolders, to switch between
 * the documents, and the git history of the document, to compare it with one of its commits. Fixed at the left of
 * the window; the body makes room for it (desktop/sidebar.css), and the webview lays out the preview in the width left
 * (`data-seqnotes-inset-left`).
 */
import { formatRevisionDate, type Revision } from '../src/gitLog';
import type { Translate } from '../src/l10n';
import { foldersOf, sortFolder, type FolderNode, type FolderTree } from './folderTree';

export type SidebarTab = 'files' | 'history';

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
  /** Another tab chosen. */
  onTabChange: (tab: SidebarTab) => void;
  /** A commit chosen in the history. */
  onSelectRevision: (revision: Revision) => void;
  /** The button to read the history again. */
  onReloadHistory: () => void;
}

export interface Sidebar {
  setShown(shown: boolean): void;
  /** The tab shown: the files when the sidebar is created. */
  tab(): SidebarTab;
  /** Lists a folder. */
  setTree(tree: FolderTree): void;
  /** The folder could not be listed: `text` says why. */
  setError(folder: string, text: string): void;
  /** The file of the document shown, marked in the list and shown in it (its folders opened). */
  setCurrent(path: string | undefined): void;
  /**
   * The history of the document `name` (none without a document): its commits, the latest first, or a text in their
   * place (being read, or why there are none).
   */
  setHistory(name: string | undefined, history: Revision[] | string): void;
  /** The commit the document is compared with, marked in the history. */
  setComparedRevision(hash: string | undefined): void;
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

/** An icon of the buttons of the headers, drawn with the path `d`. */
function icon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  return svg;
}

/** A folder, for the button that chooses one. */
const FOLDER_ICON = 'M1.5 3.5h4.5l1.5 1.5h7v8h-13z';
/** A circular arrow, for the button that reads the history again. */
const RELOAD_ICON = 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3';

/** A button of a header, with an icon and its title. */
function headerButton(title: string, d: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'desktop-sidebar-icon-button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(icon(d));
  button.addEventListener('click', onClick);
  return button;
}

/** The header of a tab: a title, and a button. */
function header(button: HTMLButtonElement): { element: HTMLElement; title: HTMLElement } {
  const element = document.createElement('div');
  element.className = 'desktop-sidebar-header';
  const title = document.createElement('span');
  title.className = 'desktop-sidebar-title';
  element.append(title, button);
  return { element, title };
}

/** Adds the sidebar to the page, hidden until `setShown(true)`. */
export function createSidebar({ t, lang, onOpenFile, onChooseFolder, onTabChange, onSelectRevision, onReloadHistory }: SidebarOptions): Sidebar {
  const body = document.body;
  const nav = document.createElement('nav');
  nav.className = 'desktop-sidebar';
  nav.hidden = true;
  nav.setAttribute('aria-label', t('Sidebar'));

  const tabList = document.createElement('div');
  tabList.className = 'desktop-sidebar-tabs';
  tabList.setAttribute('role', 'tablist');

  /** A tab and its panel. */
  function tabPanel(name: SidebarTab, label: string, panelHeader: HTMLElement) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'desktop-sidebar-tab';
    tab.id = `desktop-sidebar-tab-${name}`;
    tab.textContent = label;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `desktop-sidebar-panel-${name}`);
    tab.addEventListener('click', () => selectTab(name));
    const panel = document.createElement('div');
    panel.className = 'desktop-sidebar-panel';
    panel.id = `desktop-sidebar-panel-${name}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    const content = document.createElement('div');
    content.className = 'desktop-sidebar-content';
    panel.append(panelHeader, content);
    tabList.append(tab);
    return { tab, panel, content };
  }

  const filesHeader = header(headerButton(t('Open Folder...'), FOLDER_ICON, onChooseFolder));
  const title = filesHeader.title;
  const files = tabPanel('files', t('Files'), filesHeader.element);
  const content = files.content;

  const reloadButton = headerButton(t('Reload'), RELOAD_ICON, onReloadHistory);
  const historyHeader = header(reloadButton);
  const history = tabPanel('history', t('History'), historyHeader.element);

  const tabs: Record<SidebarTab, { tab: HTMLButtonElement; panel: HTMLElement }> = { files, history };
  // Left and right go from one tab to the other.
  tabList.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next: SidebarTab = currentTab === 'files' ? 'history' : 'files';
      selectTab(next);
      tabs[next].tab.focus();
    }
  });

  const sash = document.createElement('div');
  sash.className = 'desktop-sidebar-sash';

  nav.append(tabList, files.panel, history.panel, sash);
  body.prepend(nav);

  let currentTab: SidebarTab = 'files';
  let shown = false;
  let width = savedWidth();
  let tree: FolderTree | undefined;
  let error: { folder: string; text: string } | undefined;
  let current: string | undefined;
  /** The folders opened in the list, by path: kept while the list changes, until another folder is listed. */
  let expanded = new Set<string>();
  /** Opens the folders of the current file once it is listed. */
  let revealCurrent = false;
  /** The document whose history is shown, and its history (see `setHistory`). */
  let historyName: string | undefined;
  let revisions: Revision[] | string = '';
  /** The commit compared with. */
  let compared: string | undefined;

  /** Shows the tab `name`, and tells it when it is another one. */
  function selectTab(name: SidebarTab): void {
    if (name === currentTab) {
      return;
    }
    currentTab = name;
    applyTab();
    if (name === 'files') {
      scrollToCurrent();
    }
    onTabChange(name);
  }

  function applyTab(): void {
    for (const [name, { tab, panel }] of Object.entries(tabs)) {
      const selected = name === currentTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
    }
  }

  applyTab();

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
    } else {
      const empty = tree.root.folders.length === 0 && tree.root.files.length === 0;
      content.append(empty ? message(t('There are no Markdown files in this folder.')) : list(tree.root, 0));
      // Also below an empty list: the files added may be in the part not listed, or not shown.
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

  /** A commit of the history: its subject, then its short hash, author and date. Compares the document with it when chosen. */
  function revisionItem(revision: Revision): HTMLLIElement {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'desktop-history-revision';
    const subject = document.createElement('span');
    subject.className = 'desktop-history-subject';
    subject.textContent = revision.subject;
    const details = document.createElement('span');
    details.className = 'desktop-history-details';
    details.textContent = `${revision.shortHash} · ${revision.author} · ${formatRevisionDate(revision.date, lang)}`;
    button.title = `${revision.subject}\n${revision.hash}`;
    if (revision.hash === compared) {
      button.setAttribute('aria-current', 'true');
    }
    button.append(subject, details);
    button.addEventListener('click', () => onSelectRevision(revision));
    item.append(button);
    return item;
  }

  /** Shows the history: its commits, or the text in their place. Keeps the scroll position of the list. */
  function renderHistory(): void {
    historyHeader.title.textContent = historyName ?? '';
    historyHeader.title.title = historyName ?? '';
    reloadButton.disabled = historyName === undefined;
    const scrollTop = history.content.scrollTop;
    history.content.replaceChildren();
    if (typeof revisions === 'string') {
      history.content.append(message(revisions));
    } else {
      const ul = document.createElement('ul');
      ul.append(...revisions.map(revisionItem));
      history.content.append(ul);
    }
    history.content.scrollTop = scrollTop;
  }

  render();
  renderHistory();

  return {
    setShown(value) {
      shown = value;
      nav.hidden = !value;
      applyWidth();
      if (value) {
        scrollToCurrent();
      }
    },
    tab: () => currentTab,
    setHistory(name, value) {
      if (name !== historyName) {
        history.content.scrollTop = 0;
      }
      historyName = name;
      revisions = value;
      renderHistory();
    },
    setComparedRevision(hash) {
      if (hash !== compared) {
        compared = hash;
        renderHistory();
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
