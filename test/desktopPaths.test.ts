import { describe, expect, it } from 'vitest';
import { fileUrl, isInside, linkTarget, relativeLink, resolveDocumentPath, resourcePath } from '../desktop/paths';

describe('resolveDocumentPath', () => {
  it('resolves a path relative to the folder of the document', () => {
    expect(resolveDocumentPath('/home/me/docs', 'images/a.png')).toBe('/home/me/docs/images/a.png');
    expect(resolveDocumentPath('/home/me/docs', './a.png')).toBe('/home/me/docs/a.png');
    expect(resolveDocumentPath('/home/me/docs', '../a.png')).toBe('/home/me/a.png');
  });

  it('does not go above the root', () => {
    expect(resolveDocumentPath('/home', '../../../a.png')).toBe('/a.png');
    expect(resolveDocumentPath('C:\\docs', '..\\..\\a.png')).toBe('C:\\a.png');
  });

  it('resolves a leading / from the folder of the document', () => {
    expect(resolveDocumentPath('/home/me/docs', '/images/a.png')).toBe('/home/me/docs/images/a.png');
    expect(resolveDocumentPath('D:\\work\\docs', '/images/a.png')).toBe('D:\\work\\docs\\images\\a.png');
  });

  it('uses the separator of Windows for a Windows folder', () => {
    expect(resolveDocumentPath('D:\\work\\docs', 'images/a.png')).toBe('D:\\work\\docs\\images\\a.png');
    expect(resolveDocumentPath('D:/work/docs', '../a.png')).toBe('D:\\work\\a.png');
    expect(resolveDocumentPath('D:\\', 'a.png')).toBe('D:\\a.png');
  });

  it('keeps the server and share of a UNC path', () => {
    expect(resolveDocumentPath('\\\\server\\share\\docs', '../../a.png')).toBe('\\\\server\\share\\a.png');
  });
});

describe('resourcePath', () => {
  it('leaves URLs to the webview', () => {
    expect(resourcePath('/docs', 'https://example.com/a.png')).toBeUndefined();
    expect(resourcePath('/docs', 'data:image/png;base64,AAAA')).toBeUndefined();
    expect(resourcePath('/docs', '//example.com/a.png')).toBeUndefined();
  });

  it('drops the query and fragment and decodes the path', () => {
    expect(resourcePath('/docs', 'images/a%20b.png?v=1#x')).toBe('/docs/images/a b.png');
    expect(resourcePath('C:\\docs', '%E5%9B%B3.png')).toBe('C:\\docs\\図.png');
  });
});

describe('linkTarget', () => {
  it('opens web and mail links in their apps, and ignores other schemes', () => {
    expect(linkTarget('/docs', 'https://example.com/a')).toEqual({ kind: 'url', url: 'https://example.com/a' });
    expect(linkTarget('/docs', 'mailto:a@example.com')).toEqual({ kind: 'url', url: 'mailto:a@example.com' });
    expect(linkTarget('/docs', 'javascript:alert(1)')).toBeUndefined();
    expect(linkTarget('/docs', 'file:///etc/passwd')).toBeUndefined();
  });

  it('opens Markdown documents in the app, with the heading of the fragment', () => {
    expect(linkTarget('C:\\docs', 'other.md')).toEqual({ kind: 'document', path: 'C:\\docs\\other.md' });
    expect(linkTarget('C:\\docs', '../api/%E8%A8%AD%E8%A8%88.markdown#%E6%A6%82%E8%A6%81')).toEqual({ kind: 'document', path: 'C:\\api\\設計.markdown', fragment: '%E6%A6%82%E8%A6%81' });
  });

  it('opens other files with their default app', () => {
    expect(linkTarget('/docs', 'files/spec.pdf?download=1')).toEqual({ kind: 'file', path: '/docs/files/spec.pdf' });
  });
});

describe('relativeLink', () => {
  it('links relative to the folder of the exported file', () => {
    expect(relativeLink('/home/me/docs/a.html', '/home/me/docs/images/a.png')).toBe('images/a.png');
    expect(relativeLink('/home/me/out/a.html', '/home/me/docs/a.png')).toBe('../docs/a.png');
    expect(relativeLink('/a.html', '/home/a.png')).toBe('home/a.png');
  });

  it('uses / and escapes the names', () => {
    expect(relativeLink('D:\\work\\out\\a.html', 'D:\\work\\docs\\my images\\a#1.png')).toBe('../docs/my%20images/a%231.png');
  });

  it('compares the names of Windows without case', () => {
    expect(relativeLink('C:\\Work\\Docs\\a.html', 'c:\\work\\docs\\images\\a.png')).toBe('images/a.png');
    expect(relativeLink('/home/Me/a.html', '/home/me/a.png')).toBe('../me/a.png');
  });

  it('uses a file URL on another drive or share', () => {
    expect(relativeLink('C:\\out\\a.html', 'D:\\docs\\a b.png')).toBe('file:///D:/docs/a%20b.png');
    expect(relativeLink('C:\\out\\a.html', '\\\\server\\share\\docs\\a.png')).toBe('file://server/share/docs/a.png');
    expect(relativeLink('\\\\server\\share\\out\\a.html', '\\\\server\\share\\docs\\a.png')).toBe('../docs/a.png');
    expect(relativeLink('\\\\server\\one\\a.html', '\\\\server\\two\\a.png')).toBe('file://server/two/a.png');
  });
});

describe('fileUrl', () => {
  it('makes a file URL of a path', () => {
    expect(fileUrl('/home/me/a b.png')).toBe('file:///home/me/a%20b.png');
    expect(fileUrl('C:\\docs\\a.png')).toBe('file:///C:/docs/a.png');
    expect(fileUrl('\\\\server\\share\\a.png')).toBe('file://server/share/a.png');
  });
});

describe('isInside', () => {
  it('is true for the folder and the files below it', () => {
    expect(isInside('/home/me/docs', '/home/me/docs/a.md')).toBe(true);
    expect(isInside('/home/me/docs', '/home/me/docs/api/a.md')).toBe(true);
    expect(isInside('/home/me/docs', '/home/me/docs')).toBe(true);
    expect(isInside('/', '/home/a.md')).toBe(true);
  });

  it('is false elsewhere, also for a folder whose name starts the same', () => {
    expect(isInside('/home/me/docs', '/home/me/a.md')).toBe(false);
    expect(isInside('/home/me/docs', '/home/me/docs2/a.md')).toBe(false);
    expect(isInside('/home/me/Docs', '/home/me/docs/a.md')).toBe(false);
  });

  it('compares the names of Windows without case', () => {
    expect(isInside('C:\\Work\\Docs', 'c:\\work\\docs\\api\\a.md')).toBe(true);
    expect(isInside('C:\\work', 'D:\\work\\a.md')).toBe(false);
    expect(isInside('\\\\server\\share\\docs', '\\\\server\\share\\docs\\a.md')).toBe(true);
    expect(isInside('\\\\server\\one', '\\\\server\\two\\a.md')).toBe(false);
  });
});
