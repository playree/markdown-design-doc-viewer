/** Messages exchanged between the extension host and the preview webview. */

/** Look of the mermaid diagrams: mermaid's default (`neo`, with shadows), or the flat `classic` one. */
export type DiagramLook = 'neo' | 'classic';

export type ToWebview =
  | { type: 'update'; uri: string; html: string; splitMinWidth: number; syncEditor: boolean; toc: boolean; diagramLook: DiagramLook; limitContentWidth: boolean }
  /** Editor scrolled: align the preview so that this line is at the top. */
  | { type: 'scrollToLine'; line: number }
  /** Editor cursor moved: mark the element for this line. */
  | { type: 'markLine'; line: number }
  /** Render this HTML for an exported file and send it back with `exported`. */
  | { type: 'export'; id: number; html: string };

export type FromWebview =
  | { type: 'ready' }
  /** Double-click in the preview: reveal this line in the editor. */
  | { type: 'revealLine'; line: number }
  | { type: 'openLink'; href: string }
  /** The rendered body of an `export` request, or why it failed. */
  | { type: 'exported'; id: number; body?: string; error?: string };

export interface WebviewState {
  uri: string;
  /** Width of the diagram column in percent. */
  split?: number;
}
