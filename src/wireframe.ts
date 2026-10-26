/**
 * Wireframes: screen mock-ups written as HTML files and put into a document like images, with an image, a link alone in
 * its paragraph, or an image in a link (`![Login](screens/login.html)`, `[Login](screens/login.html)`,
 * `[![Login](screens/login.png)](screens/login.html)`, the image being shown elsewhere, e.g. on GitHub).
 * Their parts are numbered with `data-item="<number>"`, and an HTML comment right before them gives their options
 * (`<!-- wireframe: link-headings width=375 -->`): `link-headings` lays them out with the headings and the item table rows
 * after them, linked by the numbers (src/linker.ts).
 *
 * The host reads the files (`loadWireframes`) and gives them to the render (`RenderEnv.wireframes`).
 * No dependency on vscode or Node: `partNumber` is used by the webview too.
 */
import type { MarkdownIt, StateCore, Token } from 'markdown-it';
import { ATTR_RE, decodeAttribute, RAW_TEXT } from './htmlTags';
import { formatMessage, type Translate } from './l10n';
import type { LinkWarning } from './linker';
import { toAsciiDigits } from './sequence';
import { parseTableOptions } from './tables';

/** Type of the token that takes the place of the paragraph of a wireframe. */
export const WIREFRAME_TOKEN = 'wireframe';

/** An HTML file of a wireframe, read by the host, with its local style sheets by their `href`. */
export interface WireframeFile {
  html: string;
  stylesheets: Record<string, string>;
}

/** The wireframes of a document by their `src` as written, null for one that could not be read (and none for one not read). */
export type WireframeFiles = Record<string, WireframeFile | null>;

export interface WireframeOptions {
  /** Laid out with the headings and item table rows after it, linked to its parts. */
  linkHeadings: boolean;
  /** Width in px the HTML is laid out at (scaled down to the column), instead of that of the column. */
  width?: number;
  /** The headings are put below it instead of beside it. */
  stacked: boolean;
  /** 0-based line of the options comment. */
  line?: number;
}

/** A wireframe of a document, in the `meta` of its token. */
export interface Wireframe {
  src: string;
  /** The text of the image or link, which stands for it. */
  alt: string;
  options: WireframeOptions;
  /** Its file; null when it could not be read, undefined when the host did not read it. */
  file?: WireframeFile | null;
  /** The parts of its file. */
  parts?: WireframePart[];
}

/** A part of a wireframe: an element with `data-item`. */
export interface WireframePart {
  /** The value of `data-item`. */
  item: string;
  /** The value of `data-ref`: the heading the part is linked to instead of the one numbered like it. */
  ref?: string;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const isExternal = (src: string): boolean => SCHEME_RE.test(src) || src.startsWith('//') || src.startsWith('#');

/** The path of a local `src`, without its query and fragment and with its escapes decoded. */
export function sourcePath(src: string): string {
  const [path] = src.split(/[?#]/, 1);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** true for the `src` of a local HTML file. */
export const isWireframeSrc = (src: string): boolean => !isExternal(src) && /\.html?$/i.test(sourcePath(src));

/** The number of a part (`data-item`), with full-width digits; undefined when it is not one. */
export function partNumber(item: string): number | undefined {
  const text = toAsciiDigits(item.trim());
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

/**
 * The path of `path`, relative to the file `from` (both relative to the document, or to the root of the workspace
 * with a leading `/`), relative to the document.
 */
export function rebasePath(path: string, from: string): string {
  if (path.startsWith('/')) {
    return normalizePath(path);
  }
  return normalizePath(from.slice(0, from.lastIndexOf('/') + 1) + path);
}

function normalizePath(path: string): string {
  const root = path.startsWith('/') ? '/' : '';
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..' && segments.length > 0 && segments[segments.length - 1] !== '..') {
      segments.pop();
    } else if (segment !== '..' || root === '') {
      segments.push(segment);
    }
  }
  return root + segments.join('/');
}

// ---------------------------------------------------------------------------
// The HTML of a wireframe

/** An HTML comment, an element whose content is text (with its attributes and content), or a tag (with its name and attributes). */
const SCAN_RE = new RegExp(
  `<!--[\\s\\S]*?(?:-->|$)|<(${RAW_TEXT})(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>([\\s\\S]*?)(?:</\\1\\s*>|$)|<([a-zA-Z][\\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>`,
  'gi',
);

/** The attributes of a tag by their lower-case names, the first one of a name only (as in the browser). */
function attributesOf(md: MarkdownIt, attrs: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name, double, single, bare] of attrs.matchAll(ATTR_RE)) {
    const key = name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, decodeAttribute(md, double ?? single ?? bare ?? ''));
    }
  }
  return map;
}

