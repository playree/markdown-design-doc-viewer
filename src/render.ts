import markdownit, { type Env, type MarkdownIt, type Token } from 'markdown-it';
import { formatMessage, type Translate } from './l10n';
import { isMermaidFence, linkDiagrams, type DiagramInfo, type DiagramKind } from './linker';
import { markdownExtras } from './markdownExtras';
import { HEADING_ID_PREFIX, slugify } from './slug';

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
  /** The arrows of a sequence diagram, or the nodes of a flowchart (with `nodeId`). */
  messages: { index: number; line: number; text: string; nodeId?: string; number?: number; numberInHeading?: boolean; target?: string; unlinked?: boolean }[];
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function headingIds(md: MarkdownIt): void {
  md.core.ruler.push('seqnotes_heading_ids', (state) => {
    const used = new Set<string>();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open') {
        continue;
      }
      const base = HEADING_ID_PREFIX + slugify(tokens[i + 1]?.content ?? '');
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
    for (const token of state.tokens) {
      if (token.map && token.nesting !== -1) {
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
    let attrs = forExport ? '' : ` data-line="${token.map?.[0] ?? 0}"`;
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
}

export function createMarkdown(): MarkdownIt {
  const md = markdownit({ html: true, linkify: true });
  md.use(markdownExtras).use(headingIds).use(sourceLines).use(mermaidFence).use(resourceLinks);
  return md;
}

export function renderDocument(md: MarkdownIt, source: string, env: RenderEnv = {}): string {
  const tokens = md.parse(source, env);
  const t = env.t ?? formatMessage;
  const { diagrams, warnings } = linkDiagrams(tokens, t);
  for (const diagram of diagrams) {
    const fence = tokens[diagram.fenceIndex];
    fence.meta = { ...fence.meta, seqNotes: diagram };
    const flowchart = diagram.kind === 'flowchart';
    for (const index of env.forExport ? [] : diagram.unlinkedHeadings) {
      tokens[index].attrJoin('class', 'seqnotes-unlinked');
      tokens[index].attrSet(
        'title',
        flowchart ? t('No node in the flowchart is linked to this heading.') : t('No arrow in the sequence diagram is linked to this heading.'),
      );
      // Shown by the CSS (`content: attr(...)`).
      tokens[index].attrSet('data-seqnotes-mark', flowchart ? t('no node') : t('no arrow'));
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
    // A horizontal flowchart is too wide to be put beside its overview.
    html += `<div class="seqnotes-pair${diagram.stacked ? ' seqnotes-pair-stacked' : ''}" data-diagram="${diagram.id}">`;
    html += `<div class="seqnotes-seq-col">${render(tokens.slice(diagram.fenceIndex, diagram.fenceIndex + 1))}</div>`;
    html += `<div class="seqnotes-overview-col">${render(tokens.slice(diagram.fenceIndex + 1, diagram.rangeEnd))}</div>`;
    html += '</div>\n';
    pos = diagram.rangeEnd;
  }
  html += render(tokens.slice(pos));
  return html;
}
