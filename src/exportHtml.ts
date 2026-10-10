import * as path from 'node:path';
import * as vscode from 'vscode';
import { headingText } from './linker';
import { parseFrontMatter } from './markdownExtras';
import { isExternalUrl, readSettings, resolveDocumentPath, safeDecode, type PreviewManager, type Settings } from './previewPanel';
import { createMarkdown, escapeHtml, renderDocument } from './render';

const IMAGE_TYPES: Record<string, string> = {
  apng: 'image/apng',
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/** Stands for a local image in the rendered HTML until it is embedded. */
const RESOURCE_PLACEHOLDER = 'seqnotes-export-resource:';
const PLACEHOLDER_RE = new RegExp(`${RESOURCE_PLACEHOLDER}(\\d+)`, 'g');

/** Title of the exported page: the `title` of the front matter, the first h1, or the file name. */
function documentTitle(md: ReturnType<typeof createMarkdown>, source: string, uri: vscode.Uri): string {
  const tokens = md.parse(source, {});
  const frontMatter = tokens[0]?.type === 'front_matter' ? parseFrontMatter(tokens[0].content) : [];
  const title = frontMatter.find((entry) => entry.key === 'title')?.value.trim();
  if (title) {
    return title;
  }
  const h1 = tokens.findIndex((t) => t.type === 'heading_open' && t.tag === 'h1');
  return (h1 >= 0 && headingText(tokens[h1 + 1]).trim()) || (uri.path.split('/').pop() ?? '');
}

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
async function renderWithImages(md: ReturnType<typeof createMarkdown>, source: string, uri: vscode.Uri, target: vscode.Uri, settings: Settings): Promise<string> {
  const images: vscode.Uri[] = [];
  const html = renderDocument(md, source, {
    t: vscode.l10n.t,
    frontMatter: settings.frontMatter,
    headingNumbers: settings.headingNumbers,
    forExport: true,
    // Synchronous, so the images are only collected here and read below.
    resolveResource: (src) => {
      if (isExternalUrl(src)) {
        return src;
      }
      const [imagePath] = src.split(/[?#]/, 1);
      images.push(resolveDocumentPath(uri, safeDecode(imagePath)));
      return `${RESOURCE_PLACEHOLDER}${images.length - 1}`;
    },
  });
  const folders = embeddableFolders(uri);
  const embedded = await Promise.all(
    images.map(async (image) => {
      const type = IMAGE_TYPES[image.path.split('.').pop()?.toLowerCase() ?? ''];
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
    }),
  );
  return html.replace(PLACEHOLDER_RE, (_, i: string) => escapeHtml(embedded[Number(i)]));
}

async function readDist(extensionUri: vscode.Uri, name: string): Promise<string> {
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, 'dist', name)));
  // Development builds point to source maps that are not exported.
  return text.replace(/\n?(?:\/\/# sourceMappingURL=.*|\/\*# sourceMappingURL=.*\*\/)\s*$/, '');
}

/** The default file to save to: next to the document, with `.html` instead of `.md`. */
function defaultTarget(uri: vscode.Uri): vscode.Uri | undefined {
  const name = `${(uri.path.split('/').pop() ?? 'document').replace(/\.(md|markdown)$/i, '')}.html`;
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
          preview.renderForExport(html),
          readDist(extensionUri, 'webview.css'),
          readDist(extensionUri, 'export.css'),
          readDist(extensionUri, 'export.js'),
        ]);
        const page = `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(documentTitle(md, source, uri))}</title>
<style>
${(style + '\n' + exportStyle).replace(/<\/style/gi, '<\\/style')}
</style>
</head>
<body class="vscode-light seqnotes-export${settings.limitContentWidth ? ' seqnotes-limit-width' : ''}" data-seqnotes-split-min-width="${Number.isFinite(Number(settings.splitMinWidth)) ? Number(settings.splitMinWidth) : 1000}">
<div id="seqnotes-root">${body}</div>
<script>
${script.replace(/<\/script/gi, '<\\/script')}
</script>
</body>
</html>
`;
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
