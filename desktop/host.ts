/**
 * The desktop app's side of the preview, in place of the extension host (Preview in src/previewPanel.ts): opens a
 * Markdown file through the Rust commands (src-tauri/src/lib.rs), renders it with `renderDocument` and sends it to
 * the webview, and follows its changes. Also the menu, the dropped files and the theme.
 *
 * Each window of the app runs its own copy: the app opens a window for each file given to it while it runs.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message, open } from '@tauri-apps/plugin-dialog';
import type { FromWebview, PreviewTheme, ToWebview } from '../src/protocol';
import { createMarkdown, renderDocument } from '../src/render';
import { t } from './l10n';
import { isMarkdownPath, linkTarget, resourcePath } from './paths';

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
} as const;

/** The document of the window, kept across reloads of the page (F5) in the session. */
const DOCUMENT_KEY = 'mdDesignDoc.document';
const THEME_KEY = 'mdDesignDoc.theme';

const md = createMarkdown();
const appWindow = getCurrentWindow();
const empty = document.getElementById('desktop-empty')!;

let ready = false;
let current: OpenedDocument | undefined;
/** The heading of the document to scroll to on its first render (the fragment of the link that opened it). */
let pendingFragment: { path: string; fragment: string } | undefined;
/** Renders one at a time, so that the updates reach the webview in order. */
let rendering: Promise<void> = Promise.resolve();

export function onWebviewMessage(message: FromWebview): void {
  switch (message.type) {
    case 'ready':
      ready = true;
      render();
      break;
    case 'openLink':
      void openLink(message.href);
      break;
    // `revealLine` is not sent without an editor (syncEditor), and the app has no HTML export (`exported`).
  }
}

function post(message: ToWebview): void {
  window.postMessage(message, '*');
}

function render(): void {
  rendering = rendering.then(renderNow).catch((error: unknown) => console.error(error));
}

async function renderNow(): Promise<void> {
  const doc = current;
  // Rendered when the webview is ready.
  if (!ready || !doc) {
    return;
  }
  const fragment = pendingFragment?.path === doc.path ? pendingFragment.fragment : undefined;
  pendingFragment = undefined;
  const images: string[] = [];
  const html = renderDocument(md, doc.text, {
    t,
    frontMatter: true,
    headingNumbers: true,
    resolveResource: (src) => {
      const path = resourcePath(doc.dir, src);
      if (path === undefined) {
        return src;
      }
      images.push(path);
      return convertFileSrc(path);
    },
  });
  if (images.length > 0) {
    // The asset protocol serves only the files allowed by the app.
    await invoke('allow_images', { paths: images }).catch((error: unknown) => console.error(error));
  }
  post({ type: 'update', uri: doc.path, html, ...SETTINGS, ...(fragment ? { fragment } : {}) });
}

/** Shows an error: `text`, and the reason (an English text of the Rust commands, translated, or one of the system). */
async function showError(text: string, error: unknown): Promise<void> {
  await message(`${text}\n${t(error instanceof Error ? error.message : String(error))}`, { title: APP_NAME, kind: 'error' });
}

/** Opens one document at a time: in order, so that the last one opened is shown and watched. */
let opening: Promise<void> = Promise.resolve();
/** Numbers the reads (`openDocument` and `reload`), so that an older answer does not replace a newer one. */
let readSeq = 0;
/** The number of the read shown. */
let shownSeq = 0;

/** Opens a document in the window, at the heading `fragment` when given. */
function openDocument(path: string, fragment?: string): Promise<void> {
  opening = opening.then(() => openNow(path, fragment)).catch((error: unknown) => console.error(error));
  return opening;
}

async function openNow(path: string, fragment?: string): Promise<void> {
  const seq = ++readSeq;
  let doc: OpenedDocument;
  try {
    doc = await invoke<OpenedDocument>('open_document', { path });
  } catch (error) {
    await showError(t('Could not open {0}.', path), error);
    return;
  }
  // Unless the same file was read again meanwhile (it changed while it was being opened again).
  if (current?.path !== doc.path || seq > shownSeq) {
    shownSeq = seq;
    current = doc;
  }
  pendingFragment = fragment ? { path: doc.path, fragment } : undefined;
  try {
    sessionStorage.setItem(DOCUMENT_KEY, doc.path);
  } catch {
    // Not reopened by a reload of the page.
  }
  empty.hidden = true;
  void appWindow.setTitle(`${doc.name} — ${APP_NAME}`);
  render();
}

/** Reads the document again: when it changed (`report` false: a file being saved may be missing for a moment), or from the menu. */
async function reload(report: boolean): Promise<void> {
  const path = current?.path;
  if (!path) {
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
    await openDocument(path);
  }
}

async function openLink(href: string): Promise<void> {
  const target = current && linkTarget(current.dir, href);
  try {
    switch (target?.kind) {
      case 'url':
        await invoke('open_url', { url: target.url });
        break;
      case 'document':
        await openDocument(target.path, target.fragment);
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
// Menu

async function setUpMenu(): Promise<void> {
  const mac = navigator.userAgent.includes('Mac');
  // The access keys (`&File`, `ファイル(&F)`) are for Windows and Linux: macOS menus have none.
  const label = (text: string) => (mac ? t(text).replace(/\(&\w\)/, '').replace(/&/g, '') : t(text));
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

  const file = await Submenu.new({
    text: label('&File'),
    items: [
      await MenuItem.new({ text: label('&Open...'), accelerator: 'CmdOrCtrl+O', action: () => void chooseDocument() }),
      await MenuItem.new({ text: label('&Reload'), accelerator: 'CmdOrCtrl+R', action: () => void reload(true) }),
      await separator(),
      // This window: the others stay open (the app ends with its last window).
      await MenuItem.new({ text: label('&Close'), accelerator: 'CmdOrCtrl+W', action: () => void appWindow.close() }),
      // All the windows. On macOS in the app menu (Quit).
      ...(mac ? [] : [await MenuItem.new({ text: label('E&xit'), action: () => void invoke('exit') })]),
    ],
  });
  const view = await Submenu.new({
    text: label('&View'),
    items: [await Submenu.new({ text: label('&Theme'), items: themeItems })],
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

void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type === 'drop') {
    const path = event.payload.paths.find(isMarkdownPath);
    if (path) {
      void openDocument(path);
    }
  }
});

empty.querySelector('p')!.textContent = t('Open a Markdown file, or drop one here.');
const openButton = empty.querySelector('button')!;
openButton.textContent = t('Open File...');
openButton.addEventListener('click', () => void chooseDocument());

async function start(): Promise<void> {
  await setUpMenu().catch((error: unknown) => console.error(error));
  // Before asking for the first file: a file given to the running app opens here when this window shows nothing.
  await appWindow.listen<string>('open-document', (event) => void openDocument(event.payload));
  let path: string | null = null;
  try {
    path = sessionStorage.getItem(DOCUMENT_KEY);
  } catch {
    // The path of the command line only.
  }
  path ||= await invoke<string | null>('initial_path');
  if (path) {
    await openDocument(path);
  }
  if (!current) {
    empty.hidden = false;
  }
}

void start();
