import { describe, expect, it } from 'vitest';
import { documentInfo, indexBody, type IndexEntry } from '../src/exportIndex';
import { formatMessage, type Translate } from '../src/l10n';
import { createMarkdown } from '../src/render';

const md = createMarkdown();

const doc = (...lines: string[]): string => lines.join('\n');

describe('documentInfo', () => {
  it('takes the title and the main entries of the front matter', () => {
    const source = doc('---', 'type: design_doc', 'title: Login', 'version: "1.2"', 'status: draft', 'updated:', 'owner: me', '---', '', '# Heading');
    expect(documentInfo(md, source, 'login.md')).toEqual({ title: 'Login', meta: { version: '1.2', status: 'draft' } });
  });

  it('hides the entries without the front matter', () => {
    expect(documentInfo(md, doc('---', 'title: Login', 'status: draft', '---'), 'login.md', false)).toEqual({ title: 'Login', meta: {} });
  });

  it('falls back to the first h1, then the file name', () => {
    expect(documentInfo(md, '# Main', 'doc.md')).toEqual({ title: 'Main', meta: {} });
    expect(documentInfo(md, 'text', 'doc.md')).toEqual({ title: 'doc.md', meta: {} });
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
    expect(html).toContain('<thead><tr><th>Title</th><th>File</th><th>Status</th></tr></thead>');
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
    expect(html).toContain('<th>タイトル</th><th>ファイル</th><th>版数</th>');
  });
});
