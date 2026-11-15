import { afterEach, describe, expect, it, vi } from 'vitest';
import { designDocListHtml } from '../embed/designDocList';
import { openLinkInPage } from '../embed/viewer';
import { createMarkdown } from '../src/markdown/render';
import { formatMessage, translatorFor } from '../src/shared/l10n';
import ja from '../l10n/bundle.l10n.ja.json';

const md = createMarkdown();

describe('designDocListHtml', () => {
  it('takes the titles and the main entries of the front matter of the documents', () => {
    const html = designDocListHtml(
      md,
      {
        documents: [
          { markdown: '---\ntype: design_doc\ntitle: Login\nversion: "1.2"\nstatus: draft\n---\n', href: '/docs/1', file: '#1' },
          { markdown: '# Logout', href: '/docs/2', folder: 'Screens', file: '#2' },
          { markdown: '---\nstatus: done\n---\n', href: '/docs/3', file: '#3', title: 'Given title' },
        ],
      },
      formatMessage,
    );
    expect(html).toContain('<h1>Design Docs</h1>');
    expect(html).toContain('<a href="/docs/1">Login</a>');
    expect(html).toContain('<td class="seqnotes-index-version"><span>1.2</span></td>');
    expect(html).toContain('<a href="/docs/2">Logout</a>');
    expect(html).toContain('<h2>Screens/</h2>');
    expect(html).toContain('<a href="/docs/3">Given title</a>');
    expect(html).toContain('<td class="seqnotes-index-status"><span>done</span></td>');
  });

  it('falls back to the file name, then to the link, for the title', () => {
    const html = designDocListHtml(md, { documents: [{ markdown: 'text', href: 'a', file: 'a.md' }, { markdown: '', href: 'b' }] }, formatMessage);
    expect(html).toContain('<a href="a">a.md</a>');
    expect(html).toContain('<a href="b">b</a>');
  });

  it('takes the texts of the app, or translates those of the extension', () => {
    const t = translatorFor(ja);
    expect(designDocListHtml(md, { documents: [] }, t)).toContain('<h1>設計書一覧</h1>');
    expect(designDocListHtml(md, { documents: [] }, t)).toContain('設計書（front matter に type: design_doc を書いた Markdown）はありません。');
    const html = designDocListHtml(md, { documents: [{ markdown: '', href: 'a', file: '#1' }], title: 'Specs', fileLabel: 'No.', filterPlaceholder: 'Search' }, t);
    expect(html).toContain('<h1>Specs</h1>');
    expect(html).toContain('<th data-seqnotes-column="file">No.</th>');
    expect(html).toContain('data-seqnotes-filter-placeholder="Search"');
    expect(designDocListHtml(md, { documents: [], empty: 'None.' }, t)).toContain('<p class="seqnotes-index-empty">None.</p>');
  });

  it('keeps the order of the documents when asked to', () => {
    const documents = [
      { markdown: '# B', href: 'b', file: '#2' },
      { markdown: '# A', href: 'a', file: '#10' },
    ];
    const order = (keepOrder: boolean): number[] => ['href="b"', 'href="a"'].map((s) => designDocListHtml(md, { documents, keepOrder }, formatMessage).indexOf(s));
    expect(order(true)[0]).toBeLessThan(order(true)[1]);
    // By file name, as in the extension.
    expect(order(false)[0]).toBeGreaterThan(order(false)[1]);
  });
});

describe('openLinkInPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The URLs `openLinkInPage` goes to for `href`. */
  function open(href: string): string[] {
    const assign = vi.fn();
    vi.stubGlobal('document', { baseURI: 'https://example.com/app/' });
    vi.stubGlobal('window', { location: { assign } });
    openLinkInPage(href);
    return assign.mock.calls.map(([url]) => url as string);
  }

  it('goes to a link of the app, resolved from the page', () => {
    expect(open('/docs/a')).toEqual(['https://example.com/docs/a']);
    expect(open('b?x=1')).toEqual(['https://example.com/app/b?x=1']);
    expect(open('https://example.org/')).toEqual(['https://example.org/']);
  });

  it('does not go to a link that runs a script, however it is written', () => {
    expect(open('javascript:alert(1)')).toEqual([]);
    expect(open(' JavaScript:alert(1)')).toEqual([]);
    expect(open('java\tscript:alert(1)')).toEqual([]);
    expect(open('java\nscript:alert(1)')).toEqual([]);
    expect(open('data:text/html,<script>alert(1)</script>')).toEqual([]);
    expect(open(' DATA:text/html,x')).toEqual([]);
    expect(open('vbscript:msgbox(1)')).toEqual([]);
  });

  it('does not go to a link that is not a URL', () => {
    expect(open('http://[')).toEqual([]);
  });
});
