/**
 * Options of a table, written in an HTML comment right before it (`<!-- table: level=階層 merge=項目名,物理名 -->`),
 * so that the Markdown stays a plain table elsewhere (e.g. on GitHub):
 * - `merge=A,B…` shows the cells of columns B… under those of column A, in one column.
 * - `level=L` takes the integers of column L as the depth of each row, hides that column and shows the rows as a tree
 *   in the column right of it: indented with lines, the rows with children emphasized and foldable.
 * The columns are hidden (`seqnotes-cell-hidden`), not removed, so that a button in the header shows the table as it is
 * (`seqnotes-table-plain`, in webview/tableTree.ts and preview.css).
 */
import type { MarkdownIt, StateCore, Token } from 'markdown-it';
import { formatMessage, type Translate } from './l10n';
import type { LinkWarning } from './linker';
import type { RenderEnv } from './render';
import { toAsciiDigits } from './sequence';

const DIRECTIVE_RE = /^<!--\s*table:([^]*?)-->\s*$/;

export interface TableOption {
  key: string;
  values: string[];
}

/** Reads `key=value,value key=value`, where a value with spaces or commas is quoted (`"桁 最小"`). */
export function parseTableOptions(text: string): TableOption[] {
  const options: TableOption[] = [];
  let pos = 0;
  const skipSpaces = (): void => {
    while (pos < text.length && /\s/.test(text[pos])) {
      pos++;
    }
  };
  const read = (re: RegExp): string => {
    re.lastIndex = pos;
    const m = re.exec(text);
    const s = m && m.index === pos ? m[0] : '';
    pos += s.length;
    return s;
  };
  for (skipSpaces(); pos < text.length; skipSpaces()) {
    const key = read(/[^\s=]+/g);
    if (text[pos] !== '=') {
      options.push({ key: key || text[pos++], values: [] });
      continue;
    }
    pos++;
    const values: string[] = [];
    for (;;) {
      let value: string;
      if (text[pos] === '"') {
        const end = text.indexOf('"', pos + 1);
        value = text.slice(pos + 1, end < 0 ? text.length : end);
        pos = end < 0 ? text.length : end + 1;
      } else {
        value = read(/[^\s,"]+/g);
      }
      values.push(value.trim());
      const before = pos;
      skipSpaces();
      if (text[pos] !== ',') {
        pos = before;
        break;
      }
      pos++;
      skipSpaces();
    }
    options.push({ key, values: values.filter((v) => v !== '') });
  }
  return options;
}

/** A cell of a row: its `th_open`/`td_open`, `inline` and closing tokens. */
interface Cell {
  open: number;
  inline: Token;
}

interface Row {
  open: number;
  head: boolean;
  cells: Cell[];
}

/** Guides drawn in front of a row of the tree, one per level above it: a line going on (│), nothing, or its own (├ └). */
type Guide = 'pipe' | 'blank' | 'tee' | 'elbow';

/**
 * The depth of each row (0 for the top), from the level of each row (undefined when it is not an integer, taken as the top).
 * A row is a child of the last row above it with a lower level, so a row more than one level deeper is a child too.
 */
export function rowDepths(levels: (number | undefined)[]): number[] {
  const valid = levels.filter((l): l is number => l !== undefined);
  const top = valid.length === 0 ? 0 : Math.min(...valid);
  // The levels of the ancestors of the current row, and its own.
  const stack: number[] = [];
  return levels.map((l) => {
    const level = l ?? top;
    while (stack.length > 0 && stack[stack.length - 1] >= level) {
      stack.pop();
    }
    stack.push(level);
    return stack.length - 1;
  });
}

/** The guides of each row of a tree whose rows are at `depths`, and whether each row has children. */
export function treeGuides(depths: number[]): { guides: Guide[][]; parent: boolean[] } {
  // Whether a row has a sibling after it, before a row less deep.
  const hasNext: boolean[] = new Array<boolean>(depths.length);
  const seen: boolean[] = [];
  for (let i = depths.length - 1; i >= 0; i--) {
    const d = depths[i];
    hasNext[i] = seen[d] === true;
    seen[d] = true;
    seen.length = d + 1;
  }
  // Whether the row at each depth above the current row has a sibling after it.
  const goesOn: boolean[] = [];
  const guides = depths.map((d, i) => {
    const row: Guide[] = [];
    for (let k = 0; k < d - 1; k++) {
      row.push(goesOn[k + 1] ? 'pipe' : 'blank');
    }
    if (d > 0) {
      row.push(hasNext[i] ? 'tee' : 'elbow');
    }
    goesOn[d] = hasNext[i];
    return row;
  });
  return { guides, parent: depths.map((d, i) => i + 1 < depths.length && depths[i + 1] > d) };
}

function rowsOf(tokens: Token[], start: number): Row[] {
  const rows: Row[] = [];
  let head = false;
  for (let i = start + 1; i < tokens.length && tokens[i].type !== 'table_close'; i++) {
    const token = tokens[i];
    if (token.type === 'thead_open' || token.type === 'thead_close') {
      head = token.type === 'thead_open';
    } else if (token.type === 'tr_open') {
      rows.push({ open: i, head, cells: [] });
    } else if ((token.type === 'th_open' || token.type === 'td_open') && tokens[i + 1]?.type === 'inline') {
      rows[rows.length - 1]?.cells.push({ open: i, inline: tokens[i + 1] });
    }
  }
  return rows;
}

/** The text of a cell without its Markdown (`**Level**`, `` `Item` ``). */
const textOf = (inline: Token): string =>
  (inline.children ?? [])
    .filter((child) => child.type === 'text' || child.type === 'code_inline' || child.type === 'text_special')
    .map((child) => child.content)
    .join('')
    .trim();

/** Applies the options of a table, and returns its warnings. */
function formatTable(state: StateCore, start: number, options: TableOption[], line: number, t: Translate): LinkWarning[] {
  const tokens = state.tokens;
  const warnings: LinkWarning[] = [];
  const warn = (message: string, at = line): void => {
    warnings.push({ line: at, message });
  };
  const rows = rowsOf(tokens, start);
  const header = rows.find((row) => row.head);
  if (!header) {
    return warnings;
  }
  // A column is named by the source of its header, or by its text.
  const names = header.cells.map((cell) => [cell.inline.content.trim(), textOf(cell.inline)]);
  const used = new Set<number>();
  const column = (name: string): number | undefined => {
    const index = names.findIndex((n) => n.includes(name));
    if (index < 0) {
      warn(t('No column "{0}" in the table.', name));
      return undefined;
    }
    if (used.has(index)) {
      warn(t('Column "{0}" is given twice in the table options.', name));
      return undefined;
    }
    used.add(index);
    return index;
  };

  let level: number | undefined;
  let levelGiven = false;
  const merges: number[][] = [];
  for (const option of options) {
    if (option.key === 'level') {
      if (levelGiven) {
        warn(t('Write "level=" only once in the table options.'));
      } else if (option.values.length !== 1) {
        warn(t('Write one column for the level: "level=<column>".'));
      } else {
        level = column(option.values[0]);
      }
      levelGiven = true;
    } else if (option.key === 'merge' && option.values.length >= 2) {
      const group = option.values.map(column).filter((c): c is number => c !== undefined);
      if (group.length >= 2) {
        merges.push(group);
      }
    } else if (option.key === 'merge') {
      warn(t('Write two or more columns to merge: "merge=<column>,<column>".'));
    } else {
      warn(t('Unknown table option "{0}". Write "level=<column>" or "merge=<column>,<column>".', option.key));
    }
  }

  const span = (html: string): Token => {
    const token = new state.Token('html_inline', '', 0);
    token.content = html;
    return token;
  };
  const isEmpty = (cell: Cell | undefined): boolean => !cell || cell.inline.content.trim() === '';
  const hidden = new Set<number>();
  const hide = (cell: Cell | undefined): void => {
    if (cell && !hidden.has(cell.open)) {
      hidden.add(cell.open);
      tokens[cell.open].attrJoin('class', 'seqnotes-cell-hidden');
    }
  };
  /** Marks the table, and adds the button showing it as a plain table at the right of its header, once the options are applied. */
  const addPlainToggle = (): void => {
    if (merges.length === 0 && level === undefined) {
      return;
    }
    tokens[start].attrJoin('class', 'seqnotes-item-table');
    const last = header.cells.filter((cell) => !hidden.has(cell.open)).pop();
    if (!last) {
      return;
    }
    tokens[last.open].attrJoin('class', 'seqnotes-table-plain-cell');
    const label = state.md.utils.escapeHtml(t('Show as a plain table'));
    const icon =
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 2.5h11v11h-11zM2.5 6h11M2.5 9.75h11M6.5 6v7.5M10 6v7.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
    last.inline.children = [
      ...(last.inline.children ?? []),
      span(`<button type="button" class="seqnotes-table-plain-toggle" aria-pressed="false" aria-label="${label}" title="${label}">${icon}</button>`),
    ];
  };

  for (const row of rows) {
    for (const [first, ...others] of merges) {
      const main = row.cells[first];
      if (!main) {
        continue;
      }
      const children: Token[] = [span('<span class="seqnotes-cell-main">'), ...(main.inline.children ?? []), span('</span>')];
      for (const other of others) {
        const cell = row.cells[other];
        if (!isEmpty(cell)) {
          children.push(span('<span class="seqnotes-cell-sub">'), ...(cell.inline.children ?? []), span('</span>'));
        }
        hide(cell);
      }
      main.inline.children = children;
    }
  }

  if (level === undefined) {
    addPlainToggle();
    return warnings;
  }
  const levelColumn = level;
  let treeColumn = levelColumn + 1 < names.length ? levelColumn + 1 : levelColumn - 1;
  treeColumn = merges.find((group) => group.includes(treeColumn))?.[0] ?? treeColumn;
  const body = rows.filter((row) => !row.head);
  const depths = rowDepths(
    body.map((row) => {
      const text = toAsciiDigits(row.cells[levelColumn]?.inline.content.trim() ?? '');
      if (/^\d+$/.test(text)) {
        return Number(text);
      }
      warn(t('The level "{0}" is not an integer.', text), tokens[row.open].map?.[0] ?? line);
      return undefined;
    }),
  );
  const { guides, parent } = treeGuides(depths);
  tokens[start].attrJoin('class', 'seqnotes-tree-table');
  for (const row of rows) {
    hide(row.cells[levelColumn]);
  }
  const tree = treeColumn >= 0 ? header.cells[treeColumn] : undefined;
  addPlainToggle();
  if (!tree) {
    return warnings;
  }
  tokens[tree.open].attrJoin('class', 'seqnotes-tree-head');
  const toggle = state.md.utils.escapeHtml(t('Child rows'));
  body.forEach((row, i) => {
    const tr = tokens[row.open];
    tr.attrSet('data-seqnotes-depth', String(depths[i]));
    const cell = row.cells[treeColumn];
    if (!cell) {
      return;
    }
    const open = tokens[cell.open];
    open.attrJoin('class', 'seqnotes-tree-cell');
    const style = open.attrGet('style');
    open.attrSet('style', `${style ? `${style};` : ''}--seqnotes-depth:${depths[i]}`);
    let html = '<span class="seqnotes-tree-guides" aria-hidden="true">';
    html += guides[i].map((guide) => `<span class="seqnotes-tree-${guide}"></span>`).join('');
    if (parent[i]) {
      tr.attrJoin('class', 'seqnotes-tree-parent');
      html += '<span class="seqnotes-tree-stem"></span>';
    }
    html += '</span>';
    if (parent[i]) {
      html += `<button type="button" class="seqnotes-tree-toggle" aria-expanded="true" aria-label="${toggle}" title="${toggle}"></button>`;
    }
    cell.inline.children = [span(html), ...(cell.inline.children ?? [])];
  });
  return warnings;
}

const WARNINGS = 'seqNotesTableWarnings';

/** Applies the options of the tables (after the inline rule, which parses the cells). */
export function tableOptions(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'seqnotes_table_options', (state: StateCore) => {
    const t = (state.env as RenderEnv | undefined)?.t ?? formatMessage;
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const m = token.type === 'html_block' ? DIRECTIVE_RE.exec(token.content.trim()) : null;
      if (!m) {
        continue;
      }
      const line = token.map?.[0] ?? 0;
      const warnings =
        tokens[i + 1]?.type === 'table_open'
          ? formatTable(state, i + 1, parseTableOptions(m[1]), line, t)
          : [{ line, message: t('The table options are not followed by a table.') }];
      if (warnings.length > 0) {
        token.meta = { ...token.meta, [WARNINGS]: warnings };
      }
    }
  });
}

/** The warnings of the table options in a document's tokens. */
export function tableWarnings(tokens: Token[]): LinkWarning[] {
  return tokens.flatMap((token) => ((token.meta as Record<string, LinkWarning[]> | null)?.[WARNINGS] ?? []));
}
