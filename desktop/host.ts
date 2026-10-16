/**
 * The desktop app's side of the preview, in place of the extension host (Preview in src/previewPanel.ts): opens a
 * Markdown file through the Rust commands (src-tauri/src/lib.rs), renders it with `renderDocument` and sends it to
 * the webview, and follows its changes. Also the sidebar of the files of its folder and of its git history, with
 * which it is compared (`renderDiff`) (sidebar.ts), the menu, the files opened recently, the dropped files, the theme
 * and the HTML export.
 *
 * Each window of the app runs its own copy: the app opens a window for each file given to it while it runs.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, message, open } from '@tauri-apps/plugin-dialog';
import { renderDiff } from '../src/diffRender';
import { documentInfo, indexBody, NO_DESIGN_DOCS, type IndexEntry } from '../src/exportIndex';
import { documentTitle, exportFileName, exportPage, imageType, renderForExport, stripSourceMap } from '../src/exportPage';
import { formatRevisionDate, parseGitLog, type Revision } from '../src/gitLog';
import type { DiffView, FromWebview, PreviewTheme, ToWebview } from '../src/protocol';
import { createMarkdown, escapeHtml, renderDocument, type RenderEnv } from '../src/render';
import type { FolderTree } from './folderTree';
import { lang, t } from './l10n';
import { isInside, isMarkdownPath, linkTarget, relativeLink, resourcePath, splitPath } from './paths';
import { addRecentFile, menuText, parseRecentFiles, removeRecentFile } from './recentFiles';
import { createSidebar, type Branches } from './sidebar';

const APP_NAME = 'Markdown Design Doc Viewer';

/** What `open_document` returns. */
interface OpenedDocument {
  /** The absolute path, without symbolic links. */
  path: string;
  /** Its folder, from which the links and images are resolved. */
  dir: string;
  name: string;
  text: string;
}

/** The settings of the extension, at their defaults. The theme is chosen with the body class (`applyTheme`). */
const SETTINGS = {
  splitMinWidth: 1000,
  // No editor to follow.
  syncEditor: false,
  toc: true,
  diagramLook: 'neo',
  theme: 'auto',
  limitContentWidth: true,
  stickyTableHeader: true,
  tableTreeHighlight: true,
} as const;

/** What `read_design_docs` returns: the Markdown files of a folder that start with a front matter. */
interface FileHeads {
  files: { path: string; name: string; folder: string; head: string }[];
  truncated: boolean;
}

/** The settings of the extension that apply to the rendering of the documents, at their defaults. */
const RENDER_SETTINGS = { frontMatter: true, headingNumbers: true } as const;

/** The document of the window, kept across reloads of the page (F5) in the session. */
const DOCUMENT_KEY = 'mdDesignDoc.document';
/** The folder of the window's sidebar, kept across reloads of the page (F5) in the session. */
const FOLDER_KEY = 'mdDesignDoc.folder';
const THEME_KEY = 'mdDesignDoc.theme';
/** Whether the sidebar is shown, kept for the next launch. */
const SIDEBAR_KEY = 'mdDesignDoc.sidebar';

const md = createMarkdown();
const appWindow = getCurrentWindow();
const empty = document.getElementById('desktop-empty')!;

let ready = false;
let current: OpenedDocument | undefined;
/** The heading of the document to scroll to on its first render (the fragment of the link that opened it). */
let pendingFragment: { path: string; fragment: string } | undefined;
/** Renders one at a time, so that the updates reach the webview in order. */
let rendering: Promise<void> = Promise.resolve();
/** The commit of the document it is compared with (chosen in the History tab), whose differences are shown. */
let comparison: { path: string; hash: string; label: string; source: string } | undefined;
/** Whether the window shows the list of the design documents of the folder (View > Design Docs) in place of a document. */
let listShown = false;
/**
 * The document of the window, when it is missing: not in the branch its repository was switched to (here, or
 * elsewhere, which removed it). It stays the
 * document of the window, so that the branch can be switched back, and is shown again once it is read again.
 */
let missing: string | undefined;

export function onWebviewMessage(message: FromWebview): void {
  switch (message.type) {
    case 'ready':
      ready = true;
      updateExportItem();
      render();
      break;
    case 'openLink':
      void openLink(message.href);
      break;
    case 'exported': {
      const pending = pendingExports.get(message.id);
      if (message.body !== undefined) {
        pending?.resolve(message.body);
      } else {
        pending?.reject(new Error(message.error ?? ''));
      }
      break;
    }
    case 'closeDiff':
      stopComparing();
      break;
    // `revealLine` is not sent without an editor (syncEditor).
  }
}

function post(message: ToWebview): void {
  window.postMessage(message, '*');
}

function render(): void {
  rendering = rendering.then(renderNow).catch((error: unknown) => console.error(error));
}

async function renderNow(): Promise<void> {
  if (ready && listShown) {
    await renderDesignDocs();
    return;
  }
  const doc = current;
  // Rendered when the webview is ready.
  if (!ready || !doc) {
    return;
  }
  if (missing === doc.path) {
    post({ type: 'update', uri: doc.path, html: `<p>${escapeHtml(t('{0} was not found. It may not be in the branch checked out.', doc.name))}</p>`, ...SETTINGS });
    return;
  }
  const fragment = pendingFragment?.path === doc.path ? pendingFragment.fragment : undefined;
  pendingFragment = undefined;
  const images: string[] = [];
  const env: RenderEnv = {
    t,
    ...RENDER_SETTINGS,
    resolveResource: (src) => {
      const path = resourcePath(doc.dir, src);
      if (path === undefined) {
        return src;
      }
      images.push(path);
      return convertFileSrc(path);
    },
  };
  // Also the changes of the file made meanwhile.
  const compared = comparison?.path === doc.path ? comparison : undefined;
  let html: string;
  let diff: DiffView | undefined;
  if (compared) {
    const result = renderDiff(md, compared.source, doc.text, env);
    html = result.html;
    diff = { label: compared.label, old: result.old, stats: result.stats };
  } else {
    html = renderDocument(md, doc.text, env);
  }
  if (images.length > 0) {
    // The asset protocol serves only the files allowed by the app.
    await invoke('allow_images', { paths: images }).catch((error: unknown) => console.error(error));
  }
  post({ type: 'update', uri: doc.path, html, ...SETTINGS, ...(fragment ? { fragment } : {}), ...(diff ? { diff } : {}) });
}

