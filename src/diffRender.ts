/**
 * Renders a document with its differences from a revision (from git): the blocks added, changed and deleted since,
 * marked for the webview, which shows the words changed in a block (webview/diff.ts). No dependency on vscode or Node.
 */
import { diffArrays } from 'diff';
import markdownit, { type MarkdownIt, type Token } from 'markdown-it';
import { isMermaidFence } from './linker';
import { renderTokens, type RenderEnv } from './render';
import { similarity, wordSegmenter } from './textDiff';

/** `data-seqnotes-diff` of a block. A changed one has `data-seqnotes-diff-old`, the index of the revision's block in `DiffRender.old`. */
export type DiffMark = 'added' | 'changed' | 'deleted';

export interface DiffStats {
  added: number;
  changed: number;
  deleted: number;
}

export interface DiffRender {
  html: string;
  /** HTML of the revision's blocks that changed, by `data-seqnotes-diff-old`. */
  old: string[];
  stats: DiffStats;
}

/** Two blocks of a kind are the same block changed when they have this much in common (`similarity`). */
const SIMILAR = 0.4;

/** Blocks compared item by item: their items or rows are added, changed or deleted, rather than the whole block. */
const CONTAINERS = new Set(['bullet_list_open', 'ordered_list_open', 'table_open']);

/** Blocks whose renderer leaves out the attributes of their token: they are marked by a <div> around them. */
const WRAPPED = new Set(['fence', 'html_block', 'front_matter']);

/** A mermaid block has the attributes (`mermaidFence` in render.ts), and must stay a block of its own to be laid out with its steps. */
const isWrapped = (token: Token): boolean => WRAPPED.has(token.type) && !isMermaidFence(token);

/** An HTML block of comments only (such as `<!-- link-headings:end -->`) shows nothing, so its changes are not shown. */
const COMMENTS_RE = /^\s*(?:<!--[^]*?-->\s*)+$/;

/** A list item's marker, left out of the comparison so that numbering the items again does not change them. */
const LIST_MARKER_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]?/;

/** A block of a document: its tokens `[start, end)`. */
interface Unit {
  start: number;
  end: number;
  /** Its source, compared with the other document's blocks. */
  key: string;
  kind: string;
}

type Op =
  | { type: 'equal'; before: Unit; after: Unit }
  | { type: 'added'; after: Unit }
  | { type: 'changed'; before: Unit; after: Unit }
  | { type: 'deleted'; before: Unit };

function kindOf(token: Token): string {
  if (token.type === 'heading_open') {
    return token.tag;
  }
  if (token.type === 'fence') {
    return isMermaidFence(token) ? 'mermaid' : 'fence';
  }
  return token.type;
}

/** The blocks at `level` among `tokens[start, end)`: the top-level ones, or the items of a list or the rows of a table. */
function unitsOf(tokens: Token[], lines: string[], start: number, end: number, level: number): Unit[] {
  const units: Unit[] = [];
  for (let i = start; i < end; ) {
    const token = tokens[i];
    if (token.level !== level || token.nesting === -1 || !token.block) {
      i++;
      continue;
    }
    let close = i;
    if (token.nesting === 1) {
      while (close < end && !(tokens[close].level === level && tokens[close].nesting === -1)) {
        close++;
      }
    }
    if (token.map && !(token.type === 'html_block' && COMMENTS_RE.test(token.content))) {
      let key = lines.slice(token.map[0], token.map[1]).join('\n');
      if (token.type === 'list_item_open') {
        key = key.replace(LIST_MARKER_RE, '');
      }
      units.push({ start: i, end: close + 1, key: key.trimEnd(), kind: kindOf(token) });
    }
    i = close + 1;
  }
  return units;
}

