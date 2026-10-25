import markdownit, { type Env, type MarkdownIt, type Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { formatMessage, type Translate } from './l10n';
import { diagramWording } from './diagramWording';
import { isMermaidFence, linkDiagrams, type DiagramInfo, type DiagramKind } from './linker';
import { markdownExtras } from './markdownExtras';
import { HEADING_ID_PREFIX, slugify } from './slug';
import { tableOptions, tableWarnings } from './tables';

export { HEADING_ID_PREFIX, slugify };

export type RenderEnv = Env & {
  /** Rewrites relative resource URLs (images) to something the webview can load. */
  resolveResource?: (src: string) => string;
  /** Translates the texts the preview adds (warnings, marks). English by default. */
  t?: Translate;
  /** false hides the YAML front matter instead of showing it as a table. */
  frontMatter?: boolean;
  /** false leaves out the `autonumber` numbers, so that no number is shown on the linked headings. */
  headingNumbers?: boolean;
  /**
   * Renders for an exported file: without what only helps the author (warnings, marks of missing links)
   * or the editor sync (source lines).
   */
  forExport?: boolean;
};

/** Diagram data embedded into the HTML for the webview script. */
export interface DiagramMeta {
  id: number;
  kind: DiagramKind;
  paired: boolean;
  /** The arrows of a sequence diagram, or the nodes of the other diagrams (with `nodeId`). */
  messages: { index: number; line: number; text: string; nodeId?: string; number?: number; numberInHeading?: boolean; target?: string; unlinked?: boolean }[];
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Footnotes collected by markdown-it-footnote: an inline one (`^[note]`) has its text, a reference (`[^1]`) its label. */
type FootnoteEnv = { footnotes?: { list?: { label?: string; content?: string }[] } };

/** The source text of a heading without its footnotes (`[^1]`, `^[note]`), which are not part of its text. */
function withoutFootnoteRefs(inline: Token | undefined, env: FootnoteEnv): string {
  let text = inline?.content ?? '';
  for (const child of inline?.children ?? []) {
    if (child.type !== 'footnote_ref') {
      continue;
    }
    const id = (child.meta as { id?: number } | null)?.id;
    const footnote = id === undefined ? undefined : env.footnotes?.list?.[id];
    const source = footnote?.label !== undefined ? `[^${footnote.label}]` : footnote?.content !== undefined ? `^[${footnote.content}]` : undefined;
    if (source) {
      text = text.split(source).join('');
    }
  }
  return text;
}

function headingIds(md: MarkdownIt): void {
  md.core.ruler.push('seqnotes_heading_ids', (state) => {
    const used = new Set<string>();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open') {
        continue;
      }
      const base = HEADING_ID_PREFIX + slugify(withoutFootnoteRefs(tokens[i + 1], state.env as FootnoteEnv));
      let id = base;
      for (let n = 1; used.has(id); n++) {
        id = `${base}-${n}`;
      }
      used.add(id);
      tokens[i].attrSet('id', id);
    }
  });
}

function sourceLines(md: MarkdownIt): void {
  md.core.ruler.push('seqnotes_source_lines', (state) => {
    if ((state.env as RenderEnv | undefined)?.forExport) {
      return;
    }
    let inFootnotes = false;
    for (const token of state.tokens) {
      // The footnotes are gathered at the end, but keep the lines of their definitions,
      // which would break the document order of data-line that the scroll sync expects.
      if (token.type === 'footnote_block_open' || token.type === 'footnote_block_close') {
        inFootnotes = token.nesting === 1;
      } else if (token.map && token.nesting !== -1 && !inFootnotes) {
        token.attrSet('data-line', String(token.map[0]));
      }
    }
  });
}

