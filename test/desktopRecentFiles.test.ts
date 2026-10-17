import { describe, expect, it } from 'vitest';
import { addRecentFile, MAX_RECENT_FILES, menuText, parseRecentFiles, removeRecentFile } from '../desktop/recentFiles';

describe('parseRecentFiles', () => {
  it('reads the paths saved', () => {
    expect(parseRecentFiles(JSON.stringify(['/a.md', 'C:\\docs\\b.md']))).toEqual(['/a.md', 'C:\\docs\\b.md']);
  });

  it('gives an empty list for nothing saved or a broken value', () => {
    expect(parseRecentFiles(null)).toEqual([]);
    expect(parseRecentFiles('')).toEqual([]);
    expect(parseRecentFiles('{')).toEqual([]);
    expect(parseRecentFiles('{"a":1}')).toEqual([]);
  });

  it('drops what is not a path, the duplicates and the files beyond the limit', () => {
    expect(parseRecentFiles(JSON.stringify(['/a.md', 1, null, '', '/a.md', '/b.md']))).toEqual(['/a.md', '/b.md']);
    const many = Array.from({ length: MAX_RECENT_FILES + 5 }, (_, i) => `/${i}.md`);
    expect(parseRecentFiles(JSON.stringify(many))).toEqual(many.slice(0, MAX_RECENT_FILES));
  });
});

describe('addRecentFile', () => {
  it('puts the file first, once', () => {
    expect(addRecentFile([], '/a.md')).toEqual(['/a.md']);
    expect(addRecentFile(['/a.md', '/b.md', '/c.md'], '/c.md')).toEqual(['/c.md', '/a.md', '/b.md']);
  });

  it('keeps the last files opened only', () => {
    let list: string[] = [];
    for (let i = 0; i <= MAX_RECENT_FILES; i++) {
      list = addRecentFile(list, `/${i}.md`);
    }
    expect(list).toHaveLength(MAX_RECENT_FILES);
    expect(list[0]).toBe(`/${MAX_RECENT_FILES}.md`);
    expect(list).not.toContain('/0.md');
  });
});

describe('removeRecentFile', () => {
  it('removes the file', () => {
    expect(removeRecentFile(['/a.md', '/b.md'], '/a.md')).toEqual(['/b.md']);
    expect(removeRecentFile(['/a.md'], '/x.md')).toEqual(['/a.md']);
  });
});

describe('menuText', () => {
  it('doubles the ampersands, so that they are not access keys', () => {
    expect(menuText('/docs/R&D/a.md')).toBe('/docs/R&&D/a.md');
    expect(menuText('/docs/a.md')).toBe('/docs/a.md');
  });
});