/** The reason of an error: an English text of the Rust commands, translated, or one of the system. */
function reason(error: unknown): string {
  return t(error instanceof Error ? error.message : String(error));
}

/** Shows an error: `text`, its reason, and `note` when given. */
async function showError(text: string, error: unknown, note?: string): Promise<void> {
  await message([text, reason(error), ...(note ? [note] : [])].join('\n'), { title: APP_NAME, kind: 'error' });
}

/** Opens one document at a time: in order, so that the last one opened is shown and watched. */
let opening: Promise<void> = Promise.resolve();
/** Numbers the reads (`openDocument` and `reload`), so that an older answer does not replace a newer one. */
let readSeq = 0;
/** The number of the read shown. */
let shownSeq = 0;

/** How a document is opened (`openDocument`). */
interface OpenOptions {
  /** The heading to scroll to on its first render: the fragment of the link that opened it. */
  fragment?: string;
  /** The sidebar keeps its folder: a file chosen in it. */
  keepFolder?: boolean;
  /**
   * Added to the files opened recently: a file opened from outside the documents shown (a dialog, a drop, the file
   * manager, the list itself), not from the sidebar or a link.
   */
  remember?: boolean;
}

/**
 * Opens a document in the window. The sidebar then lists its folder, unless it lists a folder the document is in, or
 * `keepFolder`.
 */
function openDocument(path: string, options: OpenOptions = {}): Promise<void> {
  opening = opening.then(() => openNow(path, options)).catch((error: unknown) => console.error(error));
  return opening;
}

/** `openDocument`, once the documents opened before are. */
async function openNow(path: string, { fragment, keepFolder = false, remember = false }: OpenOptions): Promise<void> {
  const seq = ++readSeq;
  let doc: OpenedDocument;
  try {
    doc = await invoke<OpenedDocument>('open_document', { path });
  } catch (error) {
    // A file of the recent ones that is gone, chosen in their list, is no longer listed.
    const forgotten = remember && error === FILE_NOT_FOUND && forgetFile(path);
    await showError(t('Could not open {0}.', path), error, forgotten ? t('It was removed from the recent files.') : undefined);
    return;
  }
  if (remember) {
    rememberFile(doc.path);
  }
  // Unless the same file was read again meanwhile (it changed while it was being opened again).
  if (current?.path !== doc.path || seq > shownSeq) {
    shownSeq = seq;
    current = doc;
  }
  missing = undefined;
  listShown = false;
  // Another document: shown alone, with its own history.
  const compared = pendingRevision ?? comparison;
  if (compared && compared.path !== doc.path) {
    // Rendered below.
    stopComparing(false);
  }
  pendingFragment = fragment ? { path: doc.path, fragment } : undefined;
  try {
    sessionStorage.setItem(DOCUMENT_KEY, doc.path);
  } catch {
    // Not reopened by a reload of the page.
  }
  empty.hidden = true;
  updateExportItem();
  void appWindow.setTitle(`${doc.name} — ${APP_NAME}`);
  if (!keepFolder && !(folder && isInside(folder, doc.path))) {
    setFolder(doc.dir);
  }
  sidebar.setCurrent(doc.path);
  render();
  void loadHistory();
}

/** The error of `open_document` and `read_document` when the file is not there (`FILE_NOT_FOUND` in lib.rs). */
const FILE_NOT_FOUND = 'The file was not found.';
/** How long a document gone after a change may take to come back before it is told missing. */
const MISSING_DELAY_MS = 500;

/**
 * Opens the document of the window again, in order with the documents being opened: read and watched again (its
 * folder may have been removed and added back by git), or else told missing (not in the branch switched to). The
 * reads started before do not replace it.
 */
function reopen(path: string): Promise<void> {
  opening = opening
    .then(async () => {
      if (current?.path !== path) {
        return;
      }
      const seq = ++readSeq;
      let doc: OpenedDocument | undefined;
      let failure: unknown;
      try {
        doc = await invoke<OpenedDocument>('open_document', { path });
      } catch (error) {
        failure = error;
      }
      if (current?.path !== path || seq <= shownSeq) {
        return;
      }
      shownSeq = seq;
      if (doc) {
        current = doc;
        missing = undefined;
      } else if (failure === FILE_NOT_FOUND) {
        // The Rust side still shows it for the window, and follows its folder if it is there.
        missing = path;
      } else if (failure !== undefined) {
        // Shown as it was.
        await showError(t('Could not open {0}.', path), failure);
        return;
      }
      updateExportItem();
      render();
    })
    .catch((error: unknown) => console.error(error));
  return opening;
}