/** The blocks of both documents in the order of the new one, each deleted block before the block that followed it. */
function align(before: Unit[], after: Unit[], alike: (a: Unit, b: Unit) => boolean): Op[] {
  const ops: Op[] = [];
  let removed: Unit[] = [];
  let added: Unit[] = [];
  const flush = (): void => {
    // Pairs the removed and added blocks that are the same block changed, keeping their order.
    const pairs: [number, number][] = [];
    let next = 0;
    added.forEach((b, j) => {
      const i = removed.findIndex((a, k) => k >= next && alike(a, b));
      if (i >= 0) {
        pairs.push([i, j]);
        next = i + 1;
      }
    });
    let i = 0;
    let j = 0;
    for (const [pi, pj] of [...pairs, [removed.length, added.length] as [number, number]]) {
      while (i < pi) {
        ops.push({ type: 'deleted', before: removed[i++] });
      }
      while (j < pj) {
        ops.push({ type: 'added', after: added[j++] });
      }
      if (pi < removed.length) {
        ops.push({ type: 'changed', before: removed[pi], after: added[pj] });
        i = pi + 1;
        j = pj + 1;
      }
    }
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  for (const change of diffArrays(
    before.map((u) => u.key),
    after.map((u) => u.key),
  )) {
    if (change.removed) {
      removed.push(...before.slice(i, (i += change.count)));
    } else if (change.added) {
      added.push(...after.slice(j, (j += change.count)));
    } else {
      flush();
      for (let k = 0; k < change.count; k++) {
        ops.push({ type: 'equal', before: before[i++], after: after[j++] });
      }
    }
  }
  flush();
  return ops;
}

export function renderDiff(md: MarkdownIt, beforeSource: string, afterSource: string, env: RenderEnv = {}): DiffRender {
  const segmenter = wordSegmenter();
  const beforeEnv: RenderEnv = { resolveResource: env.resolveResource, t: env.t, frontMatter: env.frontMatter, headingNumbers: env.headingNumbers, forExport: true };
  // Without source lines (`forExport`), so that the revision's blocks do not take part in the editor sync.
  const beforeTokens = md.parse(beforeSource, beforeEnv);
  const afterTokens = md.parse(afterSource, env);
  for (const token of beforeTokens) {
    // Not targets of links nor of the contents, and not in conflict with the ids of the document.
    if (token.type === 'heading_open' && token.attrs) {
      token.attrs = token.attrs.filter(([name]) => name !== 'id');
    }
  }
  const beforeLines = beforeSource.split(/\r\n?|\n/);
  const afterLines = afterSource.split(/\r\n?|\n/);

  const old: string[] = [];
  const stats: DiffStats = { added: 0, changed: 0, deleted: 0 };
  /** Tokens to add before the token at an index of `afterTokens` (or at its end). */
  const inserted = new Map<number, Token[]>();
  const insert = (index: number, token: Token): void => {
    inserted.set(index, [...(inserted.get(index) ?? []), token]);
  };
  const htmlToken = (content: string, level: number): Token => {
    const token = new markdownit.Token('html_block', '', 0);
    token.content = content;
    token.block = true;
    token.level = level;
    return token;
  };
  const wrapped = (mark: DiffMark, html: string): string => `<div class="seqnotes-diff-block" data-seqnotes-diff="${mark}">\n${html}</div>\n`;

  const renderBefore = (unit: Unit): string => md.renderer.render(beforeTokens.slice(unit.start, unit.end), md.options, beforeEnv);
  const mark = (unit: Unit, value: DiffMark, oldIndex?: number): void => {
    const token = afterTokens[unit.start];
    if (isWrapped(token)) {
      const attrs = oldIndex === undefined ? '' : ` data-seqnotes-diff-old="${oldIndex}"`;
      insert(unit.start, htmlToken(`<div class="seqnotes-diff-block" data-seqnotes-diff="${value}"${attrs}>\n`, token.level));
      insert(unit.end, htmlToken('</div>\n', token.level));
      return;
    }
    token.attrSet('data-seqnotes-diff', value);
    if (oldIndex !== undefined) {
      token.attrSet('data-seqnotes-diff-old', String(oldIndex));
    }
  };

  const alike = (a: Unit, b: Unit): boolean =>
    a.kind === b.kind && (CONTAINERS.has(a.kind) || a.kind === 'mermaid' || similarity(a.key, b.key, segmenter) >= SIMILAR);

  /** Marks the blocks of `after` against those of `before`, which are at `level` of their tokens. */
  const compare = (before: Unit[], after: Unit[], level: number): void => {
    const ops = align(before, after, alike);
    // A deleted block goes before the block after it, or after the last block.
    let deleted: Unit[] = [];
    const flushDeleted = (index: number): void => {
      for (const unit of deleted) {
        const token = beforeTokens[unit.start];
        let html: string;
        if (isWrapped(token)) {
          html = wrapped('deleted', renderBefore(unit));
        } else {
          token.attrSet('data-seqnotes-diff', 'deleted');
          html = renderBefore(unit);
        }
        insert(index, htmlToken(html, level));
        stats.deleted++;
      }
      deleted = [];
    };
    for (const op of ops) {
      if (op.type === 'deleted') {
        deleted.push(op.before);
        continue;
      }
      flushDeleted(op.after.start);
      if (op.type === 'added') {
        mark(op.after, 'added');
        stats.added++;
      } else if (op.type === 'changed') {
        const kind = op.after.kind;
        if (CONTAINERS.has(kind)) {
          // The items of a list, or the rows of a table (in its head and body).
          const depth = kind === 'table_open' ? 2 : 1;
          compare(
            unitsOf(beforeTokens, beforeLines, op.before.start + 1, op.before.end - 1, level + depth),
            unitsOf(afterTokens, afterLines, op.after.start + 1, op.after.end - 1, level + depth),
            level + depth,
          );
        } else {
          old.push(renderBefore(op.before));
          mark(op.after, 'changed', old.length - 1);
          stats.changed++;
        }
      }
    }
    flushDeleted(after.length > 0 ? after[after.length - 1].end : 0);
  };

  compare(unitsOf(beforeTokens, beforeLines, 0, beforeTokens.length, 0), unitsOf(afterTokens, afterLines, 0, afterTokens.length, 0), 0);

  const tokens: Token[] = [];
  for (let i = 0; i <= afterTokens.length; i++) {
    tokens.push(...(inserted.get(i) ?? []));
    if (i < afterTokens.length) {
      tokens.push(afterTokens[i]);
    }
  }
  return { html: renderTokens(md, tokens, env), old, stats };
}
