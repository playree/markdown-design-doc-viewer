/**
 * A viewer of a design document embedded in an element of another page (a React app, for instance: embed/react.tsx):
 * the preview of the extension (webview/preview.ts), in the element, which it scrolls by itself. It renders the
 * Markdown it is given as the desktop app does (desktop/host.ts), with the files of the wireframes read by `readFile`.
 * Its styles are embed/viewer.css.
 *
 *   const viewer = createViewer(element, { markdown, baseUrl: 'https://example.com/docs/' });
 *   await viewer.update({ markdown: edited });
 *   viewer.destroy();
 *
 * The element needs a height: the viewer fills it and scrolls inside it.
 *
 * `createDesignDocList` shows a list of design documents in the same way, as high as the list.
 */
import ja from '../l10n/bundle.l10n.ja.json';
import { formatMessage, translatorFor, type Translate } from '../src/shared/l10n';
import { WEBVIEW_TITLES, type DiagramLook, type FromWebview, type WebviewState } from '../src/shared/protocol';
import { documentTitle, exportPage, renderForExport } from '../src/export/exportPage';
import { createMarkdown, renderDocument } from '../src/markdown/render';
import { loadWireframes, wireframeSources, type WireframeFiles } from '../src/markdown/wireframe';
import { createPreview } from '../webview/preview';
import { elementScrollHost, writeTitles } from '../webview/viewerContext';
import { designDocListHtml, type DesignDocListContent } from './designDocList';

export type { DiagramLook };
export type { DesignDocListContent, DesignDocListDocument } from './designDocList';

export interface ViewerOptions {
  /** The Markdown of the design document. */
  markdown: string;
  /**
   * Tells the documents apart: when it changes, the viewer shows another document, from its top. While it stays the
   * same, an update keeps the scrolling, as when the document is edited.
   */
  documentId?: string;
  /**
   * The URL of the folder of the document, from which the paths of its images and wireframes are resolved (and the
   * wireframes read with `fetch`, without `readFile`).
   */
  baseUrl?: string;
  /**
   * Reads a file of a wireframe (its HTML, or a style sheet of it), given its path as written in the document (relative
   * to it, or to the root with a leading `/`), decoded (`%20` is a space). Returns undefined when it cannot be read.
   */
  readFile?: (path: string) => Promise<string | undefined>;
  /** The URL of an image `src` of the document. By default, resolved from `baseUrl`. */
  resolveResource?: (src: string) => string;
  /** The language of the texts of the viewer (`en` by default, or that of the browser). Only read by `createViewer`. */
  lang?: 'en' | 'ja';
  /** Light or dark colors, or those of the system (`auto`, the default). */
  theme?: 'light' | 'dark' | 'auto';
  /** `neo` (the default) or `classic` (flat) diagrams. */
  diagramLook?: DiagramLook;
  /** The width (px) from which the diagrams and their steps are side by side. 1000 by default. */
  splitMinWidth?: number;
  /** The table of contents at the right. true by default. */
  toc?: boolean;
  /** Limits the width of the document. true by default. */
  limitContentWidth?: boolean;
  /** Keeps the header row of a long table at the top while it scrolls. true by default. */
  stickyTableHeader?: boolean;
  /** Highlights the parent and children of a row of a table shown as a tree. true by default. */
  tableTreeHighlight?: boolean;
  /** Shows the front matter (as the header of a design document, or as a table). true by default. */
  frontMatter?: boolean;
  /** Shows the `autonumber` numbers on the linked headings. true by default. */
  headingNumbers?: boolean;
  /**
   * Breaks the labels of the arrows of the sequence diagrams into lines at this many characters (a full-width one
   * counts as 2). 0 does not break them. 40 by default.
   */
  messageWrapWidth?: number;
  /**
   * Opens a link of the document (other than `#heading`, which the viewer scrolls to). By default, http(s) and mailto
   * links open in a new tab, and the others do nothing.
   */
  onOpenLink?: (href: string) => void;
  /** Called with the line (0-based) of the Markdown double-clicked in the viewer, e.g. to show it in an editor. */
  onRevealLine?: (line: number) => void;
}

export interface Viewer {
  /** Resolves once the document is shown, with its diagrams (that of `createViewer`, or of an update made meanwhile). */
  ready: Promise<void>;
  /** Changes some options (all but `lang`) and renders the document again. Resolves once it is shown (or superseded). */
  update(options: Partial<Omit<ViewerOptions, 'lang'>>): Promise<void>;
  /** Scrolls the viewer so that this line (0-based) of the Markdown is at the top. */
  scrollToLine(line: number): void;
  /** Marks the element of this line (0-based), and scrolls it into view: e.g. the line of the cursor of an editor. */
  markLine(line: number): void;
  /** Removes the viewer from its element. */
  destroy(): void;
}