/** Reads the document again: when it changed (`report` false: a file being saved may be missing for a moment), or from the menu. */
async function reload(report: boolean): Promise<void> {
  const path = current?.path;
  if (!path) {
    return;
  }
  if (missing === path) {
    // Back in the folder (the branch switched back elsewhere)? Watched again: its folder may have been removed.
    await reopen(path);
    if (missing !== path) {
      void loadHistory(true);
    }
    return;
  }
  const seq = ++readSeq;
  try {
    // Not open_document: the watch stays, also when another document is being opened meanwhile.
    const doc = await invoke<OpenedDocument>('read_document', { path });
    // Unless another document was opened, or the file read again, meanwhile.
    if (current?.path === path && seq > shownSeq) {
      shownSeq = seq;
      current = doc;
      render();
    }
  } catch (error) {
    if (error === FILE_NOT_FOUND) {
      // Removed, e.g. by git switching the branch in another window or a terminal: told missing, unless it is back
      // meanwhile (an editor that saves it by replacing the file).
      if (!report) {
        await new Promise((resolve) => setTimeout(resolve, MISSING_DELAY_MS));
      }
      if (current?.path === path) {
        await reopen(path);
        if (missing === path) {
          void loadHistory(true);
        }
      }
      return;
    }
    if (report) {
      await showError(t('Could not open {0}.', path), error);
    }
  }
}

