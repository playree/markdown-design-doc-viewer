import { describe, expect, it } from 'vitest';
import { renderDiff } from '../src/diffRender';
import { createMarkdown, renderDocument } from '../src/render';

const md = createMarkdown();
const doc = (...lines: string[]): string => lines.join('\n');

/** The opening tags with a diff mark, in order. */
const marks = (html: string): string[] => Array.from(html.matchAll(/<(\w+)[^>]*data-seqnotes-diff="(\w+)"/g), (m) => `${m[1]}:${m[2]}`);

describe('renderDiff', () => {
  it('marks nothing when the document did not change', () => {
    const source = doc('# Title', '', 'Text.', '', '- a', '- b');
    const result = renderDiff(md, source, source);
    expect(result.html).toBe(renderDocument(md, source));
    expect(result.stats).toEqual({ added: 0, changed: 0, deleted: 0 });
    expect(result.old).toEqual([]);
  });

  it('marks the paragraphs added, changed and deleted', () => {
    const before = doc('# Title', '', 'ユーザー情報を取得する。', '', 'Removed text.');
    const after = doc('# Title', '', 'ユーザー情報を更新する。', '', 'Something else entirely.');
    const result = renderDiff(md, before, after);
    expect(marks(result.html)).toEqual(['p:changed', 'p:deleted', 'p:added']);
    expect(result.old).toEqual(['<p>ユーザー情報を取得する。</p>\n']);
    expect(result.html).toContain('data-seqnotes-diff-old="0"');
    expect(result.stats).toEqual({ added: 1, changed: 1, deleted: 1 });
  });

  it('puts a deleted block where it was, without source line nor heading id', () => {
    const result = renderDiff(md, doc('# A', '', '## Removed', '', '# B'), doc('# A', '', '# B'));
    expect(result.html).toMatch(/<h1 id="sn-a"[^>]*>A<\/h1>\n<h2 data-seqnotes-diff="deleted">Removed<\/h2>\n<h1 id="sn-b"/);
  });

  it('compares the items of a list and the rows of a table inside them', () => {
    const before = doc('- a', '- b', '- c', '', '| h | i |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |');
    const after = doc('- a', '- c', '- d', '', '| h | i |', '|---|---|', '| 1 | 2 |', '| 5 | 6 |', '| 3 | 4 |');
    const { html, stats } = renderDiff(md, before, after);
    expect(marks(html)).toEqual(['li:deleted', 'li:added', 'tr:added']);
    expect(html).toMatch(/<ul[^>]*>\n<li[^>]*>a<\/li>\n<li data-seqnotes-diff="deleted">b<\/li>/);
    expect(html).toMatch(/<tbody[^>]*>[^]*<tr[^>]*data-seqnotes-diff="added">\n<td>5<\/td>[^]*<\/tbody>/);
    expect(stats).toEqual({ added: 2, changed: 0, deleted: 1 });
  });

  it('does not take numbering the items of a list again as a change', () => {
    const { html } = renderDiff(md, doc('1. a', '2. b'), doc('1. new', '2. a', '3. b'));
    expect(marks(html)).toEqual(['li:added']);
  });

  it('wraps a changed code block, whose renderer leaves out the attributes', () => {
    const { html, old } = renderDiff(md, doc('```js', 'x = 1;', '```'), doc('```js', 'x = 2;', '```'));
    expect(html).toMatch(/^<div class="seqnotes-diff-block" data-seqnotes-diff="changed" data-seqnotes-diff-old="0">\n<pre><code[^]*<\/pre>\n<\/div>\n$/);
    expect(old[0]).toContain('<pre><code');
  });

  it('ignores the changes of HTML comments', () => {
    const { stats } = renderDiff(md, doc('Text.', '', '<!-- link-headings:end -->'), doc('Text.'));
    expect(stats).toEqual({ added: 0, changed: 0, deleted: 0 });
  });

  it('keeps a diagram beside its steps, and the deleted steps out of the links', () => {
    const diagram = (arrow: string): string[] => ['```mermaid', '%% @link-headings', 'sequenceDiagram', `  A->>B: ${arrow}`, '```', ''];
    const before = doc('# Flow', '', ...diagram('ユーザー情報を取得'), '## ユーザー情報を取得', '', '## 古い処理', '', '<!-- link-headings:end -->');
    const after = doc('# Flow', '', ...diagram('ユーザー情報を更新'), '## ユーザー情報を更新', '', '<!-- link-headings:end -->');
    const { html, old } = renderDiff(md, before, after);
    expect(html).toContain('<div class="seqnotes-pair"');
    expect(html).toMatch(/<div class="seqnotes-seq-col"><div class="seqnotes-mermaid" data-line="2" data-seqnotes-diff="changed" data-seqnotes-diff-old="0" data-seqnotes-meta=/);
    // The revision's diagram is drawn as it was, without links.
    expect(old[0]).toMatch(/^<div class="seqnotes-mermaid"><pre/);
    expect(html).toMatch(/<div class="seqnotes-overview-col">[^]*<h2 data-seqnotes-diff="deleted">古い処理<\/h2>/);
    // The same warnings as the document alone (none).
    expect(html).not.toContain('seqnotes-warnings');
    expect(html).not.toContain('seqnotes-unlinked');
  });
});
