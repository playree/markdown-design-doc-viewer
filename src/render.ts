import markdownit, { type Env, type MarkdownIt, type Token } from 'markdown-it';
import { isMermaidFence, linkDiagrams, type DiagramInfo } from './linker';
import { HEADING_ID_PREFIX, slugify } from './slug';

export { HEADING_ID_PREFIX, slugify };

export type RenderEnv = Env & {
  /** Rewrites relative resource URLs (images) to something the webview can load. */
  resolveResource?: (src: string) => string;
};

/** Diagram data embedded into the HTML for the webview script. */
export interface DiagramMeta {
  id: number;
  paired: boolean;
  messages: { index: number; line: number; text: string; target?: string }[];
}

const escapeHtml = (s: string): string =>
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
    for (const token of state.tokens) {
      if (token.map && token.nesting !== -1) {
        token.attrSet('data-line', String(token.map[0]));
      }
    }
  });
}

function mermaidFence(md: MarkdownIt): void {
  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (!isMermaidFence(token)) {
      return defaultFence(tokens, idx, options, env, self);
    }
    const diagram = token.meta?.seqNotes as DiagramInfo | undefined;
    const line = token.map?.[0] ?? 0;
    let attrs = `data-line="${line}"`;
    if (diagram) {
      const meta: DiagramMeta = {
        id: diagram.id,
        paired: diagram.paired,
        messages: diagram.messages.map(({ index, line, text, target }) => ({ index, line, text, target })),
      };
      attrs += ` data-seqnotes-meta="${escapeHtml(JSON.stringify(meta))}"`;
    }
    return `<div class="seqnotes-mermaid" ${attrs}><pre class="seqnotes-mermaid-src">${escapeHtml(token.content)}</pre></div>\n`;
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
  md.use(headingIds).use(sourceLines).use(mermaidFence).use(resourceLinks);
  return md;
}

export function renderDocument(md: MarkdownIt, source: string, env: RenderEnv = {}): string {
  const tokens = md.parse(source, env);
  const { diagrams, warnings } = linkDiagrams(tokens);
  for (const diagram of diagrams) {
    const fence = tokens[diagram.fenceIndex];
    fence.meta = { ...fence.meta, seqNotes: diagram };
  }

  const render = (slice: Token[]): string => md.renderer.render(slice, md.options, env);

  let html = '';
  if (warnings.length > 0) {
    html += '<div class="seqnotes-warnings">';
    for (const w of warnings) {
      // Not data-line: the warnings sit above the content, and the scroll sync expects data-line in document order.
      html += `<p data-seqnotes-jump="${w.line}">⚠ Line ${w.line + 1}: ${escapeHtml(w.message)}</p>`;
    }
    html += '</div>\n';
  }

  let pos = 0;
  for (const diagram of diagrams) {
    if (!diagram.paired) {
      continue;
    }
    html += render(tokens.slice(pos, diagram.fenceIndex));
    html += `<div class="seqnotes-pair" data-diagram="${diagram.id}">`;
    html += `<div class="seqnotes-seq-col">${render(tokens.slice(diagram.fenceIndex, diagram.fenceIndex + 1))}</div>`;
    html += `<div class="seqnotes-overview-col">${render(tokens.slice(diagram.fenceIndex + 1, diagram.rangeEnd))}</div>`;
    html += '</div>\n';
    pos = diagram.rangeEnd;
  }
  html += render(tokens.slice(pos));
  return html;
}