async function chooseDocument(): Promise<void> {
  const path = await open({
    multiple: false,
    directory: false,
    defaultPath: current?.dir,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (typeof path === 'string') {
    await openDocument(path, { remember: true });
  }
}

// ---------------------------------------------------------------------------
// Sidebar: the Markdown files of the folder of the document, or of a folder chosen (File > Open Folder...).

/** Whether the sidebar was shown at the end of the last launch: hidden on the first one. */
function savedSidebarShown(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

let sidebarShown = savedSidebarShown();
/** View > Sidebar. */
let sidebarItem: CheckMenuItem | undefined;
/** The folder the sidebar lists. */
let folder: string | undefined;
/** The folder last asked to be listed (`listFolder`). */
let listedFolder: string | undefined;
/** Lists one folder at a time, so that the Rust side watches the last one listed. */
let listing: Promise<void> = Promise.resolve();
/** The list shown, to keep it as it is when the folder changes without changing it. */
let shownList: string | undefined;

const sidebar = createSidebar({
  t,
  lang,
  onOpenFile: (path) => void openDocument(path, { keepFolder: true }),
  onChooseFolder: () => void chooseFolder(),
  onTabChange: () => void loadHistory(),
  onSelectRevision: (revision) => void compareWith(revision),
  onReloadHistory: () => void loadHistory(true),
  onSwitchBranch: switchBranch,
  onPull: () => void pull(),
});
sidebar.setShown(sidebarShown);

/** Shows or hides the sidebar (View > Sidebar), for the next launch too. */
function setSidebarShown(shown: boolean): void {
  sidebarShown = shown;
  try {
    localStorage.setItem(SIDEBAR_KEY, String(shown));
  } catch {
    // Not kept for the next launch.
  }
  // A check item checks itself when clicked.
  void sidebarItem?.setChecked(shown);
  sidebar.setShown(shown);
  if (shown) {
    // Listed again: its changes are not followed while it is hidden.
    listFolder(true);
    void loadHistory();
  } else {
    // After the listing under way, which would watch the folder again.
    listing = listing
      .then(async () => {
        if (!sidebarShown) {
          await invoke('close_folder');
        }
      })
      .catch((error: unknown) => console.error(error));
  }
}

/** Keeps the folder of the sidebar for a reload of the page (F5). */
function saveFolder(): void {
  try {
    if (folder) {
      sessionStorage.setItem(FOLDER_KEY, folder);
    }
  } catch {
    // Not listed again by a reload of the page.
  }
}

/** Lists `path` in the sidebar, and shows the sidebar if `show`. */
function setFolder(path: string, show = false): void {
  folder = path;
  saveFolder();
  if (listShown) {
    render();
  }
  if (show && !sidebarShown) {
    setSidebarShown(true);
  } else {
    listFolder();
  }
}

/** Lists the folder in the sidebar while it is shown: again when `force` (it changed), else unless it was listed. */
function listFolder(force = false): void {
  if (!sidebarShown || !folder || (!force && listedFolder === folder)) {
    return;
  }
  listedFolder = folder;
  listing = listing.then(listNow).catch((error: unknown) => console.error(error));
}

/** `listFolder`, once the folders listed before are: shows the list, or why the folder cannot be listed. */
async function listNow(): Promise<void> {
  const path = folder;
  if (!sidebarShown || !path) {
    return;
  }
  try {
    const tree = await invoke<FolderTree>('open_folder', { path });
    // Unless another folder was chosen meanwhile: it is listed next.
    if (path !== folder) {
      return;
    }
    // Without symbolic links, as the paths of the documents (open_document).
    folder = listedFolder = tree.root.path;
    saveFolder();
    const list = JSON.stringify(tree);
    if (list !== shownList) {
      shownList = list;
      sidebar.setTree(tree);
    }
  } catch (error) {
    if (path === folder) {
      // Listed again when chosen again, also without a change of the folder.
      listedFolder = undefined;
      shownList = undefined;
      sidebar.setError(path, `${t('Could not open {0}.', path)}\n${reason(error)}`);
    }
  }
}

/** Asks for a folder to list in the sidebar (File > Open Folder...), and shows the sidebar. */
async function chooseFolder(): Promise<void> {
  const path = await open({ multiple: false, directory: true, defaultPath: folder ?? current?.dir });
  if (typeof path === 'string') {
    setFolder(path, true);
  }
}

/** Lists a folder dropped on the window. Another file (not Markdown) is ignored. */
async function dropFolder(path: string): Promise<void> {
  if (await invoke<boolean>('is_folder', { path })) {
    setFolder(path, true);
  }
}

async function openLink(href: string): Promise<void> {
  // The links of the list of the design documents are relative to its folder.
  const dir = listShown ? folder : current?.dir;
  const target = dir === undefined ? undefined : linkTarget(dir, href);
  try {
    switch (target?.kind) {
      case 'url':
        await invoke('open_url', { url: target.url });
        break;
      case 'document':
        await openDocument(target.path, { fragment: target.fragment });
        break;
      case 'file':
        await invoke('open_path', { path: target.path });
        break;
    }
  } catch (error) {
    await showError(t('Could not open {0}.', href), error);
  }
}

// ---------------------------------------------------------------------------
// The list of the design documents of the folder (View > Design Docs), the same as the extension's "Show Design Docs"
// (src/designDocsPanel.ts): in place of the document, until one is opened.

/** `uri` of the updates of the list, for the webview (which tells it from a document): the same for any folder. */
const DESIGN_DOCS_URI = 'mdDesignDoc:designDocs';

/** Shows the list of the design documents of the sidebar's folder, after asking for a folder when there is none. */
async function showDesignDocs(): Promise<void> {
  if (!folder) {
    const path = await open({ multiple: false, directory: true, defaultPath: current?.dir });
    if (typeof path !== 'string') {
      return;
    }
    setFolder(path);
  }
  listShown = true;
  // The document is no longer shown: neither exported nor compared, and its history not listed.
  current = undefined;
  stopComparing(false);
  try {
    sessionStorage.removeItem(DOCUMENT_KEY);
  } catch {
    // Opened again by a reload of the page.
  }
  empty.hidden = true;
  updateExportItem();
  sidebar.setCurrent(undefined);
  void appWindow.setTitle(`${t('Design Docs')} — ${APP_NAME}`);
  void loadHistory();
  render();
}

/** Reads the design documents of the folder, and sends their list to the webview. */
async function renderDesignDocs(): Promise<void> {
  const path = folder;
  if (!path) {
    return;
  }
  let html: string;
  try {
    const { files, truncated } = await invoke<FileHeads>('read_design_docs', { path });
    const entries = files.flatMap((file): IndexEntry[] => {
      const { designDoc, ...info } = documentInfo(md, file.head, file.name);
      const href = [...file.folder.split('/').filter(Boolean), file.name].map(encodeURIComponent).join('/');
      return designDoc ? [{ ...info, href, folder: file.folder, file: file.name }] : [];
    });
    html = indexBody(t('Design Docs'), entries, t, t(NO_DESIGN_DOCS));
    if (truncated) {
      html += `<p class="seqnotes-index-empty">${escapeHtml(t('The folder has too many files: some of them are not listed.'))}</p>`;
    }
  } catch (error) {
    html = indexBody(t('Design Docs'), [], t, `${t('Could not open {0}.', path)}\n${reason(error)}`);
  }
  // Unless the list was left meanwhile. Another folder chosen meanwhile is rendered next (`setFolder`).
  if (listShown) {
    post({ type: 'update', uri: DESIGN_DOCS_URI, html, ...SETTINGS });
  }
}

// ---------------------------------------------------------------------------
// Git history: the commits of the document in the sidebar's History tab, and its differences from the one chosen,
// as the extension's "Compare Design Doc with Git Revision" (src/history.ts).

/** The document whose history the sidebar shows or is reading, so that it is not read again for nothing. */
let historyOf: string | undefined;
/** Numbers the reads of the history, so that an older answer does not replace a newer one. */
let historySeq = 0;
/** Numbers the commits chosen, so that the last one is compared with. */
let compareSeq = 0;
/** The commit chosen last, while its content is being read (`git_show`): chosen again, it is not compared with. */
let pendingRevision: { path: string; hash: string } | undefined;

/** What an error of `git_log` or `git_show` (`GitError` in lib.rs) says for the document `name`. */
function gitErrorText(error: unknown, name: string): string {
  const { kind, message: text } = (typeof error === 'object' && error !== null ? error : {}) as { kind?: string; message?: string };
  switch (kind) {
    case 'notFound':
      return t('Git was not found. Install Git.');
    case 'notRepository':
      return t('{0} is not in a Git repository.', name);
    default:
      return t('Git failed: {0}', text !== undefined ? t(text) : reason(error));
  }
}

/**
 * Reads the history of the document and the branches of its repository into the sidebar, while its History tab is
 * shown: again when `force`, else unless it shows those of the document. git runs only then, never on a launch: on
 * macOS without the Command Line Tools, it asks to install them.
 */
async function loadHistory(force = false): Promise<void> {
  if (!sidebarShown || sidebar.tab() !== 'history') {
    return;
  }
  const doc = current;
  if (!doc) {
    historyOf = undefined;
    branchesOf = undefined;
    ++branchesSeq;
    sidebar.setBranches(undefined);
    sidebar.setHistory(undefined, t('Open a Markdown file to compare it with its Git history.'));
    return;
  }
  await Promise.all([loadBranches(doc, force), loadRevisions(doc, force)]);
}

/** The commits of the document, for `loadHistory`. */
async function loadRevisions(doc: OpenedDocument, force: boolean): Promise<void> {
  if (missing === doc.path) {
    // Read once it is back.
    historyOf = undefined;
    ++historySeq;
    sidebar.setHistory(doc.name, t('{0} was not found. It may not be in the branch checked out.', doc.name));
    return;
  }
  if (!force && historyOf === doc.path) {
    return;
  }
  const seq = ++historySeq;
  // Read again: the list stays, with its scroll position, until it is replaced.
  if (historyOf !== doc.path) {
    sidebar.setHistory(doc.name, t('Reading the Git history...'));
  }
  historyOf = doc.path;
  let history: Revision[] | string;
  try {
    // Of the document the Rust side shows for the window: the one opened last, as `doc`.
    const revisions = parseGitLog(await invoke<string>('git_log'));
    history = revisions.length > 0 ? revisions : t('{0} has no Git history yet.', doc.name);
  } catch (error) {
    history = gitErrorText(error, doc.name);
    if (seq === historySeq) {
      // Read again when the tab is shown again (e.g. once Git is installed).
      historyOf = undefined;
    }
  }
  if (seq === historySeq) {
    sidebar.setHistory(doc.name, history);
  }
}

/** The document whose branches the sidebar shows or is reading, so that they are not read again for nothing. */
let branchesOf: string | undefined;
/** Numbers the reads of the branches, so that an older answer does not replace a newer one. */
let branchesSeq = 0;
/** Whether the repository is being switched to another branch or pulled: one at a time. */
let gitBusy = false;

/**
 * The branches of the repository of the document, above its history, for `loadHistory`. Hidden when they cannot be
 * read (not in a repository, no git), which the history tells.
 */
async function loadBranches(doc: OpenedDocument, force: boolean): Promise<void> {
  if (!force && branchesOf === doc.path) {
    return;
  }
  const seq = ++branchesSeq;
  if (branchesOf !== doc.path) {
    sidebar.setBranches(undefined);
    // Unless git is still running, which ends with it.
    if (!gitBusy) {
      sidebar.setBranchStatus(undefined);
    }
  }
  branchesOf = doc.path;
  let branches: Branches | undefined;
  try {
    // Of the document the Rust side shows for the window, as `git_log`.
    branches = await invoke<Branches>('git_branches');
  } catch {
    if (seq === branchesSeq) {
      // Read again with the history.
      branchesOf = undefined;
    }
  }
  if (seq === branchesSeq) {
    sidebar.setBranches(branches);
  }
}

/**
 * Runs a git command that changes the repository, then `after` once it succeeded (the document and its history read
 * again), one at a time, telling `text` meanwhile: the branches cannot be used until they are read again. Gives the
 * error of the command if it failed.
 */
async function changeRepository<T>(text: string, run: () => Promise<T>, after: () => Promise<void>): Promise<{ value: T } | { error: unknown }> {
  gitBusy = true;
  sidebar.setBranchStatus(text, true);
  try {
    let value: T;
    try {
      value = await run();
    } catch (error) {
      return { error };
    }
    await after();
    return { value };
  } finally {
    gitBusy = false;
    sidebar.setBranchStatus(undefined);
  }
}

/**
 * Switches the repository of the document to another branch chosen in the sidebar, once the user agrees: then shows
 * the document, its folder, history and branches as they are in that branch, the document alone.
 */
async function switchBranch(name: string, remote: boolean): Promise<void> {
  const doc = current;
  if (!doc || gitBusy) {
    return;
  }
  // What was done before (pulled) is no longer the point.
  sidebar.setBranchStatus(undefined);
  const question = remote
    ? t('Switch the repository of {0} to a new branch that tracks {1}?', doc.name, name)
    : t('Switch the repository of {0} to the branch {1}?', doc.name, name);
  const agreed = await ask(question, { title: APP_NAME, kind: 'warning', okLabel: t('Switch'), cancelLabel: t('Cancel') });
  // Unless another document was opened meanwhile.
  if (!agreed || current?.path !== doc.path || gitBusy) {
    return;
  }
  const result = await changeRepository(
    t('Switching to {0}...', name),
    () => invoke('git_switch', { name, remote }),
    async () => {
      // Another version of the document: no longer compared with a commit of the other branch. Unless another
      // document was opened meanwhile, which stays as it is (its history and branches are read again).
      if (current?.path === doc.path) {
        stopComparing(false);
      }
      await reopenAfterGit(doc.path);
    },
  );
  if ('error' in result) {
    await message(`${t('Could not switch to {0}.', name)}\n${gitErrorText(result.error, doc.name)}`, { title: APP_NAME, kind: 'error' });
  }
}

/** Pulls the branch of the repository of the document (fast-forward only), and tells whether it was up to date. */
async function pull(): Promise<void> {
  const doc = current;
  if (!doc || gitBusy) {
    return;
  }
  // Still compared with the same commit, if it is.
  const result = await changeRepository(t('Pulling...'), () => invoke<{ updated: boolean }>('git_pull'), () => reopenAfterGit(doc.path));
  if ('error' in result) {
    await message(`${t('Could not pull.')}\n${gitErrorText(result.error, doc.name)}`, { title: APP_NAME, kind: 'error' });
    return;
  }
  // Not below the branches of another document opened meanwhile.
  if (current?.path === doc.path) {
    sidebar.setBranchStatus(result.value.updated ? t('Pulled the latest changes.') : t('Already up to date.'));
  }
}

/** Shows the document again after git changed the files (`reopen`), then its folder, history and branches. */
async function reopenAfterGit(path: string): Promise<void> {
  await reopen(path);
  listFolder(true);
  await loadHistory(true);
}


/** Shows the differences of the document from a commit of its history, or the document alone if it is compared with it already. */
async function compareWith(revision: Revision): Promise<void> {
  const doc = current;
  if (!doc) {
    return;
  }
  // The commit being read, or else the one compared with.
  const chosen = pendingRevision ?? comparison;
  if (chosen?.path === doc.path && chosen.hash === revision.hash) {
    stopComparing();
    return;
  }
  const seq = ++compareSeq;
  pendingRevision = { path: doc.path, hash: revision.hash };
  sidebar.setComparedRevision(revision.hash);
  let source: string | undefined;
  let failure: unknown;
  try {
    source = await invoke<string>('git_show', { hash: revision.hash, path: revision.path });
  } catch (error) {
    failure = error;
  }
  // Unless another commit or document was chosen meanwhile: neither shown nor told when it failed.
  if (seq !== compareSeq || current?.path !== doc.path) {
    return;
  }
  pendingRevision = undefined;
  if (source === undefined) {
    // The commit compared with before, if any, stays.
    sidebar.setComparedRevision(comparison?.hash);
    await message(gitErrorText(failure, doc.name), { title: APP_NAME, kind: 'error' });
    return;
  }
  const date = formatRevisionDate(revision.date, lang);
  comparison = { path: doc.path, hash: revision.hash, label: t('Compared with {0}: {1} ({2})', revision.shortHash, revision.subject, date), source };
  render();
}

/**
 * Shows the document alone again (rendered when `rerender`): the commit chosen again, the bar of the differences
 * closed, or another document opened. A commit being read is then not compared with.
 */
function stopComparing(rerender = true): void {
  ++compareSeq;
  pendingRevision = undefined;
  sidebar.setComparedRevision(undefined);
  if (comparison) {
    comparison = undefined;
    if (rerender) {
      render();
    }
  }
}

// ---------------------------------------------------------------------------
// HTML export: the same file as the extension's "Export Design Doc as HTML" (src/exportHtml.ts).

/** An exported document is rendered by the webview; it gives up after this long. */
const EXPORT_TIMEOUT_MS = 60_000;

let exportId = 0;
/** The documents being rendered by the webview for an export, by id. */
const pendingExports = new Map<number, { resolve: (body: string) => void; reject: (error: Error) => void }>();
let exporting = false;
/** File > Export as HTML..., enabled when the window shows a document (rendered by the webview, once it is ready). */
let exportItem: MenuItem | undefined;

function canExport(): boolean {
  return ready && current !== undefined && missing !== current.path && !exporting;
}

function updateExportItem(): void {
  void exportItem?.setEnabled(canExport());
}

/** Has the webview render `html` (from `renderForExport`) for an exported file, and returns the rendered body. */
function renderInWebview(html: string): Promise<string> {
  const id = ++exportId;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingExports.delete(id);
      reject(new Error(t('The preview did not respond.')));
    }, EXPORT_TIMEOUT_MS);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      pendingExports.delete(id);
      fn();
    };
    pendingExports.set(id, { resolve: (body) => done(() => resolve(body)), reject: (error) => done(() => reject(error)) });
    post({ type: 'export', id, html, diagramLook: SETTINGS.diagramLook });
  });
}

function dataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * A local image `src` of a document in `dir`, for its export to `target`: embedded as a data URI when it is in the
 * document's folder (as the extension embeds those of the folders its preview shows), else linked.
 */
async function exportedImage(dir: string, src: string, target: string): Promise<string> {
  const path = resourcePath(dir, src);
  // Not the case: renderForExport keeps the URLs as they are.
  if (path === undefined) {
    return src;
  }
  const type = imageType(path);
  if (type) {
    try {
      // Only from the folder of the window's document.
      const bytes = await invoke<ArrayBuffer>('read_image', { path });
      return await dataUri(new Blob([bytes], { type }));
    } catch {
      // Linked instead, see below.
    }
  }
  // An image of an unknown type, outside the folder or that cannot be read is linked instead, which works as long
  // as the files stay where they are.
  return relativeLink(target, path);
}

const assets = new Map<string, Promise<string>>();

/** A file of the app (desktop/dist/): the styles and script of an exported file, the same as those of the extension. */
function readAsset(name: string): Promise<string> {
  let asset = assets.get(name);
  if (!asset) {
    asset = fetch(name).then(async (response) => {
      if (!response.ok) {
        throw new Error(`${name}: ${response.status} ${response.statusText}`);
      }
      return stripSourceMap(await response.text());
    });
    // Read again by the next export if it failed.
    asset.catch(() => assets.delete(name));
    assets.set(name, asset);
  }
  return asset;
}

