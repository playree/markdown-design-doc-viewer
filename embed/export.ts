/**
 * Exports a design document to a single HTML file, the same as the extension's "Export Design Doc as HTML" and the
 * command line's (`md-design-doc export`): its styles and script inlined, with the light theme, without the warnings.
 * Its diagrams are rendered in the page, as the viewer does (with the styles of embed/viewer.css).
 *
 *   const { exportHtml } = await import('markdown-design-doc-viewer-embed/export');
 *   const html = await exportHtml({ markdown, lang: 'ja', resolveImage: toDataUri });
 *
 * A module of its own, as it has the styles and script of the exported page: the viewer (index.js) does not carry
 * them. It imports the viewer (index.js), which it shares the state of with the viewers of the page.
 */
import { exportCss, exportScript, webviewCss } from './exportAssets';
import { exportDocument, type ExportOptions } from './viewer';

export type { DiagramLook, ExportOptions } from './viewer';

/** The HTML file of the design document of `options`, as a string. */
export function exportHtml(options: ExportOptions): Promise<string> {
  if (!exportScript) {
    return Promise.reject(new Error('exportHtml was built without the styles and script of the exported page.'));
  }
  return exportDocument(options, { styles: [webviewCss, exportCss], script: exportScript });
}
