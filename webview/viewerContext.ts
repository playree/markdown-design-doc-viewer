/**
 * Where a viewer is: the element it is shown in and what scrolls it. The preview in VS Code and the desktop app, and an
 * exported page, take the whole page (the body, the window); other viewers in the same page each keep to their element.
 */
import type { FromWebview, WebviewState } from '../src/protocol';

/** A rectangle in client coordinates (of `getBoundingClientRect`). */
export interface ViewportRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

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
  };
}

/** A viewer: the preview of a document (preview.ts), which its host (main.ts) talks to. */
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