/** Asks where to export the document, and writes its HTML file there. Returns that file, or undefined when canceled. */
async function writeExport(doc: OpenedDocument): Promise<string | undefined> {
  // Chosen in a dialog of the app (not of the webview), which writes only to that file (write_export, open_export).
  const target = await invoke<string | null>('choose_export_target', { dir: doc.dir, name: exportFileName(doc.name), title: t('Export Design Doc as HTML') });
  if (!target) {
    return undefined;
  }
  const html = await renderForExport(md, doc.text, { t, ...RENDER_SETTINGS }, (src) => exportedImage(doc.dir, src, target));
  const [body, style, exportStyle, script] = await Promise.all([renderInWebview(html), readAsset('webview.css'), readAsset('export.css'), readAsset('export.js')]);
  const page = exportPage({ lang, title: documentTitle(md, doc.text, doc.name), body, styles: [style, exportStyle], script, settings: SETTINGS });
  await invoke('write_export', { html: page });
  return target;
}

/**
 * Exports the document of the window to a single HTML file: the diagrams as rendered by the webview (light theme),
 * the images embedded, and a small script for the side-by-side layout and the arrow ⇔ step highlighting.
 */
async function exportHtml(): Promise<void> {
  const doc = current;
  if (!doc || !canExport()) {
    return;
  }
  exporting = true;
  updateExportItem();
  let target: string | undefined;
  try {
    target = await writeExport(doc);
  } catch (error) {
    await message(t('Could not export the design doc: {0}', reason(error)), { title: APP_NAME, kind: 'error' });
  } finally {
    exporting = false;
    updateExportItem();
  }
  if (!target) {
    return;
  }
  const open = t('Open in Browser');
  const answer = await message(t('Exported to {0}.', target.split(/[\\/]/).pop() ?? ''), { title: APP_NAME, buttons: { ok: open, cancel: t('Close') } });
  // The label of the button chosen (as `confirm` of the dialog plugin compares it).
  if (answer === open) {
    await invoke('open_export').catch((error: unknown) => showError(t('Could not open {0}.', target), error));
  }
}