/** Replaces the value of the attribute `name` of a tag with `replace(value)`, or leaves it when it returns undefined. */
function replaceAttribute(md: MarkdownIt, attrs: string, name: string, replace: (value: string) => string | undefined): string {
  let seen = false;
  return attrs.replace(ATTR_RE, (attr, attrName: string, double?: string, single?: string, bare?: string) => {
    if (seen || attrName.toLowerCase() !== name) {
      return attr;
    }
    seen = true;
    const value = replace(decodeAttribute(md, double ?? single ?? bare ?? ''));
    return value === undefined ? attr : `${attrName}="${md.utils.escapeHtml(value)}"`;
  });
}

const isStylesheet = (attributes: Map<string, string>): boolean => (attributes.get('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet');

/** The tags of the HTML of a wireframe that are part of its page: not in comments, nor elements whose content is text. */
function* tagsOf(md: MarkdownIt, html: string): Generator<{ name: string; attributes: Map<string, string> }> {
  for (const m of html.matchAll(SCAN_RE)) {
    if (m[4] !== undefined) {
      yield { name: m[4].toLowerCase(), attributes: attributesOf(md, m[5]) };
    }
  }
}

/** The parts of the HTML of a wireframe, in document order. */
export function wireframeParts(md: MarkdownIt, html: string): WireframePart[] {
  const parts: WireframePart[] = [];
  for (const { attributes } of tagsOf(md, html)) {
    const item = attributes.get('data-item');
    if (item !== undefined) {
      parts.push({ item, ...(attributes.has('data-ref') ? { ref: attributes.get('data-ref') } : {}) });
    }
  }
  return parts;
}

/** The `href`s of the local style sheets of the HTML of a wireframe (`<link rel="stylesheet">`). */
export function stylesheetHrefs(md: MarkdownIt, html: string): string[] {
  const hrefs: string[] = [];
  for (const { name, attributes } of tagsOf(md, html)) {
    const href = attributes.get('href');
    if (name === 'link' && href && isStylesheet(attributes) && !isExternal(href) && !hrefs.includes(href)) {
      hrefs.push(href);
    }
  }
  return hrefs;
}

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

/** The elements whose `src` is an image. */
const IMAGE_ELEMENTS = new Set(['img', 'input']);

/**
 * The HTML of a wireframe (in `src`, relative to the document) as it is shown: its local style sheets put in `<style>`
 * elements in their place, and its local images (the `src` of `<img>` and `<input type="image">`, `url()` in its styles
 * and `style` attributes) given to `resolve` with their path relative to the document, encoded as in Markdown.
 */
export function composeWireframe(md: MarkdownIt, file: WireframeFile, src: string, resolve: (src: string) => string): string {
  const base = sourcePath(src);
  const resolveFrom = (from: string) => (url: string): string | undefined => {
    if (url === '' || isExternal(url)) {
      return undefined;
    }
    const suffix = /[?#].*$/s.exec(url)?.[0] ?? '';
    return resolve(encodeURI(rebasePath(sourcePath(url), from)) + suffix);
  };
  const css = (text: string, from: string): string =>
    text.replace(CSS_URL_RE, (call, _quote: string, url: string) => {
      const resolved = resolveFrom(from)(url);
      return resolved === undefined ? call : `url("${resolved.replace(/["\\]/g, '\\$&')}")`;
    });
  return file.html.replace(SCAN_RE, (tag, rawName?: string, rawAttrs?: string, content?: string, name?: string, attrs?: string) => {
    if (rawName?.toLowerCase() === 'style') {
      return `<style${rawAttrs}>${css(content ?? '', base)}</style>`;
    }
    if (name === undefined || attrs === undefined) {
      return tag;
    }
    const element = name.toLowerCase();
    if (element === 'link') {
      const attributes = attributesOf(md, attrs);
      const href = attributes.get('href');
      const sheet = href === undefined ? undefined : file.stylesheets[href];
      if (sheet !== undefined && isStylesheet(attributes)) {
        // `</style` would end the element early.
        return `<style>${css(sheet, rebasePath(sourcePath(href!), base)).replace(/<\/style/gi, '<\\/style')}</style>`;
      }
    }
    let rewritten = replaceAttribute(md, attrs, 'style', (style) => (/url\(/i.test(style) ? css(style, base) : undefined));
    if (IMAGE_ELEMENTS.has(element)) {
      rewritten = replaceAttribute(md, rewritten, 'src', resolveFrom(base));
    }
    return rewritten === attrs ? tag : `<${name}${rewritten}>`;
  });
}

/**
 * Reads the wireframes `srcs` of a document and their style sheets with `read`, which is given their paths
 * (relative to the document, or to the root of the workspace with a leading `/`) and returns their text,
 * or undefined when it cannot be read.
 */
export async function loadWireframes(md: MarkdownIt, srcs: string[], read: (path: string) => Promise<string | undefined>): Promise<WireframeFiles> {
  const files: WireframeFiles = {};
  await Promise.all(
    srcs.map(async (src) => {
      const path = sourcePath(src);
      const html = await read(path);
      if (html === undefined) {
        files[src] = null;
        return;
      }
      const stylesheets: Record<string, string> = {};
      await Promise.all(
        stylesheetHrefs(md, html).map(async (href) => {
          const sheet = rebasePath(sourcePath(href), path);
          const css = /\.css$/i.test(sheet) ? await read(sheet) : undefined;
          if (css !== undefined) {
            stylesheets[href] = css;
          }
        }),
      );
      files[src] = { html, stylesheets };
    }),
  );
  return files;
}

/** The paths of the files `loadWireframes` reads for a wireframe, so that the host can follow their changes. */
export function wireframeDependencies(md: MarkdownIt, src: string, file: WireframeFile | null | undefined): string[] {
  const path = sourcePath(src);
  return [path, ...(file ? stylesheetHrefs(md, file.html).map((href) => rebasePath(sourcePath(href), path)) : [])];
}

// ---------------------------------------------------------------------------
// The wireframes of a document

/**
 * The `src` of a paragraph that is a wireframe: an image of an HTML file, or at the top level, a link to one or an image
 * in such a link (in a list, such links are rather a list of pages).
 */
function wireframeSrc(paragraph: Token, inline: Token | undefined): string | undefined {
  const children = (inline?.children ?? []).filter((c) => c.type !== 'softbreak' && !(c.type === 'text' && c.content.trim() === ''));
  const [first] = children;
  if (children.length === 1 && first.type === 'image') {
    const src = String(first.attrGet('src') ?? '');
    return isWireframeSrc(src) ? src : undefined;
  }
  const last = children[children.length - 1];
  if (
    paragraph.level === 0 &&
    children.length >= 2 &&
    first.type === 'link_open' &&
    last.type === 'link_close' &&
    children.filter((c) => c.type === 'link_open').length === 1
  ) {
    const href = String(first.attrGet('href') ?? '');
    return isWireframeSrc(href) ? href : undefined;
  }
  return undefined;
}

/** The text of the image or link of a wireframe. */
function altOf(inline: Token): string {
  return (inline.children ?? [])
    .map((child) => (child.type === 'image' ? child.content : child.type === 'text' || child.type === 'code_inline' ? child.content : ''))
    .join('')
    .trim();
}

const DIRECTIVE_RE = /^<!--\s*wireframe:([^]*?)-->\s*$/;
const WARNINGS = 'seqNotesWireframeWarnings';

/** Reads the options of a wireframe, and adds the problems to `warnings`. */
function readOptions(text: string, line: number, t: Translate, warnings: LinkWarning[]): WireframeOptions {
  const options: WireframeOptions = { linkHeadings: false, stacked: false, line };
  for (const option of parseTableOptions(text)) {
    if (option.key === 'link-headings' && option.values.length === 0) {
      options.linkHeadings = true;
    } else if (option.key === 'stacked' && option.values.length === 0) {
      options.stacked = true;
    } else if (option.key === 'width') {
      const width = option.values.length === 1 ? partNumber(option.values[0].replace(/px$/i, '')) : undefined;
      if (width) {
        options.width = width;
      } else {
        warnings.push({ line, message: t('Write the width of the wireframe in pixels: "width=<number>".') });
      }
    } else {
      warnings.push({ line, message: t('Unknown wireframe option "{0}". Write "link-headings", "width=<pixels>" or "stacked".', option.key) });
    }
  }
  return options;
}

/**
 * Puts a token of a wireframe (`WIREFRAME_TOKEN`, with the `Wireframe` in its `meta`) in the place of each paragraph of one,
 * with the options of the comment before it and its file from `RenderEnv.wireframes` (after the inline rule,
 * which parses the paragraphs).
 */
export function wireframes(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'seqnotes_wireframes', (state: StateCore) => {
    const env = state.env as { t?: Translate; wireframes?: WireframeFiles } | undefined;
    const t = env?.t ?? formatMessage;
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const src = tokens[i].type === 'paragraph_open' && tokens[i + 2]?.type === 'paragraph_close' ? wireframeSrc(tokens[i], tokens[i + 1]) : undefined;
      if (src === undefined) {
        continue;
      }
      const paragraph = tokens[i];
      const token = new state.Token(WIREFRAME_TOKEN, 'div', 0);
      token.block = true;
      token.level = paragraph.level;
      token.map = paragraph.map;
      const file = env?.wireframes?.[src];
      const wireframe: Wireframe = {
        src,
        alt: altOf(tokens[i + 1]),
        options: { linkHeadings: false, stacked: false },
        file,
        ...(file ? { parts: wireframeParts(state.md, file.html) } : {}),
      };
      token.meta = { wireframe };
      tokens.splice(i, 3, token);
    }
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const m = token.type === 'html_block' ? DIRECTIVE_RE.exec(token.content.trim()) : null;
      if (!m) {
        continue;
      }
      const line = token.map?.[0] ?? 0;
      const warnings: LinkWarning[] = [];
      const next = tokens[i + 1];
      if (next?.type === WIREFRAME_TOKEN) {
        (next.meta as { wireframe: Wireframe }).wireframe.options = readOptions(m[1], line, t, warnings);
      } else {
        warnings.push({ line, message: t('The wireframe options are not followed by a wireframe.') });
      }
      if (warnings.length > 0) {
        token.meta = { ...token.meta, [WARNINGS]: warnings };
      }
    }
  });
}

/** The wireframe of a token, if it is one. */
export function wireframeOf(token: Token): Wireframe | undefined {
  return token.type === WIREFRAME_TOKEN ? (token.meta as { wireframe: Wireframe }).wireframe : undefined;
}

/** The `src` of the wireframes of a parsed document, which the host reads (`loadWireframes`). */
export function wireframeSources(tokens: Token[]): string[] {
  return [...new Set(tokens.map(wireframeOf).filter((w) => w !== undefined).map((w) => w.src))];
}

/** The warnings of the wireframe options in a document's tokens. */
export function wireframeWarnings(tokens: Token[]): LinkWarning[] {
  return tokens.flatMap((token) => ((token.meta as Record<string, LinkWarning[]> | null)?.[WARNINGS] ?? []));
}
