/**
 * The texts of a screen captured as a wireframe (capture.ts). `viewportUnitsToPx` and `splitTopLevel` also run in the
 * captured page (capturePage.ts), given as their source: they refer to nothing outside them.
 */

/**
 * `text` (CSS declarations) with its lengths relative to the window (`100vh`, `50vw`, `10dvmin`...) in pixels of a
 * window of `width` × `height`: in the preview, the window of a wireframe is that of the document.
 */
export function viewportUnitsToPx(text: string, width: number, height: number): string {
  // Not in a name (`--h-100vh`, `.h-\[100vh\]`), nor a URL (`/100vh.png`, `?h=100vh`).
  return text.replace(/(?<![\w\\.\-/?=&#])(-?(?:\d*\.)?\d+(?:e[+-]?\d+)?)([dsl]?v(?:w|h|i|b|min|max))(?![\w-])/gi, (match, value: string, unit: string) => {
    const kind = unit.toLowerCase().replace(/^[dsl]/, '');
    const size = kind === 'vw' || kind === 'vi' ? width : kind === 'vh' || kind === 'vb' ? height : kind === 'vmin' ? Math.min(width, height) : Math.max(width, height);
    return `${Math.round(((Number(value) * size) / 100) * 1000) / 1000}px`;
  });
}

/** The items of a comma separated list (e.g. the sources of a `@font-face`), trimmed: not split in parentheses nor strings. */
export function splitTopLevel(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') {
        i++;
      } else if (c === quote) {
        quote = '';
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (c === ',' && depth === 0) {
      items.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  items.push(text.slice(start).trim());
  return items.filter((item) => item !== '');
}

/** The placeholder of the n-th file of the page (an image or a font), in the texts of the captured page. */
export const assetPlaceholder = (n: number): string => `seqnotes-asset:${n}`;
const PLACEHOLDER_RE = /seqnotes-asset:(\d+)/g;

/** `text` with the placeholders of the files (`assetPlaceholder`) replaced by `urls` (their data URIs, or URLs). */
export function replaceAssets(text: string, urls: string[]): string {
  return text.replace(PLACEHOLDER_RE, (match, n: string) => urls[Number(n)] ?? match);
}

const ASSET_TYPES: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

/** The MIME type of a file of the page: that of the response, or by the extension of its URL when the response has none. */
export function assetType(url: string, contentType: string | undefined): string {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  if (type && type !== 'application/octet-stream') {
    return type;
  }
  const extension = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)?.[1].toLowerCase() ?? '';
  return ASSET_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * The CSS of the captured page as the text of a <style>: `<` before a letter or `/` escaped (in strings, as in SVG data
 * URIs), which would end it early or have it removed by the sanitizer of the preview (DOMPurify).
 */
export const styleText = (css: string): string => css.replace(/<(?=[\w/!?])/g, '\\3c ');
