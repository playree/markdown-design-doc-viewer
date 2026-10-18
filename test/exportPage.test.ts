import { describe, expect, it } from 'vitest';
import { documentTitle, exportDiff, exportFileName, exportPage, imagePath, imageType, isExternalUrl, renderDiffForExport, renderForExport, stripSourceMap } from '../src/exportPage';
import type { Translate } from '../src/l10n';
import { createMarkdown } from '../src/render';

const md = createMarkdown();

const doc = (...lines: string[]): string => lines.join('\n');

describe('documentTitle', () => {
  it('takes the title of the front matter first', () => {
    expect(documentTitle(md, doc('---', 'title: Login', '---', '', '# Heading'), 'login.md')).toBe('Login');
  });

  it('takes the first h1, then the file name', () => {
    expect(documentTitle(md, doc('## Sub', '', '# Main', '', '# Other'), 'doc.md')).toBe('Main');
    expect(documentTitle(md, '## Sub', 'doc.md')).toBe('doc.md');
  });
});

describe('exportFileName', () => {
  it('replaces the Markdown extension with .html', () => {
    expect(exportFileName('login.md')).toBe('login.html');
    expect(exportFileName('Login.MARKDOWN')).toBe('Login.html');
    expect(exportFileName('notes.txt')).toBe('notes.txt.html');
  });
});

describe('images', () => {
  it('tells external URLs from local paths', () => {
    expect(['https://example.com/a.png', 'data:image/png;base64,AA', '//host/a.png', '#top'].every(isExternalUrl)).toBe(true);
    expect(['a.png', '/img/a.png', '../a.png'].some(isExternalUrl)).toBe(false);
  });

  it('decodes the path without its query and fragment', () => {
    expect(imagePath('my%20image.png?v=1#x')).toBe('my image.png');
    expect(imagePath('100%.png')).toBe('100%.png');
  });

  it('knows the types that are embedded', () => {
    expect(imageType('a/b.PNG')).toBe('image/png');
    expect(imageType('a.svg')).toBe('image/svg+xml');
    expect(imageType('a.pdf')).toBeUndefined();
  });
});

describe('renderForExport', () => {
  it('resolves the local images and leaves the external ones', async () => {
    const seen: string[] = [];
    const html = await renderForExport(md, doc('![a](a.png) ![b](https://example.com/b.png) ![c](c%20d.png)'), {}, async (src) => {
      seen.push(src);
      return `resolved/${src}?"`;
    });
    expect(seen).toEqual(['a.png', 'c%20d.png']);
    expect(html).toContain('src="resolved/a.png?&quot;"');
    expect(html).toContain('src="https://example.com/b.png"');
    expect(html).not.toContain('seqnotes-export-resource');
  });

  it('keeps the query and fragment of a link, not of a data URI', async () => {
    const html = await renderForExport(md, '![a](icons.svg#save) ![b](a.png?v=1) ![c](c.png#x)', {}, async (src) =>
      src.startsWith('c') ? 'data:image/png;base64,AA' : `../${imagePath(src)}`,
    );
    expect(html).toContain('src="../icons.svg#save"');
    expect(html).toContain('src="../a.png?v=1"');
    expect(html).toContain('src="data:image/png;base64,AA"');
  });

  it('renders without the source lines', async () => {
    const html = await renderForExport(md, '# Title', {}, async (src) => src);
    expect(html).not.toContain('data-line');
  });
});

describe('renderDiffForExport', () => {
  it('resolves the images of the document and of the blocks of the revision', async () => {
    const { html, old, stats } = await renderDiffForExport(md, 'Old text with ![a](old.png) here.', 'New text with ![a](new.png) here.', {}, async (src) => `data:${src}`);
    expect(stats).toEqual({ added: 0, changed: 1, deleted: 0 });
    expect(html).toContain('src="data:new.png"');
    expect(html).toContain('data-seqnotes-diff="changed"');
    expect(old).toHaveLength(1);
    expect(old[0]).toContain('src="data:old.png"');
    expect([html, ...old].join('')).not.toContain('seqnotes-export-resource');
  });

  it('renders without the source lines, and marks nothing without changes', async () => {
    const { html, stats } = await renderDiffForExport(md, '# Title', '# Title', {}, async (src) => src);
    expect(stats).toEqual({ added: 0, changed: 0, deleted: 0 });
    expect(html).not.toContain('data-line');
    expect(html).not.toContain('data-seqnotes-diff');
  });
});

describe('stripSourceMap', () => {
  it('removes the source map comment at the end', () => {
    expect(stripSourceMap('code();\n//# sourceMappingURL=webview.js.map\n')).toBe('code();');
    expect(stripSourceMap('a{}\n/*# sourceMappingURL=webview.css.map */')).toBe('a{}');
    expect(stripSourceMap('code();')).toBe('code();');
  });
});

describe('exportPage', () => {
  const page = (settings = { limitContentWidth: true, stickyTableHeader: true, tableTreeHighlight: true, splitMinWidth: 1000 }) =>
    exportPage({ lang: 'ja', title: 'A < B', body: '<p>body</p>', styles: ['a{}', 'b{}</style>'], script: 'x("</script>")', settings });

  it('inlines the styles and the script, so that they cannot close their elements', () => {
    const html = page();
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('<title>A &lt; B</title>');
    expect(html).toContain('a{}\nb{}<\\/style>');
    expect(html).toContain('x("<\\/script>")');
    expect(html).toContain('<div id="seqnotes-root"><p>body</p></div>');
  });

  it('gives the differences and the texts of their bar to the script', () => {
    const settings = { limitContentWidth: true, stickyTableHeader: true, tableTreeHighlight: true, splitMinWidth: 1000 };
    const t: Translate = (message) => ({ 'Hide changes': '差分を隠す' })[message] ?? message;
    const diff = exportDiff({ label: 'v1 "a" & b', old: ['<p>x</p>'], stats: { added: 1, changed: 2, deleted: 3 } }, t);
    const html = exportPage({ lang: 'ja', title: 'A', body: '', styles: [], script: '', settings, diff });
    expect(html).toContain(' data-seqnotes-diff-label="v1 &quot;a&quot; &amp; b" data-seqnotes-diff-stats="1,2,3"');
    expect(html).toContain(' data-seqnotes-diff-hide-title="差分を隠す"');
    expect(html).toContain(' data-seqnotes-diff-added="{0} added"');
    expect(html).not.toContain('data-seqnotes-diff-close-title');
    expect(html).not.toContain('&lt;p&gt;x');
    expect(page()).not.toContain('data-seqnotes-diff');
  });

  it('applies the settings to the body', () => {
    expect(page()).toContain('class="seqnotes-export seqnotes-limit-width seqnotes-sticky-table-header seqnotes-table-tree-highlight" data-seqnotes-split-min-width="1000"');
    expect(page({ limitContentWidth: false, stickyTableHeader: false, tableTreeHighlight: false, splitMinWidth: 800 })).toContain('class="seqnotes-export" data-seqnotes-split-min-width="800"');
    expect(page({ limitContentWidth: false, stickyTableHeader: false, tableTreeHighlight: false, splitMinWidth: NaN })).toContain('data-seqnotes-split-min-width="1000"');
  });
});