// ---------------------------------------------------------------------------
// Theme: the body class of VS Code's theme, for desktop/theme.css and the diagrams (webview/main.ts follows it).

const systemDark = matchMedia('(prefers-color-scheme: dark)');

const THEMES: [PreviewTheme, string][] = [
  ['auto', 'Follow the System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

function savedTheme(): PreviewTheme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

let theme = savedTheme();
/** The items of the menu View > Theme, in the order of `THEMES`. */
const themeItems: CheckMenuItem[] = [];

function applyTheme(): void {
  const dark = theme === 'auto' ? systemDark.matches : theme === 'dark';
  document.body.classList.toggle('vscode-dark', dark);
  document.body.classList.toggle('vscode-light', !dark);
  // A check item checks itself when clicked.
  themeItems.forEach((item, i) => void item.setChecked(THEMES[i][0] === theme));
}

applyTheme();
systemDark.addEventListener('change', applyTheme);
// Chosen in another window.
window.addEventListener('storage', (event) => {
  if (event.key === THEME_KEY) {
    theme = savedTheme();
    applyTheme();
  }
});

// ---------------------------------------------------------------------------
// The files opened recently (File > Open Recent, and the screen of a window that shows no file): those opened from
// outside the documents shown, as `remember` of `OpenOptions` tells.

/** The files opened recently, kept for the next launch and shared by the windows. */
const RECENT_KEY = 'mdDesignDoc.recentFiles';

/** The list saved, or an empty one when it cannot be read. */
function savedRecentFiles(): string[] {
  try {
    return parseRecentFiles(localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

let recentFiles = savedRecentFiles();
/** File > Open Recent. */
let recentMenu: Submenu | undefined;
/** Updates the menu one at a time, so that it ends with the last list. */
let recentMenuUpdate: Promise<void> = Promise.resolve();
const recentSection = empty.querySelector<HTMLElement>('.desktop-recent')!;
const recentList = recentSection.querySelector('ul')!;

/** Keeps the list, for the other windows (`storage` event) and the next launch too, and shows it. */
function setRecentFiles(list: string[]): void {
  recentFiles = list;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Not kept for the next launch.
  }
  showRecentFiles();
}

/**
 * Puts a file opened first in the list. From the list shown, which has the changes of the other windows (`storage`
 * event), rather than from the one saved, which may be older if it could not be saved.
 */
function rememberFile(path: string): void {
  setRecentFiles(addRecentFile(recentFiles, path));
}

/** Removes a file from the list. Returns whether it was there. */
function forgetFile(path: string): boolean {
  if (!recentFiles.includes(path)) {
    return false;
  }
  setRecentFiles(removeRecentFile(recentFiles, path));
  return true;
}

/** Opens a file of the list, which puts it first again. */
function openRecentFile(path: string): void {
  void openDocument(path, { remember: true });
}

/** The items of File > Open Recent: the files, then the item that clears the list. */
async function recentMenuItems(): Promise<(MenuItem | PredefinedMenuItem)[]> {
  const files = recentFiles;
  const items: (MenuItem | PredefinedMenuItem)[] = await Promise.all(
    files.map((path) => MenuItem.new({ text: menuText(path), action: () => openRecentFile(path) })),
  );
  if (files.length === 0) {
    items.push(await MenuItem.new({ text: t('No Recent Files'), enabled: false }));
  }
  items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
  items.push(await MenuItem.new({ text: label('&Clear Recently Opened'), enabled: files.length > 0, action: () => setRecentFiles([]) }));
  return items;
}

/** Shows the list in File > Open Recent, once the menu is set up. */
function updateRecentMenu(): void {
  const menu = recentMenu;
  if (!menu) {
    return;
  }
  recentMenuUpdate = recentMenuUpdate
    .then(async () => {
      const items = await recentMenuItems();
      for (const item of await menu.items()) {
        await menu.remove(item);
        await item.close();
      }
      await menu.append(items);
    })
    .catch((error: unknown) => console.error(error));
}

/** Shows the list on the screen of a window that shows no file: hidden when it is empty. */
function renderRecentList(): void {
  recentSection.hidden = recentFiles.length === 0;
  recentList.replaceChildren(
    ...recentFiles.map((path) => {
      const { name, dir } = splitPath(path);
      const button = document.createElement('button');
      button.type = 'button';
      button.title = path;
      const nameText = document.createElement('span');
      nameText.className = 'desktop-recent-name';
      nameText.textContent = name;
      const dirText = document.createElement('span');
      dirText.className = 'desktop-recent-dir';
      dirText.textContent = dir;
      button.append(nameText, dirText);
      button.addEventListener('click', () => openRecentFile(path));
      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
}

/** Shows the list on the screen and in the menu. */
function showRecentFiles(): void {
  renderRecentList();
  updateRecentMenu();
}

recentSection.querySelector('h2')!.textContent = t('Recent Files');
const clearRecentButton = recentSection.querySelector<HTMLButtonElement>('.desktop-recent-clear')!;
clearRecentButton.textContent = t('Clear');
clearRecentButton.addEventListener('click', () => setRecentFiles([]));
renderRecentList();
// Changed in another window (or all the storage cleared: no key).
window.addEventListener('storage', (event) => {
  if (event.key === RECENT_KEY || event.key === null) {
    recentFiles = savedRecentFiles();
    showRecentFiles();
  }
});

// ---------------------------------------------------------------------------
// Menu

const mac = navigator.userAgent.includes('Mac');

/** The text of a menu item. The access keys (`&File`, `ファイル(&F)`) are for Windows and Linux: macOS menus have none. */
function label(text: string): string {
  return mac ? t(text).replace(/\(&\w\)/, '').replace(/&/g, '') : t(text);
}

/** The menu of the window (of the app on macOS): File, View, and on macOS the app and Edit menus. */
async function setUpMenu(): Promise<void> {
  const setTheme = (value: PreviewTheme) => {
    theme = value;
    try {
      // Also for the other windows (`storage` event).
      localStorage.setItem(THEME_KEY, value);
    } catch {
      // Not kept for the next launch.
    }
    applyTheme();
  };
  for (const [value, text] of THEMES) {
    themeItems.push(await CheckMenuItem.new({ text: t(text), checked: value === theme, action: () => setTheme(value) }));
  }
  const separator = () => PredefinedMenuItem.new({ item: 'Separator' });
  exportItem = await MenuItem.new({ text: label('&Export as HTML...'), enabled: canExport(), action: () => void exportHtml() });
  const listed = recentFiles;
  recentMenu = await Submenu.new({ text: label('Open Recen&t'), items: await recentMenuItems() });
  if (recentFiles !== listed) {
    // Changed meanwhile, before the menu could be updated.
    updateRecentMenu();
  }

  const file = await Submenu.new({
    text: label('&File'),
    items: [
      await MenuItem.new({ text: label('&Open...'), accelerator: 'CmdOrCtrl+O', action: () => void chooseDocument() }),
      await MenuItem.new({ text: label('Open &Folder...'), action: () => void chooseFolder() }),
      recentMenu,
      await MenuItem.new({
        text: label('&Reload'),
        accelerator: 'CmdOrCtrl+R',
        action: () => {
          void reload(true);
          void loadHistory(true);
          if (listShown) {
            render();
          }
        },
      }),
      await separator(),
      exportItem,
      await separator(),
      // This window: the others stay open (the app ends with its last window).
      await MenuItem.new({ text: label('&Close'), accelerator: 'CmdOrCtrl+W', action: () => void appWindow.close() }),
      // All the windows. On macOS in the app menu (Quit).
      ...(mac ? [] : [await MenuItem.new({ text: label('E&xit'), action: () => void invoke('exit') })]),
    ],
  });
  sidebarItem = await CheckMenuItem.new({
    text: label('&Sidebar'),
    accelerator: 'CmdOrCtrl+B',
    checked: sidebarShown,
    action: () => setSidebarShown(!sidebarShown),
  });
  const view = await Submenu.new({
    text: label('&View'),
    items: [
      sidebarItem,
      await MenuItem.new({ text: label('&Design Docs'), accelerator: 'CmdOrCtrl+Shift+D', action: () => void showDesignDocs() }),
      await separator(),
      await Submenu.new({ text: label('&Theme'), items: themeItems }),
    ],
  });
  const items = [file, view];
  if (mac) {
    const app = await Submenu.new({
      text: APP_NAME,
      items: [
        await PredefinedMenuItem.new({ item: { About: null } }),
        await separator(),
        await PredefinedMenuItem.new({ item: 'Hide' }),
        await PredefinedMenuItem.new({ item: 'HideOthers' }),
        await PredefinedMenuItem.new({ item: 'ShowAll' }),
        await separator(),
        await PredefinedMenuItem.new({ item: 'Quit' }),
      ],
    });
    // Without it, the copy keys do nothing on macOS.
    const edit = await Submenu.new({
      text: label('&Edit'),
      items: [await PredefinedMenuItem.new({ item: 'Copy' }), await PredefinedMenuItem.new({ item: 'SelectAll' })],
    });
    items.splice(0, 0, app);
    items.splice(2, 0, edit);
  }
  const menu = await Menu.new({ items });
  if (mac) {
    // One menu bar for the app: that of the window in front, whose items act on it.
    await menu.setAsAppMenu();
    await appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        void menu.setAsAppMenu();
      }
    });
  } else {
    await menu.setAsWindowMenu(appWindow);
  }
}

// ---------------------------------------------------------------------------
// Start

void appWindow.listen<string>('document-changed', (event) => {
  if (event.payload === current?.path) {
    void reload(false);
  }
});

void appWindow.listen<string>('folder-changed', () => {
  listFolder(true);
  if (listShown) {
    render();
  }
});

void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type === 'drop') {
    const { paths } = event.payload;
    const path = paths.find(isMarkdownPath);
    if (path) {
      void openDocument(path, { remember: true });
    } else if (paths.length === 1) {
      void dropFolder(paths[0]);
    }
  }
});

empty.querySelector('p')!.textContent = t('Open a Markdown file, or drop one here.');
const openButton = empty.querySelector('button')!;
openButton.textContent = t('Open File...');
openButton.addEventListener('click', () => void chooseDocument());

/** Sets up the menu, and opens the file given to the window (or shown before a reload) with its folder. */
async function start(): Promise<void> {
  await setUpMenu().catch((error: unknown) => console.error(error));
  // Before asking for the first file: a file given to the running app opens here when this window shows nothing.
  await appWindow.listen<string>('open-document', (event) => void openDocument(event.payload, { remember: true }));
  // Also after a reload of the page (F5): a file given to the window just before it is still to be opened.
  const given = await invoke<string | null>('initial_path');
  let path = given;
  try {
    // The sidebar keeps its folder if the document is in it.
    folder = sessionStorage.getItem(FOLDER_KEY) ?? undefined;
    path ||= sessionStorage.getItem(DOCUMENT_KEY);
  } catch {
    // The file given to the window only.
  }
  if (path) {
    // Not the document shown before a reload of the page, which is not opened anew.
    await openDocument(path, { remember: path === given });
  }
  if (!current) {
    empty.hidden = false;
  }
  listFolder();
}

void start();
