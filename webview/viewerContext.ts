/**
 * Where a viewer is: the element it is shown in and what scrolls it. The preview in VS Code and the desktop app, and an
 * exported page, take the whole page (the body, the window); a viewer embedded in another page (embed/viewer.ts) takes
 * an element of it, which scrolls by itself.
 */
import type { Translate } from '../src/shared/l10n';
import { WEBVIEW_TITLES, type FromWebview, type WebviewState } from '../src/shared/protocol';

/** A rectangle in client coordinates (of `getBoundingClientRect`). */
export interface ViewportRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

/** Where `ScrollHost.reveal` puts an element: as `block` of `scrollIntoView`. */
export type RevealBlock = 'start' | 'center' | 'nearest';

/** What scrolls the document of a viewer: the window, or an element. */
export interface ScrollHost {
  /** How far the document is scrolled down, in px. */
  top(): number;
  scrollTo(top: number): void;
  scrollBy(dy: number): void;
  /** The part of the screen the document is seen through. */
  viewport(): ViewportRect;
  /** The height of the whole document that scrolls, in px. */
  scrollHeight(): number;
  /** Calls `listener` when the document scrolls. Returns what removes it. */
  onScroll(listener: () => void): () => void;
  /** Calls `listener` when the viewport changes size. Returns what removes it. */
  onResize(listener: () => void): () => void;
  /**
   * Scrolls `el` into view, as `scrollIntoView` does in the page. An embedded viewer scrolls only itself, not the page
   * around it.
   */
  reveal(el: Element, block: RevealBlock, behavior?: ScrollBehavior): void;
}

/** The window scrolls the document: the page is the viewer's. */
export function windowScrollHost(): ScrollHost {
  return {
    top: () => window.scrollY,
    scrollTo: (top) => window.scrollTo(0, top),
    scrollBy: (dy) => window.scrollBy(0, dy),
    viewport: () => ({ top: 0, bottom: window.innerHeight, left: 0, width: window.innerWidth, height: window.innerHeight }),
    scrollHeight: () => document.documentElement.scrollHeight,
    onScroll(listener) {
      window.addEventListener('scroll', listener, { passive: true });
      return () => window.removeEventListener('scroll', listener);
    },
    onResize(listener) {
      window.addEventListener('resize', listener);
      return () => window.removeEventListener('resize', listener);
    },
    reveal: (el, block, behavior) => el.scrollIntoView({ block, behavior }),
  };
}

/** `scroller` scrolls the document by itself (`overflow: auto`). */
export function elementScrollHost(scroller: HTMLElement): ScrollHost {
  const host: ScrollHost = {
    top: () => scroller.scrollTop,
    scrollTo: (top) => scroller.scrollTo(0, top),
    scrollBy: (dy) => scroller.scrollBy(0, dy),
    viewport() {
      // Inside its borders, without its scrollbars.
      const r = scroller.getBoundingClientRect();
      const top = r.top + scroller.clientTop;
      // The width with its scrollbar, as that of the window: whether the diagrams are beside their steps does not depend
      // on whether the document is long enough to scroll.
      return { top, bottom: top + scroller.clientHeight, left: r.left + scroller.clientLeft, width: scroller.offsetWidth, height: scroller.clientHeight };
    },
    scrollHeight: () => scroller.scrollHeight,
    onScroll(listener) {
      scroller.addEventListener('scroll', listener, { passive: true });
      return () => scroller.removeEventListener('scroll', listener);
    },
    onResize(listener) {
      // Also called once when it starts observing.
      const observer = new ResizeObserver(() => listener());
      observer.observe(scroller);
      return () => observer.disconnect();
    },
    reveal(el, block, behavior = 'auto') {
      // scrollIntoView would also scroll the page to show the viewer: computed for the scroller only, with the
      // scroll-margin of the element.
      const r = el.getBoundingClientRect();
      const viewport = host.viewport();
      const style = getComputedStyle(el);
      const marginTop = parseFloat(style.scrollMarginTop) || 0;
      const marginBottom = parseFloat(style.scrollMarginBottom) || 0;
      const offset = scroller.scrollTop - viewport.top;
      const start = r.top - marginTop + offset;
      let top: number | undefined;
      if (block === 'start') {
        top = start;
      } else if (block === 'center') {
        top = r.top + r.height / 2 - viewport.height / 2 + offset;
      } else {
        const above = r.top - marginTop < viewport.top;
        const below = r.bottom + marginBottom > viewport.bottom;
        // Not taller than the viewport: its end at the bottom when it is below. Else its start at the top.
        if (above || (below && r.height + marginTop + marginBottom > viewport.height)) {
          top = start;
        } else if (below) {
          top = r.bottom + marginBottom - viewport.bottom + scroller.scrollTop;
        }
      }
      if (top !== undefined) {
        scroller.scrollTo({ top, behavior });
      }
    },
  };
  return host;
}

/**
 * Writes the titles of the viewer's controls translated with `t` on its element, as the extension host does on the body
 * (`shell()` in src/extension/previewPanel.ts).
 */
export function writeTitles(el: HTMLElement, t: Translate): void {
  for (const [name, title] of Object.entries(WEBVIEW_TITLES)) {
    el.setAttribute(`data-seqnotes-${name}`, t(title));
  }
}

/** A viewer: the preview of a document (preview.ts), which its host (main.ts, embed/viewer.ts) talks to. */
export interface ViewerContext {
  /**
   * The element of the viewer: its classes (`seqnotes-wide`, `vscode-light`…) and data attributes (the translated
   * titles, `data-seqnotes-theme`) are read and written there, and the overlays (table of contents, zoom…) are put
   * in it. The body for the page.
   */
  el: HTMLElement;
  /** Where the document is rendered, in `el`. */
  root: HTMLElement;
  scroll: ScrollHost;
  /**
   * Starts the ids of the elements the viewer makes (the SVGs of the diagrams), so that they differ from those of the
   * other viewers in the page.
   */
  idPrefix: string;
  /** Sends a message to the host. */
  post(message: FromWebview): void;
  getState(): WebviewState | undefined;
  setState(state: WebviewState): void;
}
