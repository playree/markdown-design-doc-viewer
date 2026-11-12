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
 */
import ja from '../l10n/bundle.l10n.ja.json';
import { formatMessage, translatorFor, type Translate } from '../src/shared/l10n';
import type { DiagramLook, FromWebview, WebviewState } from '../src/shared/protocol';
import { createMarkdown, renderDocument } from '../src/markdown/render';
import { loadWireframes, wireframeSources } from '../src/markdown/wireframe';
import { createPreview } from '../webview/preview';
import { elementScrollHost, writeTitles } from '../webview/viewerContext';

export type { DiagramLook };

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
   * counts as 2). 0 does not break them. 30 by default.
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

/** The options that change the HTML of the document: it is rendered again when one of them changes. */
const CONTENT_OPTIONS = ['markdown', 'baseUrl', 'readFile', 'resolveResource', 'frontMatter', 'headingNumbers', 'messageWrapWidth'] as const;
/** The options of the preview, sent with the HTML rendered last when only they change. */
const VIEW_OPTIONS = ['documentId', 'splitMinWidth', 'toc', 'diagramLook', 'limitContentWidth', 'stickyTableHeader', 'tableTreeHighlight'] as const;

/** Shows the design document of `options` in `container`, which it fills. */
export function createViewer(container: HTMLElement, options: ViewerOptions): Viewer {
  let current: ViewerOptions = { ...options };
  const lang = options.lang ?? (navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en');
  const t: Translate = lang === 'ja' ? translatorFor(ja) : formatMessage;

  const el = document.createElement('div');
  el.className = 'seqnotes-viewer seqnotes-embedded';
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
      (current.onOpenLink ?? openLinkInNewTab)(message.href);
    } else if (message.type === 'revealLine') {
      current.onRevealLine?.(message.line);
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
    const dark = current.theme === 'dark' || (current.theme !== 'light' && systemDark.matches);
    el.classList.toggle('vscode-dark', dark);
    el.classList.toggle('vscode-light', !dark);
  };
  systemDark.addEventListener('change', applyTheme);
  applyTheme();

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
    const read = current.readFile ?? (baseUrl === undefined ? undefined : fetchFrom(baseUrl));
    const resolveResource = current.resolveResource ?? (baseUrl === undefined ? undefined : (src: string) => resolveUrl(src, baseUrl) ?? src);
    // A file that cannot be read is shown as such, without the document failing.
    const readFile = read && ((path: string) => Promise.resolve().then(() => read(path)).catch(() => undefined));
    const wireframes = readFile ? await loadWireframes(md, wireframeSources(md.parse(markdown, {})), readFile) : undefined;
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
      preview.destroy();
      systemDark.removeEventListener('change', applyTheme);
      stopSizing();
      el.remove();
      resolveReady();
    },
  };
}
