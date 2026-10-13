/** Messages exchanged between the extension host and the preview webview. */

/** Look of the mermaid diagrams: mermaid's default (`neo`, with shadows), or the flat `classic` one. */
export type DiagramLook = 'neo' | 'classic';

/** Color theme of the preview: VS Code's (`auto`), or always light / dark. */
export type PreviewTheme = 'auto' | 'light' | 'dark';

export type ToWebview =
  /**
   * Render this document. With another `uri` than the previous update (another document opened in the same
   * window, by the desktop app), the preview starts at the top, or at `fragment` (the id of a heading) when given.
   */
  | { type: 'update'; uri: string; html: string; splitMinWidth: number; syncEditor: boolean; toc: boolean; diagramLook: DiagramLook; theme: PreviewTheme; limitContentWidth: boolean; stickyTableHeader: boolean; fragment?: string }
  /** Editor scrolled: align the preview so that this line is at the top. */
  | { type: 'scrollToLine'; line: number }
  /** Editor cursor moved: mark the element for this line. */
  | { type: 'markLine'; line: number }
  /** Render this HTML for an exported file and send it back with `exported`. */
  | { type: 'export'; id: number; html: string; diagramLook: DiagramLook };

export type FromWebview =
  | { type: 'ready' }
  /** Double-click in the preview: reveal this line in the editor. */
  | { type: 'revealLine'; line: number }
  | { type: 'openLink'; href: string }
  /**
   * The rendered body of an `export` request, or why it failed. `diagramErrors` are the messages of the diagrams
   * mermaid could not render (shown in the body in their place).
   */
  | { type: 'exported'; id: number; body?: string; diagramErrors?: string[]; error?: string };

export interface WebviewState {
  uri: string;
  /** Width of the diagram column in percent. */
  split?: number;
}
