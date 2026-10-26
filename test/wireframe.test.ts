import { describe, expect, it } from 'vitest';
import { quickFixes } from '../src/authoring';
import { renderDiff } from '../src/diffRender';
import { collectIssues } from '../src/issues';
import { linkDiagrams } from '../src/linker';
import { createMarkdown, HEADING_ID_PREFIX, renderDocument, slugify } from '../src/render';
import {
  composeWireframe,
  loadWireframes,
  partNumber,
  rebasePath,
  stylesheetHrefs,
  wireframeDependencies,
  wireframeParts,
  wireframeSources,
  type WireframeFiles,
} from '../src/wireframe';

const md = createMarkdown();
const doc = (...lines: string[]): string => lines.join('\n');
const hid = (text: string): string => HEADING_ID_PREFIX + slugify(text);

const LOGIN = doc(
  '<!doctype html>',
  '<html><head><link rel="stylesheet" href="wireframe.css"><style>.form { display: grid; }</style></head>',
  '<body>',
  '<!-- <input data-item="9"> -->',
  '<label>ID <input data-item="1"></label>',
  '<label>Password <input type="password" data-item="２"></label>',
  '<button data-item="3">Log in</button>',
  '<a href="#" data-item="4" data-ref="Reset the password">Forgot your password?</a>',
  '<textarea><b data-item="8"></b></textarea>',
  '</body></html>',
);

const FILES: WireframeFiles = { 'screens/login.html': { html: LOGIN, stylesheets: { 'wireframe.css': 'body { margin: 0; }' } } };

const SAMPLE = doc(
  '# Login',
  '',
  '<!-- wireframe: link-headings width=375 -->',
  '[![Login screen](screens/login.png)](screens/login.html)',
  '',
  '<!-- table: item=No -->',
  '| No | Item |',
  '|---|---|',
  '| 1 | ID |',
  '| 2 | Password |',
  '| 5 | Remember me |',
  '',
  '## 3. Log in',
  '',
  '## Reset the password',
  '',
  '## 6. Help',
  '',
  '<!-- link-headings:end -->',
);

describe('wireframe files', () => {
  it('reads the numbered parts, but not those in comments or text', () => {
    expect(wireframeParts(LOGIN)).toEqual([{ item: '1' }, { item: '２' }, { item: '3' }, { item: '4', ref: 'Reset the password' }]);
  });

  it('reads the numbers with full-width digits', () => {
    expect(['1', '２', ' 03 ', 'A', '1.5', ''].map(partNumber)).toEqual([1, 2, 3, undefined, undefined, undefined]);
  });

  it('finds the local style sheets', () => {
    const html = '<link rel="stylesheet" href="a.css"><link rel="icon" href="b.png"><link rel="stylesheet" href="https://example.com/c.css">';
    expect(stylesheetHrefs(html)).toEqual(['a.css']);
  });

  it('makes the paths relative to the document', () => {
    expect(rebasePath('img/a.png', 'screens/login.html')).toBe('screens/img/a.png');
    expect(rebasePath('../a.png', 'screens/login.html')).toBe('a.png');
    expect(rebasePath('../../a.png', 'screens/login.html')).toBe('../a.png');
    expect(rebasePath('/img/a.png', 'screens/login.html')).toBe('/img/a.png');
    expect(rebasePath('a.css', 'login.html')).toBe('a.css');
  });

  it('puts the style sheets in their place and resolves the images', () => {
    const file = {
      html: '<link rel="stylesheet" href="css/a.css"><style>b { background: url(b.png) }</style><img alt="x" src="img/%E3%81%82.png?v=1"><img src="https://example.com/c.png">',
      stylesheets: { 'css/a.css': 'a { background: url("../bg.png") } </style>' },
    };
    expect(composeWireframe(file, 'screens/login.html', (src) => `R(${src})`)).toBe(
      '<style>a { background: url("R(screens/bg.png)") } <\\/style></style><style>b { background: url("R(screens/b.png)") }</style>' +
        '<img alt="x" src="R(screens/img/%E3%81%82.png?v=1)"><img src="https://example.com/c.png">',
    );
  });

  it('loads the files of the wireframes and their style sheets', async () => {
    const read = async (path: string): Promise<string | undefined> =>
      ({ 'screens/login.html': '<link rel="stylesheet" href="../css/a.css"><link rel="stylesheet" href="b.txt">', 'css/a.css': 'a {}' })[path];
    const files = await loadWireframes(['screens/login.html', 'missing.html'], read);
    expect(files).toEqual({
      'screens/login.html': { html: '<link rel="stylesheet" href="../css/a.css"><link rel="stylesheet" href="b.txt">', stylesheets: { '../css/a.css': 'a {}' } },
      'missing.html': null,
    });
    expect(wireframeDependencies('screens/login.html', files['screens/login.html'])).toEqual(['screens/login.html', 'css/a.css', 'screens/b.txt']);
  });
});

