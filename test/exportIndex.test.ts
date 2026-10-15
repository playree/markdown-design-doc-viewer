import { describe, expect, it } from 'vitest';
import { documentInfo, groupByFolder, indexBody, mayHaveFrontMatter, type IndexEntry } from '../src/exportIndex';
import { formatMessage, type Translate } from '../src/l10n';
import { createMarkdown } from '../src/render';

const md = createMarkdown();

const doc = (...lines: string[]): string => lines.join('\n');

describe('documentInfo', () => {
  it('takes the title and the main entries of the front matter', () => {
    const source = doc('---', 'type: design_doc', 'title: Login', 'version: "1.2"', 'status: draft', 'updated:', 'owner: me', '---', '', '# Heading');
    expect(documentInfo(md, source, 'login.md')).toEqual({ title: 'Login', meta: { version: '1.2', status: 'draft' }, designDoc: true });
  });

  it('hides the entries without the front matter', () => {
    expect(documentInfo(md, doc('---', 'title: Login', 'status: draft', '---'), 'login.md', false)).toEqual({ title: 'Login', meta: {}, designDoc: false });
  });

  it('tells a design document by its type, also without the front matter', () => {
    expect(documentInfo(md, doc('---', 'type: "design_doc"', '---'), 'a.md').designDoc).toBe(true);
    expect(documentInfo(md, doc('---', 'type: design_doc', 'status: draft', '---'), 'a.md', false)).toEqual({ title: 'a.md', meta: {}, designDoc: true });
    expect(documentInfo(md, doc('---', 'type: api', '---'), 'a.md').designDoc).toBe(false);
    expect(documentInfo(md, doc('# A', '', 'type: design_doc'), 'a.md').designDoc).toBe(false);
  });

  it('falls back to the first h1, then the file name', () => {
    expect(documentInfo(md, '# Main', 'doc.md')).toEqual({ title: 'Main', meta: {}, designDoc: false });
    expect(documentInfo(md, 'text', 'doc.md')).toEqual({ title: 'doc.md', meta: {}, designDoc: false });
  });
});

describe('mayHaveFrontMatter', () => {
  it('tells the documents that start with ---', () => {
    expect(mayHaveFrontMatter('---\ntype: design_doc\n---')).toBe(true);
    expect(mayHaveFrontMatter('\uFEFF---\r\ntitle: A')).toBe(true);
    expect(mayHaveFrontMatter('# A\n---\n')).toBe(false);
    expect(mayHaveFrontMatter('----\n')).toBe(false);
  });
});

describe('groupByFolder', () => {
  it('puts the top folder first, each folder before its subfolders, and the files by name', () => {
    const entries = [
      { folder: 'b', file: 'x.md' },
      { folder: '', file: 'z.md' },
      { folder: 'a-b', file: 'w.md' },
      { folder: 'a/c', file: 'y.md' },
      { folder: 'a', file: 'v.md' },
      { folder: '', file: 'a.md' },
    ];
    expect(groupByFolder(entries).map(({ folder, entries: files }) => [folder, files.map((entry) => entry.file)])).toEqual([
      ['', ['a.md', 'z.md']],
      ['a', ['v.md']],
      ['a/c', ['y.md']],
      ['a-b', ['w.md']],
      ['b', ['x.md']],
    ]);
  });
});

describe('indexBody', () => {
  const entry = (folder: string, file: string, meta: Record<string, string> = {}): IndexEntry => ({
    href: `${folder ? `${folder}/` : ''}${file.replace(/\.md$/, '.html')}`,
    folder,
    file,
    title: file.replace(/\.md$/, ''),
    meta,
  });

  it('makes a table for each folder, the top one first', () => {
    const html = indexBody('Docs', [entry('b', 'x.md'), entry('', 'z.md'), entry('a-b', 'w.md'), entry('a/c', 'y.md'), entry('a', 'v.md'), entry('', 'a.md')], formatMessage);
    expect(html).toContain('<h1>Docs</h1>');
    const order = ['href="a.html"', 'href="z.html"', '<h2>a/</h2>', '<h2>a/c/</h2>', '<h2>a-b/</h2>', '<h2>b/</h2>'].map((s) => html.indexOf(s));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(html.match(/<table>/g)).toHaveLength(5);
  });

  it('shows only the columns that a document has', () => {
    const html = indexBody('Docs', [entry('', 'a.md', { status: 'draft' }), entry('', 'b.md')], formatMessage);
    expect(html).toContain('<thead><tr><th data-seqnotes-column="title">Title</th><th data-seqnotes-column="file">File</th><th data-seqnotes-column="status">Status</th></tr></thead>');
    expect(html).toContain('<td class="seqnotes-index-status"><span>draft</span></td>');
    expect(html).toContain('<td class="seqnotes-index-status"></td>');
    expect(html).not.toContain('Version');
  });

  it('escapes the texts and translates the headers', () => {
    const t: Translate = (message) => ({ Title: 'タイトル', File: 'ファイル', Version: '版数' })[message] ?? message;
    const html = indexBody('A & B', [{ ...entry('<x>', 'a.md', { version: '"1"' }), title: '<b>' }], t);
    expect(html).toContain('<h1>A &amp; B</h1>');
    expect(html).toContain('<h2>&lt;x&gt;/</h2>');
    expect(html).toContain('>&lt;b&gt;</a>');
    expect(html).toContain('<span>&quot;1&quot;</span>');
    expect(html).toContain('>タイトル</th><th data-seqnotes-column="file">ファイル</th><th data-seqnotes-column="version">版数</th>');
  });

  it('gives the texts of the search box to the script', () => {
    const t: Translate = (message) => ({ '{0} of {1} documents': '{1} 件中 {0} 件' })[message] ?? message;
    const html = indexBody('Docs', [entry('', 'a.md')], t);
    expect(html).toMatch(/^<div class="seqnotes-index" data-seqnotes-filter-label="Filter" [^>]*data-seqnotes-count="\{1\} 件中 \{0\} 件"/);
  });

  it('shows a text in place of the tables without documents', () => {
    const html = indexBody('Docs', [], formatMessage, 'No <docs>.');
    expect(html).toContain('<p class="seqnotes-index-empty">No &lt;docs&gt;.</p>');
    expect(html).not.toContain('<table>');
  });
});
