import * as path from 'node:path';
import * as vscode from 'vscode';
import { documentTitle, exportFileName, exportPage, imagePath, imageType, renderForExport, stripSourceMap } from './exportPage';
import { readSettings, resolveDocumentPath, type PreviewManager, type Settings } from './previewPanel';
import { createMarkdown } from './render';

/** A link to `image` from the exported file: relative to it when possible, so that it works next to it. */
function linkFrom(target: vscode.Uri, image: vscode.Uri): string {
  if (image.scheme !== target.scheme || image.authority !== target.authority) {
    return image.toString();
  }
  return path.posix.relative(path.posix.dirname(target.path), image.path).split('/').map(encodeURIComponent).join('/');
}

/** true when `uri` is in `folder` (or is it). */
function isIn(uri: vscode.Uri, folder: vscode.Uri): boolean {
  const dir = folder.path.endsWith('/') ? folder.path : `${folder.path}/`;
  return uri.scheme === folder.scheme && uri.authority === folder.authority && (uri.path === folder.path || uri.path.startsWith(dir));
}

/**
 * The folders whose images are embedded: the same as the preview can show (`localResourceRoots`), so that an
 * export does not put other local files into a file to be shared.
 */
function embeddableFolders(document: vscode.Uri): vscode.Uri[] {
  return [vscode.Uri.joinPath(document, '..'), ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri)];
}

/** Renders the document for the exported file, with its local images embedded as data URIs. */
function renderWithImages(md: ReturnType<typeof createMarkdown>, source: string, uri: vscode.Uri, target: vscode.Uri, settings: Settings): Promise<string> {
  const folders = embeddableFolders(uri);
  return renderForExport(md, source, { t: vscode.l10n.t, frontMatter: settings.frontMatter, headingNumbers: settings.headingNumbers }, async (src) => {
    const image = resolveDocumentPath(uri, imagePath(src));
    const type = imageType(image.path);
    try {
      if (type && folders.some((folder) => isIn(image, folder))) {
        return `data:${type};base64,${Buffer.from(await vscode.workspace.fs.readFile(image)).toString('base64')}`;
      }
    } catch {
      // Linked instead, see below.
    }
    // An image of an unknown type, outside those folders or that cannot be read is linked instead,
    // which works as long as the files stay where they are.
    return linkFrom(target, image);
  });
}

async function readDist(extensionUri: vscode.Uri, name: string): Promise<string> {
  return stripSourceMap(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, 'dist', name))));
}

/** The default file to save to: next to the document, with `.html` instead of `.md`. */
function defaultTarget(uri: vscode.Uri): vscode.Uri | undefined {
  const name = exportFileName(uri.path.split('/').pop() ?? 'document');
  if (uri.scheme === 'file') {
    return vscode.Uri.joinPath(uri, '..', name);
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder && vscode.Uri.joinPath(folder.uri, name);
}

/**
 * Exports the document to a single HTML file: the diagrams as rendered by the preview (light theme),
 * the images embedded, and a small script for the side-by-side layout and the arrow ⇔ step highlighting.
 */
export async function exportHtml(manager: PreviewManager, extensionUri: vscode.Uri, uri: vscode.Uri): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: defaultTarget(uri),
    filters: { HTML: ['html', 'htm'] },
    title: vscode.l10n.t('Export Design Doc as HTML'),
  });
  if (!target) {
    return;
  }

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Exporting {0}...', uri.path.split('/').pop() ?? '') },
      async () => {
        const md = createMarkdown();
        const settings = readSettings();
        const source = (await vscode.workspace.openTextDocument(uri)).getText();
        const html = await renderWithImages(md, source, uri, target, settings);
        const preview = await manager.readyPreview(uri);
        const [body, style, exportStyle, script] = await Promise.all([
          preview.renderForExport(html, settings.diagramLook),
          readDist(extensionUri, 'webview.css'),
          readDist(extensionUri, 'export.css'),
          readDist(extensionUri, 'export.js'),
        ]);
        const page = exportPage({
          lang: vscode.env.language,
          title: documentTitle(md, source, uri.path.split('/').pop() ?? ''),
          body,
          styles: [style, exportStyle],
          script,
          settings,
        });
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(page));
      },
    );
  } catch (error) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Could not export the design doc: {0}', error instanceof Error ? error.message : String(error)));
    return;
  }

  const open = vscode.l10n.t('Open in Browser');
  if ((await vscode.window.showInformationMessage(vscode.l10n.t('Exported to {0}.', target.path.split('/').pop() ?? ''), open)) === open) {
    await vscode.env.openExternal(target);
  }
}