describe('wireframes in a document', () => {
  it('takes an image, a link or an image in a link to an HTML file, alone in its paragraph', () => {
    const src = doc(
      '![A](a.html)',
      '',
      '[B](b.htm?x#y)',
      '',
      '[![C](c.png)](c.html)',
      '',
      'See [D](d.html).',
      '',
      '![E](e.png)',
      '',
      '[F](https://example.com/f.html)',
      '',
      '- ![G](g.html)',
    );
    expect(wireframeSources(md.parse(src, {}))).toEqual(['a.html', 'b.htm?x#y', 'c.html', 'g.html']);
  });

  it('shows the text of a wireframe whose files were not read, and a message for one that could not be read', () => {
    expect(renderDocument(md, '![Login](screens/login.html)', { forExport: true })).toMatch(
      /^<div class="seqnotes-wireframe seqnotes-wireframe-missing" data-seqnotes-meta="[^"]*" role="figure" aria-label="Login"><p>Login<\/p><\/div>\n$/,
    );
    expect(renderDocument(md, '![Login](screens/login.html)', { forExport: true, wireframes: {} })).toContain(
      '<p>The wireframe &quot;screens/login.html&quot; could not be read.</p>',
    );
  });

  it('renders the HTML of a wireframe for the webview, with its options', () => {
    const html = renderDocument(md, doc('<!-- wireframe: width=375 -->', '![Login](screens/login.html)'), { wireframes: FILES, resolveResource: (src) => `R(${src})` });
    expect(html).toMatch(/^<!-- wireframe: width=375 -->\n<div class="seqnotes-wireframe" data-line="1" data-seqnotes-meta="[^"]*" data-seqnotes-width="375" role="figure" aria-label="Login"><pre class="seqnotes-wireframe-src">/);
    expect(html).toContain('&lt;style&gt;body { margin: 0; }&lt;/style&gt;');
  });

  it('links the parts to the numbered headings, the heading of data-ref and the rows of the item tables', () => {
    const tokens = md.parse(SAMPLE, { wireframes: FILES });
    const { diagrams, warnings } = linkDiagrams(tokens);
    expect(warnings).toEqual([]);
    const [d] = diagrams;
    expect(d).toMatchObject({ kind: 'wireframe', paired: true, stacked: false });
    expect(d.messages.map((m) => [m.nodeId, m.target, m.unlinked])).toEqual([
      ['1', 'seqnotes-part-0-1', undefined],
      ['2', 'seqnotes-part-0-2', undefined],
      ['3', hid('3. Log in'), undefined],
      ['4', hid('Reset the password'), undefined],
    ]);
    expect(d.rows.map((r) => [r.item, r.target, r.unlinked])).toEqual([
      ['1', 'seqnotes-part-0-1', undefined],
      ['2', 'seqnotes-part-0-2', undefined],
      ['5', undefined, true],
    ]);
    expect(d.unlinkedHeadings.map((i) => tokens[i + 1].content)).toEqual(['6. Help']);
  });

  it('marks the linked rows and those without a part', () => {
    const html = renderDocument(md, SAMPLE, { wireframes: FILES });
    expect(html).toContain('<tr data-line="8" data-seqnotes-section="seqnotes-part-0-1" class="seqnotes-row">');
    expect(html).toContain('<tr data-line="10" class="seqnotes-unlinked">\n<td title="No part of the wireframe has the number of this row." data-seqnotes-mark="no part">5</td>');
    expect(html).toContain('<div class="seqnotes-pair" data-diagram="0"><div class="seqnotes-seq-col"><div class="seqnotes-wireframe"');
  });

  it('lays out a stacked wireframe below its overview', () => {
    const html = renderDocument(md, doc('<!-- wireframe: link-headings stacked -->', '![Login](screens/login.html)', '', '## 1. ID'), { wireframes: FILES });
    expect(html).toContain('<div class="seqnotes-pair seqnotes-pair-stacked" data-diagram="0">');
  });

  it('reports the problems of the options, the files and the parts', () => {
    const files: WireframeFiles = { 'a.html': { html: '<i data-item="x"></i><i data-item="1" data-ref="Nowhere"></i>', stylesheets: {} } };
    const src = doc(
      '<!-- wireframe: link-headings width=wide size=1 -->',
      '![A](a.html)',
      '',
      '<!-- wireframe: link-headings -->',
      '',
      'Text',
      '',
      '- <!-- wireframe: link-headings -->',
      '  ![B](b.html)',
    );
    expect(linkDiagrams(md.parse(src, { wireframes: files })).warnings.map((w) => [w.line, w.message])).toEqual([
      [0, 'Write the width of the wireframe in pixels: "width=<number>".'],
      [0, 'Unknown wireframe option "size". Write "link-headings", "width=<pixels>" or "stacked".'],
      [1, 'data-item "x" of the wireframe "a.html" is not a number.'],
      [1, 'data-ref target heading "Nowhere" was not found after the wireframe.'],
      [3, 'The wireframe options are not followed by a wireframe.'],
      [7, 'link-headings is ignored for a wireframe inside a list or blockquote.'],
      [8, 'The wireframe "b.html" could not be read.'],
    ]);
  });

  it('reports the unlinked parts, headings and rows', () => {
    expect(collectIssues(md, SAMPLE, undefined, FILES).map((i) => [i.line, i.severity, i.message])).toEqual([
      [10, 'info', 'No part of the wireframe has the number 5 of this row.'],
      [16, 'info', 'No part of the wireframe is linked to heading "6. Help".'],
    ]);
    const unlinked = doc('<!-- wireframe: link-headings -->', '![A](screens/login.html)', '', '## 1. ID');
    expect(collectIssues(md, unlinked, undefined, FILES).map((i) => [i.line, i.message])).toEqual([
      [1, 'data-ref target heading "Reset the password" was not found after the wireframe.'],
      [1, 'Part 2 of the wireframe is not linked to any heading or row. Add a heading numbered 2 after the wireframe, or a row with 2 in the column of "item=".'],
      [1, 'Part 3 of the wireframe is not linked to any heading or row. Add a heading numbered 3 after the wireframe, or a row with 3 in the column of "item=".'],
      [1, 'Part 4 of the wireframe is not linked to any heading or row. Add a heading numbered 4 after the wireframe, or a row with 4 in the column of "item=".'],
    ]);
    const nothing = doc('<!-- wireframe: link-headings -->', '![A](screens/login.html)', '', '## ID');
    expect(collectIssues(md, nothing, undefined, FILES).map((i) => i.line)).toEqual([1, 1]);
  });

  it('warns of the item= options it cannot apply', () => {
    const src = doc('<!-- table: item=No item=Item -->', '| No | Item |', '|---|---|', '| 1 | ID |', '', '<!-- table: item=Code -->', '| No |', '|---|', '| 1 |', '', '<!-- table: item -->', '| No |', '|---|', '| 1 |');
    expect(collectIssues(md, src).map((i) => [i.line, i.message])).toEqual([
      [0, 'Write "item=" only once in the table options.'],
      [5, 'No column "Code" in the table.'],
      [10, 'Write one column for the part numbers: "item=<column>".'],
    ]);
  });

  it('links only the rows of the item tables in the overview range', () => {
    const src = doc(
      '<!-- table: item=No -->',
      '| No |',
      '|---|',
      '| 1 |',
      '',
      '<!-- wireframe: link-headings -->',
      '![A](screens/login.html)',
      '',
      '| No |',
      '|---|',
      '| 2 |',
      '',
      '<!-- table: item=No -->',
      '| No | Item |',
      '|---|---|',
      '| **3** | Log in |',
      '| 7 | Help |',
      '',
      '<!-- link-headings:end -->',
      '',
      '<!-- table: item=No -->',
      '| No |',
      '|---|',
      '| 4 |',
    );
    const [d] = linkDiagrams(md.parse(src, { wireframes: FILES })).diagrams;
    expect(d.rows.map((r) => [r.line, r.item, r.target, r.unlinked])).toEqual([
      [15, '3', 'seqnotes-part-0-3', undefined],
      [16, '7', undefined, true],
    ]);
  });

  it('checks no part without the files', () => {
    expect(collectIssues(md, SAMPLE)).toEqual([]);
  });

  it('offers no quick fix for the parts of a wireframe', () => {
    expect(quickFixes(md, SAMPLE, 3)).toEqual([]);
  });

  it('keeps the wireframe of a document compared with a revision', () => {
    const { html, old } = renderDiff(md, SAMPLE.replace('Login screen', 'Login'), SAMPLE, { wireframes: FILES });
    expect(html).toMatch(/<div class="seqnotes-wireframe" data-line="3" data-seqnotes-diff="changed" data-seqnotes-diff-old="0" data-seqnotes-meta=/);
    expect(old[0]).toMatch(/^<div class="seqnotes-wireframe" data-seqnotes-width="375" role="figure" aria-label="Login"><pre class="seqnotes-wireframe-src">/);
  });
});
