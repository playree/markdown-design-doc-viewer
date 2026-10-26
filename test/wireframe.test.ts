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
    expect(wireframeParts(md, LOGIN)).toEqual([{ item: '1' }, { item: '２' }, { item: '3' }, { item: '4', ref: 'Reset the password' }]);
  });

  it('reads the numbers with full-width digits', () => {
    expect(['1', '２', ' 03 ', 'A', '1.5', ''].map(partNumber)).toEqual([1, 2, 3, undefined, undefined, undefined]);
  });

  it('finds the local style sheets', () => {
    const html = '<link rel="stylesheet" href="a&period;css"><link rel="icon" href="b.png"><link rel="stylesheet" href="https://example.com/c.css">';
    expect(stylesheetHrefs(md, html)).toEqual(['a.css']);
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
      html:
        '<link rel="stylesheet" href="css/a.css"><style>b { background: url(b.png) }</style><img alt="x" src="img/%E3%81%82.png?v=1"><img src="https://example.com/c.png">' +
        '<div style="background: url(\'d&lowbar;1.png\')"><input type="image" src="e.png"><script src="f.js"></script>',
      stylesheets: { 'css/a.css': 'a { background: url("../bg.png") } </style>' },
    };
    expect(composeWireframe(md, file, 'screens/login.html', (src) => `R(${src})`)).toBe(
      '<style>a { background: url("R(screens/bg.png)") } <\\/style></style><style>b { background: url("R(screens/b.png)") }</style>' +
        '<img alt="x" src="R(screens/img/%E3%81%82.png?v=1)"><img src="https://example.com/c.png">' +
        '<div style="background: url(&quot;R(screens/d_1.png)&quot;)"><input type="image" src="R(screens/e.png)"><script src="f.js"></script>',
    );
  });

  it('loads the files of the wireframes and their style sheets', async () => {
    const read = async (path: string): Promise<string | undefined> =>
      ({ 'screens/login.html': '<link rel="stylesheet" href="../css/a.css"><link rel="stylesheet" href="b.txt">', 'css/a.css': 'a {}' })[path];
    const files = await loadWireframes(md, ['screens/login.html', 'missing.html'], read);
    expect(files).toEqual({
      'screens/login.html': { html: '<link rel="stylesheet" href="../css/a.css"><link rel="stylesheet" href="b.txt">', stylesheets: { '../css/a.css': 'a {}' } },
      'missing.html': null,
    });
    expect(wireframeDependencies(md, 'screens/login.html', files['screens/login.html'])).toEqual(['screens/login.html', 'css/a.css', 'screens/b.txt']);
  });
});

