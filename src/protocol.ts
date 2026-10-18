/** Messages exchanged between the extension host and the preview webview. */

/** Look of the mermaid diagrams: mermaid's default (`neo`, with shadows), or the flat `classic` one. */
export type DiagramLook = 'neo' | 'classic';

/** Color theme of the preview: VS Code's (`auto`), or always light / dark. */
export type PreviewTheme = 'auto' | 'light' | 'dark';

/** The differences from a revision shown by an `update` (`renderDiff` in diffRender.ts). */
export interface DiffView {
  /** What the document is compared with, translated (e.g. the commit). */
  label: string;
  /** HTML of the revision's blocks that changed, by their `data-seqnotes-diff-old`. */
  old: string[];
  stats: { added: number; changed: number; deleted: number };
}

export type ToWebview =
  /**
   * Render this document. With another `uri` than the previous update (another document opened in the same
   * window, by the desktop app), the preview starts at the top, or at `fragment` (the id of a heading) when given.
   * With `diff`, the HTML is that of `renderDiff`, and the preview shows the differences.
   */
  | { type: 'update'; uri: string; html: string; splitMinWidth: number; syncEditor: boolean; toc: boolean; diagramLook: DiagramLook; theme: PreviewTheme; limitContentWidth: boolean; stickyTableHeader: boolean; tableTreeHighlight: boolean; fragment?: string; diff?: DiffView }
  /** Editor scrolled: align the preview so that this line is at the top. */
  | { type: 'scrollToLine'; line: number }
  /** Editor cursor moved: mark the element for this line. */
  | { type: 'markLine'; line: number }
  /** Render this HTML for an exported file and send it back with `exported`. With `diff`, the HTML is that of `renderDiff`. */
  | { type: 'export'; id: number; html: string; diagramLook: DiagramLook; diff?: DiffView };

export type FromWebview =
  | { type: 'ready' }
  /** Double-click in the preview: reveal this line in the editor. */
  | { type: 'revealLine'; line: number }
  | { type: 'openLink'; href: string }
  /**
   * The rendered body of an `export` request, or why it failed. `diagramErrors` are the messages of the diagrams
   * mermaid could not render (shown in the body in their place).
   */
  | { type: 'exported'; id: number; body?: string; diagramErrors?: string[]; error?: string }
  /** The differences shown are closed: back to the document alone. */
  | { type: 'closeDiff' };

export interface WebviewState {
  uri: string;
  /** Width of the diagram column in percent. */
  split?: number;
  /** The search and the order of a list of documents (webview/indexList.ts). */
  indexList?: IndexListState;
}

/** What a list of documents shows (webview/indexList.ts): kept while the list is updated. */
export interface IndexListState {
  query: string;
  /**
   * The column the rows are sorted by (its `data-seqnotes-column`: `title`, `file` or a key of the front matter),
   * and the order; the order of the list without it.
   */
  sort?: { column: string; descending: boolean };
}

/**
 * Titles (tooltips) and labels of the preview's controls, in English: the host translates them and writes them on the
 * body as `data-seqnotes-<name>` attributes, which the webview reads (and fills in their `{0}`).
 */
export const WEBVIEW_TITLES: Record<string, string> = {
  'splitter-title': 'Drag to resize, double-click to reset',
  'hide-warnings-title': 'Hide warnings',
  'toc-title': 'Contents',
  'zoom-title': 'Zoom diagram',
  'zoom-image-title': 'Zoom image',
  'zoom-in-title': 'Zoom in',
  'zoom-out-title': 'Zoom out',
  'zoom-fit-title': 'Fit to window',
  'zoom-close-title': 'Close',
  'diff-added': '{0} added',
  'diff-changed': '{0} changed',
  'diff-deleted': '{0} deleted',
  'diff-no-changes': 'No changes',
  'diff-previous-title': 'Previous change',
  'diff-next-title': 'Next change',
  'diff-close-title': 'Stop comparing',
  'diff-hide-title': 'Hide changes',
  'diff-show-title': 'Show changes',
  'diff-old-diagram': 'Diagram before the change',
};
