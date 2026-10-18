/**
 * The parts of an HTML export that do not depend on VS Code, shared by the export command (exportHtml.ts)
 * and the command line (cli.ts).
 */
import type { MarkdownIt, Token } from 'markdown-it';
import { renderDiff, type DiffRender, type DiffStats } from './diffRender';
import type { Translate } from './l10n';
import { headingText } from './linker';
import { frontMatterValue, parseFrontMatter, type FrontMatterEntry } from './markdownExtras';
import { WEBVIEW_TITLES } from './protocol';
import { escapeHtml, renderDocument, type RenderEnv } from './render';

export const IMAGE_TYPES: Record<string, string> = {
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

/** MIME type of an image embedded as a data URI, from the extension of its path; undefined for other files. */
export function imageType(path: string): string | undefined {
  return IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
}

/** A URL with a scheme (`https:`, `data:`, `vscode:`...). */
export const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** decodeURIComponent that leaves malformed escapes (e.g. `100%.md`) as they are. */
export function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** true for a URL that is not a path relative to the document (`https:`, `data:`, `//host`, `#id`). */
export const isExternalUrl = (src: string): boolean => SCHEME_RE.test(src) || src.startsWith('//') || src.startsWith('#');

/** The path of a local image `src`, without its query and fragment and with its escapes decoded. */
export function imagePath(src: string): string {
  const [path] = src.split(/[?#]/, 1);
  return safeDecode(path);
}

/** The entries of the YAML front matter at the top of the parsed document. */
export function frontMatterEntries(tokens: Token[]): FrontMatterEntry[] {
  return tokens[0]?.type === 'front_matter' ? parseFrontMatter(tokens[0].content) : [];
}

/** `documentTitle` of the parsed document. */
export function titleOf(tokens: Token[], fallback: string): string {
  const title = frontMatterValue(frontMatterEntries(tokens), 'title')?.trim();
  if (title) {
    return title;
  }
  const h1 = tokens.findIndex((t) => t.type === 'heading_open' && t.tag === 'h1');
  return (h1 >= 0 && headingText(tokens[h1 + 1]).trim()) || fallback;
}

/** Title of the exported page: the `title` of the front matter, the first h1, or `fallback` (the file name). */
export function documentTitle(md: MarkdownIt, source: string, fallback: string): string {
  return titleOf(md.parse(source, {}), fallback);
}

/** The file name of the exported file: `.html` instead of `.md`. */
export function exportFileName(name: string): string {
  return `${name.replace(/\.(md|markdown)$/i, '')}.html`;
}

/** Stands for a local image in the rendered HTML until it is resolved. */
const RESOURCE_PLACEHOLDER = 'seqnotes-export-resource:';
const PLACEHOLDER_RE = new RegExp(`${RESOURCE_PLACEHOLDER}(\\d+)`, 'g');

/** The local images of the HTML rendered with `resolveResource`, resolved by `resolveImage` (see `renderForExport`). */
async function withImages<T>(
  render: (resolveResource: (src: string) => string) => T,
  resolveImage: (src: string) => Promise<string>,
): Promise<{ result: T; resolve: (html: string) => string }> {
  const images: string[] = [];
  // Synchronous, so the images are only collected here and resolved below.
  const result = render((src) => {
    if (isExternalUrl(src)) {
      return src;
    }
    images.push(src);
    return `${RESOURCE_PLACEHOLDER}${images.length - 1}`;
  });
  const resolved = await Promise.all(
    images.map(async (src) => {
      const url = await resolveImage(src);
      const suffix = /[?#].*$/s.exec(src)?.[0] ?? '';
      return url.startsWith('data:') ? url : url + suffix;
    }),
  );
  return { result, resolve: (html) => html.replace(PLACEHOLDER_RE, (_, i: string) => escapeHtml(resolved[Number(i)])) };
}

/**
 * Renders the document for an exported file (`forExport`). The local images (not `isExternalUrl`) are given to
 * `resolveImage`, which returns their data URI or a link to them. A link keeps the query and fragment of `src`
 * (such as `icons.svg#save`).
 */
export async function renderForExport(
  md: MarkdownIt,
  source: string,
  env: Omit<RenderEnv, 'forExport' | 'resolveResource'>,
  resolveImage: (src: string) => Promise<string>,
): Promise<string> {
  const { result, resolve } = await withImages((resolveResource) => renderDocument(md, source, { ...env, forExport: true, resolveResource }), resolveImage);
  return resolve(result);
}

/**
 * Renders the document with its differences from a revision (`renderDiff`) for an exported file, like
 * `renderForExport`: the images of the revision's blocks are resolved from the document's folder too.
 */
export async function renderDiffForExport(
  md: MarkdownIt,
  beforeSource: string,
  afterSource: string,
  env: Omit<RenderEnv, 'forExport' | 'resolveResource'>,
  resolveImage: (src: string) => Promise<string>,
): Promise<DiffRender> {
  const { result, resolve } = await withImages(
    (resolveResource) => renderDiff(md, beforeSource, afterSource, { ...env, forExport: true, resolveResource }),
    resolveImage,
  );
  return { html: resolve(result.html), old: result.old.map(resolve), stats: result.stats };
}

/** Removes the source map comment of a development build, as source maps are not exported. */
export function stripSourceMap(text: string): string {
  return text.replace(/\n?(?:\/\/# sourceMappingURL=.*|\/\*# sourceMappingURL=.*\*\/)\s*$/, '');
}

/** The settings that apply to an exported page. */
export interface ExportSettings {
  limitContentWidth: boolean;
  stickyTableHeader: boolean;
  tableTreeHighlight: boolean;
  splitMinWidth: number;
}

export interface ExportPage {
  /** `lang` of the page. */
  lang: string;
  title: string;
  /** The body rendered by the webview (`exportBody` in webview/main.ts). */
  body: string;
  /** dist/webview.css and dist/export.css. */
  styles: string[];
  /** dist/export.js. */
  script: string;
  settings: ExportSettings;
  /** The differences from a revision rendered in the body (`renderDiffForExport`), shown with a bar (webview/export.ts). */
  diff?: ExportDiff;
}

/** The differences of an exported page: what it is compared with, the number of blocks changed, and the bar's texts. */
export interface ExportDiff {
  label: string;
  stats: DiffStats;
  /** The texts of the bar (`diffTitles`). */
  titles: Record<string, string>;
}

/** The texts of the bar of the differences (`diff-*` of `WEBVIEW_TITLES`) translated, by their attribute name. */
export function diffTitles(t: Translate): Record<string, string> {
  return Object.fromEntries(
    Object.entries(WEBVIEW_TITLES)
      .filter(([name]) => name.startsWith('diff-'))
      .map(([name, title]) => [`data-seqnotes-${name}`, t(title)]),
  );
}

/** The exported HTML file: a single page with its styles and script inlined. */
export function exportPage({ lang, title, body, styles, script, settings, diff }: ExportPage): string {
  const classes = [
    'seqnotes-export',
    ...(settings.limitContentWidth ? ['seqnotes-limit-width'] : []),
    ...(settings.stickyTableHeader ? ['seqnotes-sticky-table-header'] : []),
    ...(settings.tableTreeHighlight ? ['seqnotes-table-tree-highlight'] : []),
  ];
  const splitMinWidth = Number.isFinite(Number(settings.splitMinWidth)) ? Number(settings.splitMinWidth) : 1000;
  const diffAttrs = diff
    ? Object.entries({
        'data-seqnotes-diff-label': diff.label,
        'data-seqnotes-diff-stats': `${diff.stats.added},${diff.stats.changed},${diff.stats.deleted}`,
        ...diff.titles,
      })
        .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
        .join('')
    : '';
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${styles.join('\n').replace(/<\/style/gi, '<\\/style')}
</style>
</head>
<body data-seqnotes-theme="light" class="${classes.join(' ')}" data-seqnotes-split-min-width="${splitMinWidth}"${diffAttrs}>
<div id="seqnotes-root">${body}</div>
<script>
${script.replace(/<\/script/gi, '<\\/script')}
</script>
</body>
</html>
`;
}
