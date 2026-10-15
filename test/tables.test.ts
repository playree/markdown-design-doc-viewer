import { describe, expect, it } from 'vitest';
import { renderDiff } from '../src/diffRender';
import { collectIssues } from '../src/issues';
import { createMarkdown, renderDocument } from '../src/render';
import { parseTableOptions, rowDepths, treeGuides } from '../src/tables';

const md = createMarkdown();
const doc = (...lines: string[]): string => lines.join('\n');
const render = (...lines: string[]): string => renderDocument(md, doc(...lines), { forExport: true });

/** The cells of each row, as their inner HTML. */
const cells = (html: string): string[][] =>
  Array.from(html.matchAll(/<tr[^>]*>([^]*?)<\/tr>/g), (row) => Array.from(row[1].matchAll(/<t[hd][^>]*>([^]*?)<\/t[hd]>/g), (cell) => cell[1]));

const guidesOf = (html: string): string[] =>
  Array.from(html.matchAll(/<span class="seqnotes-tree-guides" aria-hidden="true">([^]*?)<\/span>(?=<button|<span class="seqnotes-cell|[^<])/g), (m) =>
    Array.from(m[1].matchAll(/seqnotes-tree-(\w+)/g), (g) => g[1]).join(' '),
  );

describe('parseTableOptions', () => {
  it('reads keys and comma separated values, quoted or not', () => {
    expect(parseTableOptions(' level=階層 merge=項目名, 物理名 merge="桁 最小","桁 最大" ')).toEqual([
      { key: 'level', values: ['階層'] },
      { key: 'merge', values: ['項目名', '物理名'] },
      { key: 'merge', values: ['桁 最小', '桁 最大'] },
    ]);
  });

  it('keeps a word without a value as an option without values', () => {
    expect(parseTableOptions('tree level=')).toEqual([
      { key: 'tree', values: [] },
      { key: 'level', values: [] },
    ]);
  });
});

describe('rowDepths and treeGuides', () => {
  it('takes the lowest level as the top, and a row deeper than a child as a child', () => {
    expect(rowDepths([2, 3, 5, 3, undefined, 4])).toEqual([0, 1, 2, 1, 0, 1]);
    // The rows after a skipped level are compared with the levels of the rows above, not their depths.
    expect(rowDepths([1, 3, 4, 3, 2])).toEqual([0, 1, 2, 1, 1]);
  });

  it('draws the lines of the levels above and the row itself', () => {
    const { guides, parent } = treeGuides([0, 1, 2, 1, 2, 0, 1]);
    expect(guides).toEqual([[], ['tee'], ['pipe', 'elbow'], ['elbow'], ['blank', 'elbow'], [], ['elbow']]);
    expect(parent).toEqual([true, true, false, true, false, true, false]);
  });
});

describe('table options', () => {
  const table = (options: string): string[] => [
    `<!-- table: ${options} -->`,
    '| No | 階層 | 項目名 | 物理名 | 説明 |',
    '|---|---|---|:-:|---|',
    '| 11 | 1 | リクエスト | `requestParameter` | 親 |',
    '| 12 | 2 | ID | `xxId` | 子 |',
    '| 13 | 1 | 情報 |  | 親 |',
  ];

  it('leaves a table without options as it is', () => {
    const source = table('merge=項目名,物理名').slice(1);
    expect(render(...source)).not.toContain('seqnotes-');
  });

  it('shows the merged columns in the cell of the first one', () => {
    const html = render(...table('merge=項目名,物理名'));
    expect(cells(html)).toEqual([
      ['No', '階層', '<span class="seqnotes-cell-main">項目名</span><span class="seqnotes-cell-sub">物理名</span>', '説明'],
      ['11', '1', '<span class="seqnotes-cell-main">リクエスト</span><span class="seqnotes-cell-sub"><code>requestParameter</code></span>', '親'],
      ['12', '2', '<span class="seqnotes-cell-main">ID</span><span class="seqnotes-cell-sub"><code>xxId</code></span>', '子'],
      // An empty cell adds no line.
      ['13', '1', '<span class="seqnotes-cell-main">情報</span>', '親'],
    ]);
    expect(html).not.toContain('seqnotes-tree');
  });

  it('shows the rows as a tree in the column right of the level, which is hidden', () => {
    const html = render(...table('level=階層 merge=項目名,物理名'));
    expect(html).toContain('<table class="seqnotes-tree-table">');
    expect(cells(html).map((row) => row.length)).toEqual([3, 3, 3, 3]);
    expect(html).toContain('<th class="seqnotes-tree-head"><span class="seqnotes-cell-main">項目名</span>');
    expect(html).toContain('<tr data-seqnotes-depth="0" class="seqnotes-tree-parent">');
    expect(html).toContain('<tr data-seqnotes-depth="1">');
    expect(html).toContain('<td class="seqnotes-tree-cell" style="--seqnotes-depth:1">');
    expect(guidesOf(html)).toEqual(['stem', 'elbow', '']);
    expect(html.match(/<button type="button" class="seqnotes-tree-toggle" aria-expanded="true" aria-label="Child rows" title="Child rows"><\/button>/g)).toHaveLength(1);
  });

  it('draws the tree in the column left of the level when it is the last one', () => {
    const html = render('<!-- table: level=L -->', '| Name | L |', '|---|---|', '| a | 1 |', '| b | 2 |');
    expect(cells(html).map((row) => row.length)).toEqual([1, 1, 1]);
    expect(html).toContain('<th class="seqnotes-tree-head">Name</th>');
    expect(guidesOf(html)).toEqual(['stem', 'elbow']);
  });

  it('keeps the alignment of a tree cell, and accepts full-width digits', () => {
    const html = render('<!-- table: level=L -->', '| L | Name |', '|---|:-:|', '| １ | a |', '| ２ | b |');
    expect(html).toContain('<td style="text-align:center;--seqnotes-depth:1" class="seqnotes-tree-cell">');
  });

  it('applies the options written right before the table without a blank line', () => {
    const html = render('<!-- table: merge=a,b -->', '| a | b |', '|---|---|', '| 1 | 2 |');
    expect(cells(html)[1]).toEqual(['<span class="seqnotes-cell-main">1</span><span class="seqnotes-cell-sub">2</span>']);
  });

  it('warns of the options it cannot apply, at their lines', () => {
    const source = doc(
      '<!-- table: level=Lv merge=a,x merge=a tree -->',
      '| a | b | Lv |',
      '|---|---|---|',
      '| 1 | 2 | 1 |',
      '| 3 | 4 | two |',
      '',
      '<!-- table: merge=a,b -->',
      '',
      'Not a table.',
    );
    const messages = [
      'No column "x" in the table.',
      'Write two or more columns to merge: "merge=<column>,<column>".',
      'Unknown table option "tree". Write "level=<column>" or "merge=<column>,<column>".',
    ];
    expect(collectIssues(md, source)).toEqual([
      ...messages.map((message) => ({ line: 0, message, severity: 'warning' })),
      { line: 4, message: 'The level "two" is not an integer.', severity: 'warning' },
      { line: 6, message: 'The table options are not followed by a table.', severity: 'warning' },
    ]);
    expect(renderDocument(md, source)).toContain('⚠ Line 5: The level &quot;two&quot; is not an integer.');
  });

  it('warns of a column or a level given twice', () => {
    const issues = collectIssues(md, doc('<!-- table: level=a merge=a,b level=b -->', '| a | b |', '|---|---|', '| 1 | 2 |'));
    expect(issues.map((issue) => issue.message)).toEqual(['Column "a" is given twice in the table options.', 'Write "level=" only once in the table options.']);
  });

  it('names a column by the source of its header or by its text', () => {
    const html = render('<!-- table: merge=Item,"`Physical name`" -->', '| **Item** | `Physical name` |', '|---|---|', '| a | b |');
    expect(cells(html)[1]).toEqual(['<span class="seqnotes-cell-main">a</span><span class="seqnotes-cell-sub">b</span>']);
  });

  it('translates the warnings and the label of the button', () => {
    const t = (message: string): string => `[${message}]`;
    expect(collectIssues(md, doc('<!-- table: merge=a,b -->'), t)[0].message).toBe('[The table options are not followed by a table.]');
    expect(renderDocument(md, doc(...table('level=階層')), { t })).toContain('aria-label="[Child rows]"');
  });

  it('builds the tree of the rows compared with a revision', () => {
    const before = doc(...table('level=階層 merge=項目名,物理名'));
    const after = doc(...table('level=階層 merge=項目名,物理名').filter((line) => !line.startsWith('| 12 ')), '| 14 | 2 | 追加 | `added` | 子 |');
    const { html } = renderDiff(md, before, after);
    // The deleted row keeps its depth and its line, and the added row is a child of the row above it.
    expect(html).toMatch(/<tr data-seqnotes-depth="1" data-seqnotes-diff="deleted">\n<td>12<\/td>\n<td class="seqnotes-tree-cell"/);
    expect(html).toMatch(/<tr data-seqnotes-depth="1" data-line="\d+" data-seqnotes-diff="added">\n<td>14<\/td>/);
    expect(html).not.toContain('<td>1</td>');
  });
});