function mermaidFence(md: MarkdownIt): void {
  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env: RenderEnv | undefined, self) => {
    const token = tokens[idx];
    if (!isMermaidFence(token)) {
      return defaultFence(tokens, idx, options, env, self);
    }
    const diagram = token.meta?.seqNotes as DiagramInfo | undefined;
    const forExport = env?.forExport === true;
    const headingNumbers = env?.headingNumbers !== false;
    // Set by `sourceLines`, which leaves it out where the document order would break.
    const line = token.attrGet('data-line');
    let attrs = line === null ? '' : ` data-line="${line}"`;
    // Set by `renderDiff`: the other blocks have it rendered with their attributes.
    for (const name of ['data-seqnotes-diff', 'data-seqnotes-diff-old']) {
      const value = token.attrGet(name);
      if (value !== null) {
        attrs += ` ${name}="${escapeHtml(String(value))}"`;
      }
    }
    if (diagram) {
      const meta: DiagramMeta = {
        id: diagram.id,
        kind: diagram.kind,
        paired: diagram.paired,
        messages: diagram.messages.map(({ index, line, text, nodeId, number, numberInHeading, target, unlinked }) => ({
          index,
          line,
          text,
          nodeId,
          number: headingNumbers ? number : undefined,
          numberInHeading,
          target,
          unlinked: forExport ? undefined : unlinked,
        })),
      };
      attrs += ` data-seqnotes-meta="${escapeHtml(JSON.stringify(meta))}"`;
    }
    return `<div class="seqnotes-mermaid"${attrs}><pre class="seqnotes-mermaid-src">${escapeHtml(token.content)}</pre></div>\n`;
  };
}

/** Set in the `meta` of an HTML token that holds HTML already rendered, whose images are resolved. */
export const RENDERED_HTML = 'seqnotesRendered';

/** The elements whose content is text, not HTML. */
const RAW_TEXT = 'script|style|textarea|title';
/**
 * An HTML comment or an element whose content is text (to the end of the HTML when it is not closed), left as they
 * are, or an `<img>` tag with its attributes.
 */