describe('wireframes in a document', () => {
  it('takes an image of an HTML file alone in its paragraph, and at the top level a link or an image in a link to one', () => {
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
      '- [H](h.html)',
      '',
      '> [I](i.html)',
    );
    expect(wireframeSources(md.parse(src, {}))).toEqual(['a.html', 'b.htm?x#y', 'c.html', 'g.html']);
  });

  it('shows the text of a wireframe whose files were not read, and a message for one that could not be read', () => {
    expect(renderDocument(md, '![Login](screens/login.html)', { forExport: true })).toMatch(
      /^<div class="seqnotes-wireframe seqnotes-wireframe-missing" data-seqnotes-meta="[^"]*" role="figure" aria-label="Login"><p>Login<\/p><\/div>\n$/,
    );
    expect(renderDocument(md, '![Login](screens/login.html)', { forExport: true, wireframes: { 'screens/login.html': null } })).toContain(
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
    const files: WireframeFiles = { 'a.html': { html: '<i data-item="x"></i><i data-item="1" data-ref="Nowhere"></i>', stylesheets: {} }, 'b.html': null };
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
      [0, 'Unknown wireframe option "size". Write "link-headings", "width=<pixels>", "stacked" or \'item.<number>="<selector>"\'.'],
      [1, 'data-item "x" of the wireframe "a.html" is not a number.'],
      [1, 'data-ref target heading "Nowhere" was not found after the wireframe.'],
      [3, 'The wireframe options are not followed by a wireframe.'],
      [7, 'link-headings is ignored for a wireframe inside a list or blockquote.'],
      [8, 'The wireframe "b.html" could not be read.'],
    ]);
  });

  it('numbers the parts by the selectors of the options, in a comment of several lines', () => {
    const files: WireframeFiles = { 'a.html': { html: '<input id="email"><button data-item="3">Go</button>', stylesheets: {} } };
    const src = doc(
      '<!-- wireframe: link-headings',
      '  item.1="#email"',
      "  item.２=\"input[name='password']\"",
      '  item.3=button',
      '  item.4=a,.link',
      '-->',
      '![A](a.html)',
      '',
      '## 1. Email',
      '',
      '## 2. Password',
      '',
      '## 3. Go',
      '',
      '## 4. Link',
    );
    const { diagrams, warnings } = linkDiagrams(md.parse(src, { wireframes: files }));
    expect(warnings).toEqual([]);
    expect(diagrams[0].messages.map((m) => [m.nodeId, m.line, m.target])).toEqual([
      ['3', 6, hid('3. Go')],
      ['1', 0, hid('1. Email')],
      ['2', 0, hid('2. Password')],
      ['4', 0, hid('4. Link')],
    ]);
    const html = renderDocument(md, src, { wireframes: files });
    expect(html).toContain(
      ` data-seqnotes-items="[[1,&quot;#email&quot;],[2,&quot;input[name='password']&quot;],[3,&quot;button&quot;],[4,&quot;a, .link&quot;]]" data-seqnotes-item-unmatched="No element of the wireframe matches item.{0}=&quot;{1}&quot;." data-seqnotes-item-invalid="item.{0}=&quot;{1}&quot; of the wireframe is not a valid CSS selector."`,
    );
  });

  it('takes no part from the selectors without the file, and reports the options of the parts that cannot be read', () => {
    const src = doc('<!-- wireframe: link-headings item.1="#email" item.x=b item.2 -->', '![A](a.html)', '', '## 1. Email');
    const { diagrams, warnings } = linkDiagrams(md.parse(src, {}));
    expect(diagrams[0].messages).toEqual([]);
    expect(warnings.map((w) => [w.line, w.message])).toEqual([
      [0, 'Write the selector of a part of the wireframe: \'item.<number>="<selector>"\'.'],
      [0, 'Write the selector of a part of the wireframe: \'item.<number>="<selector>"\'.'],
    ]);
    expect(renderDocument(md, src)).not.toContain('data-seqnotes-items');
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

  it('links a part by data-ref to a numbered heading by its text without the number, as @ref', () => {
    const files: WireframeFiles = { 'a.html': { html: '<b data-item="9" data-ref="Sign in"></b>', stylesheets: {} } };
    const [d] = linkDiagrams(md.parse(doc('<!-- wireframe: link-headings -->', '![A](a.html)', '', '## 4. Sign in'), { wireframes: files })).diagrams;
    expect(d.messages.map((m) => m.target)).toEqual([hid('4. Sign in')]);
  });

  it('takes the part numbers from a column merged into another one', () => {
    const src = doc('<!-- wireframe: link-headings -->', '![A](screens/login.html)', '', '<!-- table: merge=Item,No item=No -->', '| No | Item |', '|---|---|', '| 1 | ID |');
    const tokens = md.parse(src, { wireframes: FILES });
    const { diagrams, warnings } = linkDiagrams(tokens);
    // No "given twice" for the column: only that of the part 4 of the file.
    expect(warnings.map((w) => w.message)).toEqual(['data-ref target heading "Reset the password" was not found after the wireframe.']);
    expect(diagrams[0].rows.map((r) => [r.item, r.target])).toEqual([['1', 'seqnotes-part-0-1']]);
  });

  it('shows the text of a wireframe of a revision that the document does not have any more', () => {
    const before = doc('![Old screen](screens/old.html)', '', 'Text');
    const { html } = renderDiff(md, before, 'Text', { wireframes: {} });
    expect(html).toContain('<div class="seqnotes-wireframe seqnotes-wireframe-missing" data-seqnotes-diff="deleted" role="figure" aria-label="Old screen"><p>Old screen</p></div>');
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
