import { describe, expect, it } from 'vitest';
import { foldersOf, sortFolder, type FolderNode } from '../desktop/folderTree';

const file = (dir: string, name: string) => ({ path: `${dir}/${name}`, name });

const tree: FolderNode = {
  path: '/docs',
  name: 'docs',
  folders: [
    {
      path: '/docs/b',
      name: 'b',
      folders: [{ path: '/docs/b/c', name: 'c', folders: [], files: [file('/docs/b/c', 'deep.md')] }],
      files: [file('/docs/b', 'x.md')],
    },
    { path: '/docs/A', name: 'A', folders: [], files: [file('/docs/A', 'y.md')] },
  ],
  files: [file('/docs', '10-logout.md'), file('/docs', 'README.md'), file('/docs', '2-login.md'), file('/docs', 'api.md')],
};

describe('sortFolder', () => {
  it('sorts the names ignoring the case, with the numbers by value', () => {
    const sorted = sortFolder(tree, 'en');
    expect(sorted.files.map((f) => f.name)).toEqual(['2-login.md', '10-logout.md', 'api.md', 'README.md']);
    expect(sorted.folders.map((f) => f.name)).toEqual(['A', 'b']);
  });

  it('sorts the subfolders too, without changing the given folder', () => {
    const sorted = sortFolder(tree, 'en');
    expect(sorted.folders[1].folders[0].files[0].name).toBe('deep.md');
    expect(tree.files[0].name).toBe('10-logout.md');
  });
});

describe('foldersOf', () => {
  it('lists the folders a file is in, from the top', () => {
    expect(foldersOf(tree, '/docs/b/c/deep.md')).toEqual(['/docs/b', '/docs/b/c']);
    expect(foldersOf(tree, '/docs/A/y.md')).toEqual(['/docs/A']);
  });

  it('is empty for a file of the folder itself, or not in it', () => {
    expect(foldersOf(tree, '/docs/api.md')).toEqual([]);
    expect(foldersOf(tree, '/other/a.md')).toEqual([]);
  });
});
