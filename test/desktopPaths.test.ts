import { describe, expect, it } from 'vitest';
import { basename, dirname, linkTarget, resolveDocumentPath, resourcePath } from '../desktop/paths';

describe('dirname', () => {
  it('takes the folder of a file', () => {
    expect(dirname('/home/me/docs/a.md')).toBe('/home/me/docs');
    expect(dirname('C:\\docs\\a.md')).toBe('C:\\docs');
    expect(dirname('C:/docs/a.md')).toBe('C:/docs');
  });

  it('keeps the root', () => {
    expect(dirname('/a.md')).toBe('/');
    expect(dirname('C:\\a.md')).toBe('C:\\');
  });

  it('takes a backslash as a part of a POSIX file name', () => {
    expect(dirname('/home/me/a\\b.md')).toBe('/home/me');
  });
});

describe('basename', () => {
  it('takes the file name', () => {
    expect(basename('/home/me/docs/a.md')).toBe('a.md');
    expect(basename('C:\\docs\\設計書.md')).toBe('設計書.md');
  });
});

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