const IMG_TAG_RE = new RegExp(`<!--[\\s\\S]*?-->|<(${RAW_TEXT})(?=[\\s/>])[\\s\\S]*?(?:</\\1\\s*>|$)|<img(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'gi');
/** An opening or closing tag of an element whose content is text. */
const RAW_TEXT_TAG_RE = new RegExp(`<(/?)(${RAW_TEXT})(?=[\\s/>])`, 'gi');
/** An attribute of a tag: its name, and its value in double quotes, in single quotes or without quotes. */
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * The text of an HTML attribute value: its character references decoded. `unescapeAll` also takes out the backslash
 * escapes of Markdown, which are kept by doubling the backslashes.
 */
const decodeAttribute = (md: MarkdownIt, value: string): string => md.utils.unescapeAll(value.replace(/\\/g, '\\\\'));

/** Rewrites the `src` of the `<img>` tags of raw HTML with `resolve`, like the images of Markdown. */
function resolveHtmlImages(md: MarkdownIt, html: string, resolve: (src: string) => string): string {
  return html.replace(IMG_TAG_RE, (tag, _rawText?: string, attrs?: string) => {
    if (attrs === undefined) {
      return tag;
    }
    // Only the first `src` counts, as in the browser.
    let seen = false;
    const resolved = attrs.replace(ATTR_RE, (attr, name: string, double?: string, single?: string, bare?: string) => {
      if (seen || name.toLowerCase() !== 'src') {
        return attr;
      }
      seen = true;
      const src = decodeAttribute(md, double ?? single ?? bare ?? '');
      return src ? `${name}="${escapeHtml(resolve(src))}"` : attr;
    });
    return `${tag.slice(0, 4)}${resolved}>`;
  });
}

/** true when the inline HTML before `idx` leaves an element whose content is text (`<textarea>`) open. */
function inRawText(tokens: Token[], idx: number): boolean {
  let open: string | undefined;
  for (const token of tokens.slice(0, idx)) {
    if (token.type !== 'html_inline') {
      continue;
    }
    for (const [, closing, name] of token.content.matchAll(RAW_TEXT_TAG_RE)) {
      const tag = name.toLowerCase();
      if (open === undefined && !closing) {
        open = tag;
      } else if (closing && tag === open) {
        open = undefined;
      }
    }
  }
  return open !== undefined;
}

function resourceLinks(md: MarkdownIt): void {
  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, options, env: RenderEnv | undefined, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src');
    if (src && env?.resolveResource) {
      token.attrSet('src', env.resolveResource(String(src)));
    }
    return defaultImage(tokens, idx, options, env, self);
  };
  for (const type of ['html_block', 'html_inline'] as const) {
    const defaultHtml = md.renderer.rules[type]!;
    md.renderer.rules[type] = (tokens, idx, options, env: RenderEnv | undefined, self) => {
      const html = defaultHtml(tokens, idx, options, env, self);
      const resolve = env?.resolveResource;
      const rendered = (tokens[idx].meta as Record<string, unknown> | null)?.[RENDERED_HTML] === true;
      if (!resolve || rendered || (type === 'html_inline' && inRawText(tokens, idx))) {
        return html;
      }
      return resolveHtmlImages(md, html, resolve);
    };
  }
}

export function createMarkdown(): MarkdownIt {
  const md = markdownit({ html: true, linkify: true });
  md.use(footnote).use(markdownExtras).use(tableOptions).use(headingIds).use(sourceLines).use(mermaidFence).use(resourceLinks);
  return md;
}

export function renderDocument(md: MarkdownIt, source: string, env: RenderEnv = {}): string {
  return renderTokens(md, md.parse(source, env), env);
}

/** Renders the tokens of a document parsed with `env` (`renderDocument`, or `renderDiff` with the blocks of the revision added). */
export function renderTokens(md: MarkdownIt, tokens: Token[], env: RenderEnv): string {
  const t = env.t ?? formatMessage;
  const { diagrams, warnings: linkWarnings } = linkDiagrams(tokens, t);
  const warnings = [...linkWarnings, ...tableWarnings(tokens)].sort((a, b) => a.line - b.line);
  for (const diagram of diagrams) {
    const fence = tokens[diagram.fenceIndex];
    fence.meta = { ...fence.meta, seqNotes: diagram };
    const wording = diagramWording(diagram.kind, t);
    for (const index of env.forExport ? [] : diagram.unlinkedHeadings) {
      tokens[index].attrJoin('class', 'seqnotes-unlinked');
      tokens[index].attrSet('title', wording.unlinkedHeadingTitle);
      // Shown by the CSS (`content: attr(...)`).
      tokens[index].attrSet('data-seqnotes-mark', wording.unlinkedHeadingMark);
    }
  }

  const render = (slice: Token[]): string => md.renderer.render(slice, md.options, env);

  let html = '';
  if (warnings.length > 0 && !env.forExport) {
    // Lets the webview keep the panel hidden while the warnings stay the same, even if their lines move.
    const key = warnings.map((w) => w.message).join('\n');
    html += `<div class="seqnotes-warnings" data-seqnotes-key="${escapeHtml(key)}">`;
    for (const w of warnings) {
      // Not data-line: the warnings sit above the content, and the scroll sync expects data-line in document order.
      html += `<p data-seqnotes-jump="${w.line}">${escapeHtml(t('⚠ Line {0}: {1}', w.line + 1, w.message))}</p>`;
    }
    html += '</div>\n';
  }

  let pos = 0;
  for (const diagram of diagrams) {
    if (!diagram.paired) {
      continue;
    }
    html += render(tokens.slice(pos, diagram.fenceIndex));
    // A horizontal diagram is too wide to be put beside its overview.
    html += `<div class="seqnotes-pair${diagram.stacked ? ' seqnotes-pair-stacked' : ''}" data-diagram="${diagram.id}">`;
    html += `<div class="seqnotes-seq-col">${render(tokens.slice(diagram.fenceIndex, diagram.fenceIndex + 1))}</div>`;
    html += `<div class="seqnotes-overview-col">${render(tokens.slice(diagram.fenceIndex + 1, diagram.rangeEnd))}</div>`;
    html += '</div>\n';
    pos = diagram.rangeEnd;
  }
  html += render(tokens.slice(pos));
  return html;
}
