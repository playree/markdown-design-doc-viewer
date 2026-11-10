/**
 * The texts of a screen captured as a wireframe (capture.ts). `viewportUnitsToPx`, `splitTopLevel`, `assetPlaceholder`
 * and `styleText` also run in the captured page (capturePage.ts), given as their source: they refer to nothing outside them.
 */
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** `css` without its comments, which are not in its strings. */
function withoutComments(css: string): string {
  let text = '';
  let quote = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === '\\') {
        text += c + (css[++i] ?? '');
        continue;
      }
      if (c === quote) {
        quote = '';
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
      continue;
    }
    text += c;
  }
  return text;
}

const STRING = `"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)'`;
const URL_RE = new RegExp(`url\\(\\s*(?:${STRING}|([^)\\s'"]*))\\s*\\)`, 'gi');
/** `@import` with its URL (a `url()` or a string) and its conditions. */
const IMPORT_RE = new RegExp(`@import\\s*(?:url\\(\\s*(?:${STRING}|([^)\\s'"]*))\\s*\\)|${STRING})((?:[^;"']|"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')*);`, 'gi');
const unescape = (text: string): string => text.replace(/\\(.)/g, '$1');

/** `css` with the URLs of its `url()` absolute, from `base`. */
function absoluteUrls(css: string, base: string): string {
  return css.replace(URL_RE, (match, double?: string, single?: string, bare?: string) => {
    const url = unescape(double ?? single ?? bare ?? '');
    if (url === '' || url.startsWith('#') || /^data:/i.test(url)) {
      return match;
    }
    try {
      return `url("${new URL(url, base).href.replace(/["\\]/g, '\\$&')}")`;
    } catch {
      return match;
    }
  });
}

/** The conditions of an `@import` after its URL: its layer (`''` for an anonymous one), `supports()` and media queries. */
export function importConditions(text: string): { layer?: string; supports?: string; media: string } {
  let rest = text.trim();
  let layer: string | undefined;
  let supports: string | undefined;
  const m = /^layer(?:\(([^)]*)\))?(?=\s|$)/i.exec(rest);
  if (m) {
    layer = m[1]?.trim() ?? '';
    rest = rest.slice(m[0].length).trim();
  }
  if (/^supports\(/i.test(rest)) {
    let depth = 0;
    let end = 'supports'.length;
    for (; end < rest.length; end++) {
      depth += rest[end] === '(' ? 1 : rest[end] === ')' ? -1 : 0;
      if (depth === 0) {
        break;
      }
    }
    supports = rest.slice('supports('.length, end).trim();
    rest = rest.slice(end + 1).trim();
  }
  return { ...(layer === undefined ? {} : { layer }), ...(supports === undefined ? {} : { supports }), media: rest };
}

/**
 * The text of the style sheet at `base` with its `@import`s replaced by the style sheets they import (from `fetchText`,
 * themselves with theirs), in rules of their conditions, and its URLs absolute: for a style sheet that the page cannot
 * read, whose text the page parses, without its `@import`s. The style sheets that cannot be fetched are added to `missing`.
 */
export async function inlineImports(
  css: string,
  base: string,
  fetchText: (url: string) => Promise<string | undefined>,
  missing: string[],
  seen: ReadonlySet<string> = new Set([base]),
): Promise<string> {
  const text = withoutComments(css).replace(/@charset\s*"[^"]*"\s*;/gi, '');
  const imports = Array.from(text.matchAll(IMPORT_RE), async (m) => {
    let url: string;
    try {
      url = new URL(unescape(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? ''), base).href;
    } catch {
      return '';
    }
    if (seen.has(url)) {
      return '';
    }
    const imported = await fetchText(url);
    if (imported === undefined) {
      missing.push(url);
      return '';
    }
    let rules = await inlineImports(imported, url, fetchText, missing, new Set([...seen, url]));
    const { layer, supports, media } = importConditions(m[6]);
    if (layer !== undefined) {
      rules = `@layer ${layer}${layer ? ' ' : ''}{\n${rules}\n}`;
    }
    if (supports !== undefined) {
      rules = `@supports (${supports}) {\n${rules}\n}`;
    }
    return media ? `@media ${media} {\n${rules}\n}` : rules;
  });
  const sheets = await Promise.all(imports);
  let n = 0;
  return absoluteUrls(
    text.replace(IMPORT_RE, () => sheets[n++]),
    base,
  );
}

/**
 * The page captured, as written in the file: without the credentials, query and fragment of its URL, which may have
 * secrets (e.g. the token of a password reset), and of a local file only its name.
 */
export function capturedFrom(url: string): string {
  const shown = new URL(url);
  if (shown.protocol === 'file:') {
    return basename(fileURLToPath(shown));
  }
  shown.username = '';
  shown.password = '';
  shown.search = '';
  shown.hash = '';
  return shown.href;
}
