/**
 * The desktop app's side of the preview, in place of the extension host (Preview in src/previewPanel.ts): opens a
 * Markdown file through the Rust commands (src-tauri/src/lib.rs), renders it with `renderDocument` and sends it to
 * the webview, and follows its changes. Also the menu, the dropped files and the theme.
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
/** The heading to scroll to, given when the document was opened before the webview was ready. */
let pendingFragment: string | undefined;
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

function render(fragment?: string): void {
  if (fragment) {
    pendingFragment = fragment;
  }
  rendering = rendering.then(renderNow).catch((error: unknown) => console.error(error));
}

async function renderNow(): Promise<void> {
  const doc = current;
  // Rendered when the webview is ready.
  if (!ready || !doc) {
    return;
  }
  const fragment = pendingFragment;
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

async function showError(text: string, error: unknown): Promise<void> {
  await message(`${text}\n${error instanceof Error ? error.message : String(error)}`, { title: APP_NAME, kind: 'error' });
}

/** Opens a document in the window, at the heading `fragment` when given. */
async function openDocument(path: string, fragment?: string): Promise<void> {
  let doc: OpenedDocument;
  try {
    doc = await invoke<OpenedDocument>('open_document', { path });
  } catch (error) {
    await showError(t('Could not open {0}.', path), error);
    return;
  }
  current = doc;
  try {
    sessionStorage.setItem(DOCUMENT_KEY, doc.path);
  } catch {
    // Not reopened by a reload of the page.
  }
  empty.hidden = true;
  void appWindow.setTitle(`${doc.name} — ${APP_NAME}`);
  render(fragment);
}

/** Reads the document again: when it changed (`report` false: a file being saved may be missing for a moment), or from the menu. */
async function reload(report: boolean): Promise<void> {
  const path = current?.path;
  if (!path) {
    return;
  }
  try {
    const doc = await invoke<OpenedDocument>('open_document', { path });
    // Unless another document was opened meanwhile.
    if (current?.path === path) {
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

function savedTheme(): PreviewTheme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

let theme = savedTheme();

function applyTheme(): void {
  const dark = theme === 'auto' ? systemDark.matches : theme === 'dark';
  document.body.classList.toggle('vscode-dark', dark);
  document.body.classList.toggle('vscode-light', !dark);
}

applyTheme();
systemDark.addEventListener('change', applyTheme);

// ---------------------------------------------------------------------------
// Menu

const THEMES: [PreviewTheme, string][] = [
  ['auto', 'Follow the System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

async function setUpMenu(): Promise<void> {
  const mac = navigator.userAgent.includes('Mac');
  const themeItems: CheckMenuItem[] = [];
  const setTheme = (value: PreviewTheme) => {
    theme = value;
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch {
      // Not kept for the next launch.
    }
    applyTheme();
    // A check item checks itself when clicked.
    themeItems.forEach((item, i) => void item.setChecked(THEMES[i][0] === value));
  };
  for (const [value, text] of THEMES) {
    themeItems.push(await CheckMenuItem.new({ text: t(text), checked: value === theme, action: () => setTheme(value) }));
  }
  const separator = () => PredefinedMenuItem.new({ item: 'Separator' });

  const file = await Submenu.new({
    text: t('&File'),
    items: [
      await MenuItem.new({ text: t('&Open...'), accelerator: 'CmdOrCtrl+O', action: () => void chooseDocument() }),
      await MenuItem.new({ text: t('&Reload'), accelerator: 'CmdOrCtrl+R', action: () => void reload(true) }),
      // On macOS in the app menu.
      ...(mac ? [] : [await separator(), await MenuItem.new({ text: t('E&xit'), action: () => void appWindow.close() })]),
    ],
  });
  const view = await Submenu.new({
    text: t('&View'),
    items: [await Submenu.new({ text: t('&Theme'), items: themeItems })],
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
      text: t('&Edit'),
      items: [await PredefinedMenuItem.new({ item: 'Copy' }), await PredefinedMenuItem.new({ item: 'SelectAll' })],
    });
    items.splice(0, 0, app);
    items.splice(2, 0, edit);
  }
  await (await Menu.new({ items })).setAsAppMenu();
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