/** What `onOpenLink` does by default: opens http(s) and mailto links in a new tab. */
export function openLinkInNewTab(href: string): void {
  if (/^(?:https?|mailto):/i.test(href)) {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

const md = createMarkdown();

/** The number of viewers created, which starts the ids of their elements. */
let viewers = 0;

/** The language of the texts of a viewer: `lang`, or that of the browser. */
function langOf(lang: ViewerOptions['lang']): 'en' | 'ja' {
  return lang ?? (navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en');
}

/** The translation of the texts into `lang`. */
function translator(lang: 'en' | 'ja'): Translate {
  return lang === 'ja' ? translatorFor(ja) : formatMessage;
}

/** Resolves `path` from `baseUrl`, or undefined when it is not a URL. */
function resolveUrl(path: string, baseUrl: string): string | undefined {
  try {
    return new URL(path, baseUrl).href;
  } catch {
    return undefined;
  }
}

/** Reads a file with `fetch`, from `baseUrl`. */
function fetchFrom(baseUrl: string): (path: string) => Promise<string | undefined> {
  return async (path) => {
    // Decoded from the document (`%23` is `#` in the name of the file): encoded again for the URL.
    const url = resolveUrl(path.split('/').map(encodeURIComponent).join('/'), baseUrl);
    if (url === undefined) {
      return undefined;
    }
    try {
      const response = await fetch(url);
      return response.ok ? await response.text() : undefined;
    } catch {
      return undefined;
    }
  };
}

/**
 * Reads the files of the wireframes of `markdown` with `readFile`, or with `fetch` from `baseUrl`; undefined without
 * either. A file that cannot be read is shown as such, without the document failing.
 */
async function readWireframes(markdown: string, { readFile, baseUrl }: Pick<ViewerOptions, 'readFile' | 'baseUrl'>): Promise<WireframeFiles | undefined> {
  const read = readFile ?? (baseUrl === undefined ? undefined : fetchFrom(baseUrl));
  if (!read) {
    return undefined;
  }
  return loadWireframes(md, wireframeSources(md.parse(markdown, {})), (path) => Promise.resolve().then(() => read(path)).catch(() => undefined));
}

/** The options that change the HTML of the document: it is rendered again when one of them changes. */
const CONTENT_OPTIONS = ['markdown', 'baseUrl', 'readFile', 'resolveResource', 'frontMatter', 'headingNumbers', 'messageWrapWidth'] as const;
/** The options of the preview, sent with the HTML rendered last when only they change. */
const VIEW_OPTIONS = ['documentId', 'splitMinWidth', 'toc', 'diagramLook', 'limitContentWidth', 'stickyTableHeader', 'tableTreeHighlight'] as const;

/** What the element of a viewer (`mountViewer`) reads from its options each time. */
type MountOptions = Pick<ViewerOptions, 'theme' | 'onOpenLink' | 'onRevealLine'>;

/** The element of a viewer in `container`, with its preview and colors. */
interface MountedViewer {
  preview: ReturnType<typeof createPreview>;
  /** Sets the colors of the theme of now (`options().theme`). */
  applyTheme(): void;
  /** Removes the element. */
  destroy(): void;
}

/**
 * Creates the element of a viewer in `container` (`.seqnotes-viewer.seqnotes-embedded`, with `className`) and its
 * preview, whose links and double-clicks go to the callbacks of `options()`.
 */
function mountViewer(container: HTMLElement, lang: 'en' | 'ja', t: Translate, options: () => MountOptions, className = ''): MountedViewer {
  const el = document.createElement('div');
  el.className = `seqnotes-viewer seqnotes-embedded ${className}`.trim();
  el.lang = lang;
  el.dataset.seqnotesTheme = 'auto';
  writeTitles(el, t);
  const scroller = document.createElement('div');
  scroller.className = 'seqnotes-viewer-scroller';
  const root = document.createElement('div');
  root.className = 'seqnotes-viewer-root';
  scroller.append(root);
  el.append(scroller);
  container.append(el);

  const scroll = elementScrollHost(scroller);
  // For embed/viewer.css: the height of the sticky diagram columns, and the place of the table of contents.
  const stopSizing = scroll.onResize(() => {
    el.style.setProperty('--seqnotes-viewport-height', `${scroller.clientHeight}px`);
    el.style.setProperty('--seqnotes-scrollbar-width', `${scroller.offsetWidth - scroller.clientWidth - scroller.clientLeft * 2}px`);
  });

  let state: WebviewState | undefined;
  const post = (message: FromWebview): void => {
    if (message.type === 'openLink') {
      (options().onOpenLink ?? openLinkInNewTab)(message.href);
    } else if (message.type === 'revealLine') {
      options().onRevealLine?.(message.line);
    }
  };
  const preview = createPreview({
    el,
    root,
    scroll,
    idPrefix: `seqnotes-viewer-${++viewers}`,
    post,
    getState: () => state,
    setState: (next) => (state = next),
  });

  // The colors: the class VS Code sets on the body for its theme, read by preview.css, webview/theme.css and the
  // diagrams, which the preview renders again when it changes.
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = (): void => {
    const { theme } = options();
    const dark = theme === 'dark' || (theme !== 'light' && systemDark.matches);
    el.classList.toggle('vscode-dark', dark);
    el.classList.toggle('vscode-light', !dark);
  };
  systemDark.addEventListener('change', applyTheme);
  applyTheme();

  return {
    preview,
    applyTheme,
    destroy() {
      preview.destroy();
      systemDark.removeEventListener('change', applyTheme);
      stopSizing();
      el.remove();
    },
  };
}

/** Shows the design document of `options` in `container`, which it fills. */
export function createViewer(container: HTMLElement, options: ViewerOptions): Viewer {
  let current: ViewerOptions = { ...options };
  const lang = langOf(options.lang);
  const t = translator(lang);
  const { preview, applyTheme, destroy: unmount } = mountViewer(container, lang, t, () => current);

  let destroyed = false;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  /** The HTML rendered last. */
  let html: string | undefined;
  /** The last render started, whether it is under way, and its number: an older one that ends later is not shown. */
  let rendering: Promise<void> = Promise.resolve();
  let pending = false;
  let renders = 0;
  /** The number of the last HTML sent to the preview. */
  let shown = 0;

  /** Sends the HTML to the preview with the options of now. Resolves once it is shown, or superseded by another. */
  async function show(rendered: string): Promise<void> {
    const seq = ++shown;
    await preview.handle({
      type: 'update',
      uri: current.documentId ?? '',
      html: rendered,
      splitMinWidth: current.splitMinWidth ?? 1000,
      syncEditor: current.onRevealLine !== undefined,
      toc: current.toc ?? true,
      diagramLook: current.diagramLook ?? 'neo',
      // The colors follow the class of the viewer (applyTheme).
      theme: 'auto',
      limitContentWidth: current.limitContentWidth ?? true,
      stickyTableHeader: current.stickyTableHeader ?? true,
      tableTreeHighlight: current.tableTreeHighlight ?? true,
    });
    if (seq === shown) {
      resolveReady();
    }
  }

  async function render(): Promise<void> {
    const seq = ++renders;
    pending = true;
    const { markdown, baseUrl } = current;
    const resolveResource = current.resolveResource ?? (baseUrl === undefined ? undefined : (src: string) => resolveUrl(src, baseUrl) ?? src);
    const wireframes = await readWireframes(markdown, current);
    if (destroyed || seq !== renders) {
      return;
    }
    pending = false;
    html = renderDocument(md, markdown, { t, frontMatter: current.frontMatter, headingNumbers: current.headingNumbers, messageWrapWidth: current.messageWrapWidth, wireframes, resolveResource });
    await show(html);
  }

  rendering = render();

  return {
    ready,
    update(changes) {
      if (destroyed) {
        return Promise.resolve();
      }
      const previous = current;
      current = { ...current, ...changes, lang: current.lang };
      applyTheme();
      if (html === undefined || CONTENT_OPTIONS.some((name) => current[name] !== previous[name])) {
        rendering = render();
        return rendering;
      }
      // The render under way takes the options of now.
      if (pending) {
        return rendering;
      }
      const revealing = (options: ViewerOptions): boolean => options.onRevealLine !== undefined;
      if (VIEW_OPTIONS.some((name) => current[name] !== previous[name]) || revealing(current) !== revealing(previous)) {
        return show(html);
      }
      return Promise.resolve();
    },
    scrollToLine(line) {
      void preview.handle({ type: 'scrollToLine', line });
    },
    markLine(line) {
      void preview.handle({ type: 'markLine', line });
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      unmount();
      resolveReady();
    },
  };
}

// ---------------------------------------------------------------------------
// The list of the design documents, as in the extension and the desktop app.

/** The options of `createDesignDocList`. */
export interface DesignDocListOptions extends DesignDocListContent, Pick<ViewerOptions, 'theme' | 'limitContentWidth'> {
  /** The language of the texts of the list (`en` by default, or that of the browser). Only read by `createDesignDocList`. */
  lang?: 'en' | 'ja';
  /** Opens the link of a title (`href` of its document). By default, goes to it in the page (`openLinkInPage`). */
  onOpenLink?: (href: string) => void;
}

export interface DesignDocList {
  /** Resolves once the list is shown. */
  ready: Promise<void>;
  /** Changes some options (all but `lang`) and shows the list again, keeping its search and order. */
  update(options: Partial<Omit<DesignDocListOptions, 'lang'>>): Promise<void>;
  /** Removes the list from its element. */
  destroy(): void;
}

/** The document of a list, which stays the same so that the search and order of the list are kept across updates. */
const LIST_URI = 'seqnotes-design-doc-list';

/** The options that change the HTML of a list: it is made again when one of them changes. */
const LIST_CONTENT_OPTIONS = ['documents', 'title', 'fileLabel', 'filterPlaceholder', 'empty', 'keepOrder'] as const;

/** The schemes of the links that run a script, which a list does not go to. */
const SCRIPT_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:']);

/**
 * What `onOpenLink` of a list does by default: goes to the link in the page, as the links of a list are those of the
 * app (except `javascript:`, `data:` and `vbscript:` ones).
 */
export function openLinkInPage(href: string): void {
  // From the URL as the browser parses it, which removes tabs and newlines (`java\tscript:`).
  let url: URL;
  try {
    url = new URL(href, document.baseURI);
  } catch {
    return;
  }
  if (!SCRIPT_SCHEMES.has(url.protocol)) {
    window.location.assign(url.href);
  }
}

/**
 * Shows the list of the design documents of `options` in `container`: a table for each folder, with the main entries
 * of their front matter, a search box and sortable columns. Unlike a viewer, it does not scroll inside the element:
 * it is as high as the list.
 */
export function createDesignDocList(container: HTMLElement, options: DesignDocListOptions): DesignDocList {
  let current: DesignDocListOptions = { ...options };
  const lang = langOf(options.lang);
  const t = translator(lang);
  const { preview, applyTheme, destroy: unmount } = mountViewer(
    container,
    lang,
    t,
    () => ({ ...current, onOpenLink: current.onOpenLink ?? openLinkInPage }),
    'seqnotes-embedded-list',
  );

  let destroyed = false;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  /** The HTML of the list, made again only when its content changes (not for the theme, for instance). */
  let html = designDocListHtml(md, current, t);
  /** The number of the last HTML sent to the preview: an older one that ends later does not resolve `ready`. */
  let shown = 0;
  async function show(): Promise<void> {
    if (destroyed) {
      return;
    }
    const seq = ++shown;
    await preview.handle({
      type: 'update',
      uri: LIST_URI,
      html,
      splitMinWidth: 1000,
      syncEditor: false,
      toc: false,
      diagramLook: 'neo',
      theme: 'auto',
      limitContentWidth: current.limitContentWidth ?? true,
      stickyTableHeader: false,
      tableTreeHighlight: false,
    });
    if (seq === shown) {
      resolveReady();
    }
  }
  void show();

  return {
    ready,
    update(changes) {
      if (destroyed) {
        return Promise.resolve();
      }
      const previous = current;
      current = { ...current, ...changes, lang: current.lang };
      applyTheme();
      if (LIST_CONTENT_OPTIONS.some((name) => current[name] !== previous[name])) {
        html = designDocListHtml(md, current, t);
      }
      return show();
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      unmount();
      resolveReady();
    },
  };
}

// ---------------------------------------------------------------------------
// HTML export: exportHtml of export.js (embed/export.ts), which imports index.js to share the state of the viewers
// (mermaid, configured globally, renders the diagrams of one viewer at a time). The styles and script of the exported
// page are only in export.js.

/** The options of `exportHtml` (`markdown-design-doc-viewer-embed/export`). */
export interface ExportOptions
  extends Pick<
    ViewerOptions,
    | 'markdown'
    | 'baseUrl'
    | 'readFile'
    | 'diagramLook'
    | 'splitMinWidth'
    | 'toc'
    | 'limitContentWidth'
    | 'stickyTableHeader'
    | 'tableTreeHighlight'
    | 'frontMatter'
    | 'headingNumbers'
    | 'messageWrapWidth'
  > {
  /** The language of the texts of the exported file: `en`, or `ja`. That of the browser by default. */
  lang?: 'en' | 'ja';
  /** The title of the page when the document has none (neither `title` in its front matter nor a `#` heading). */
  title?: string;
  /**
   * What an image of the document (a path, not a URL) becomes in the exported file: a data URI to embed it, or a URL to
   * link it. It is given the `src` of the image without its query and fragment (`icons.svg` of `icons.svg#save`), which
   * are added back to a URL. By default, resolved from `baseUrl` (or left as it is without it). When it fails, the
   * `src` is kept.
   */
  resolveImage?: (path: string) => string | Promise<string>;
}

/**
 * The styles and script of an exported page: dist/webview.css and dist/export.css, and dist/export.js.
 * @internal
 */
export interface ExportAssets {
  styles: string[];
  script: string;
}

/** The number of documents exported, which starts the ids of their elements. */
let exportCount = 0;

/**
 * Renders the HTML of an exported file (`renderForExport`) with its diagrams, as the preview does for the export
 * command: in a viewer out of sight, removed once it is done (or failed). A diagram that fails is in the body, with
 * its error, as in an exported file.
 */
async function renderExportBody(html: string, t: Translate, diagramLook: DiagramLook): Promise<string> {
  const el = document.createElement('div');
  el.className = 'seqnotes-viewer seqnotes-embedded vscode-light';
  el.dataset.seqnotesTheme = 'light';
  el.setAttribute('aria-hidden', 'true');
  // Rendered (mermaid measures the diagrams in it), but not seen: with the styles of viewer.css, as a viewer.
  el.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: hidden; visibility: hidden; pointer-events: none;';
  writeTitles(el, t);
  const root = document.createElement('div');
  root.className = 'seqnotes-viewer-root';
  el.append(root);
  document.body.append(el);
  let state: WebviewState | undefined;
  let preview: ReturnType<typeof createPreview> | undefined;
  try {
    const exported = new Promise<Extract<FromWebview, { type: 'exported' }>>((resolve) => {
      preview = createPreview({
        el,
        root,
        scroll: elementScrollHost(root),
        idPrefix: `seqnotes-export-${++exportCount}`,
        post: (message) => message.type === 'exported' && resolve(message),
        getState: () => state,
        setState: (next) => (state = next),
      });
    });
    await preview!.handle({ type: 'export', id: 1, html, diagramLook });
    const { body, error } = await exported;
    if (body === undefined) {
      throw new Error(error ?? 'The diagrams could not be rendered.');
    }
    return body;
  } finally {
    preview?.destroy();
    el.remove();
  }
}

/**
 * The exported HTML file of `options.markdown`, with `assets`: what `exportHtml` (embed/export.ts) returns.
 * @internal
 */
export async function exportDocument(options: ExportOptions, assets: ExportAssets): Promise<string> {
  const lang = langOf(options.lang);
  const t = translator(lang);
  const { markdown, baseUrl } = options;
  const wireframes = await readWireframes(markdown, options);
  const resolveImage = options.resolveImage ?? ((path: string) => (baseUrl === undefined ? path : (resolveUrl(path, baseUrl) ?? path)));
  // Without its query and fragment, which renderForExport adds back to a URL.
  const image = (src: string): Promise<string> => {
    const [path] = src.split(/[?#]/, 1);
    return Promise.resolve()
      .then(() => resolveImage(path))
      .then(
        (url) => (typeof url === 'string' ? url : path),
        () => path,
      );
  };
  const html = await renderForExport(md, markdown, { t, frontMatter: options.frontMatter, headingNumbers: options.headingNumbers, messageWrapWidth: options.messageWrapWidth, wireframes }, image);
  const body = await renderExportBody(html, t, options.diagramLook ?? 'neo');
  return exportPage({
    lang,
    title: documentTitle(md, markdown, options.title ?? ''),
    body,
    styles: assets.styles,
    script: assets.script,
    settings: {
      limitContentWidth: options.limitContentWidth ?? true,
      stickyTableHeader: options.stickyTableHeader ?? true,
      tableTreeHighlight: options.tableTreeHighlight ?? true,
      splitMinWidth: options.splitMinWidth ?? 1000,
      toc: options.toc ?? true,
    },
    tocTitle: t(WEBVIEW_TITLES['toc-title']),
    splitterTitle: t(WEBVIEW_TITLES['splitter-title']),
  });
}
