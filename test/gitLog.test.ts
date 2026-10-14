import { describe, expect, it } from 'vitest';
import { gitLogArgs, gitShowArgs, parseGitLog } from '../src/gitLog';

const record = (hash: string, subject: string, path?: string): string =>
  `\x1e${hash}\x1f${hash.slice(0, 7)}\x1fAuthor\x1f2026-10-01T12:00:00+09:00\x1f${subject}\n` + (path === undefined ? '' : `\n${path}\n`);

describe('parseGitLog', () => {
  it('reads the commits with the path of the file in each', () => {
    const output = record('a'.repeat(40), '設計書を更新', 'docs/login.md') + record('b'.repeat(40), 'Rename', 'docs/old-login.md');
    expect(parseGitLog(output)).toEqual([
      { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Author', date: '2026-10-01T12:00:00+09:00', subject: '設計書を更新', path: 'docs/login.md' },
      { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', author: 'Author', date: '2026-10-01T12:00:00+09:00', subject: 'Rename', path: 'docs/old-login.md' },
    ]);
  });

  it('keeps separators of other kinds in the subject', () => {
    expect(parseGitLog(record('c'.repeat(40), 'fix: a | b; "c"', 'a.md'))[0].subject).toBe('fix: a | b; "c"');
  });

  it('gives a commit without a file (a merge) the path of the one before it', () => {
    const output = record('a'.repeat(40), 'Merge', undefined) + record('b'.repeat(40), 'Edit', 'a.md');
    expect(parseGitLog(output).map((r) => r.path)).toEqual(['a.md', 'a.md']);
  });

  it('is empty without commits', () => {
    expect(parseGitLog('')).toEqual([]);
  });
});

describe('git arguments', () => {
  it('follows the renames of the file, which comes after --', () => {
    const args = gitLogArgs('-x.md');
    expect(args).toContain('--follow');
    expect(args.slice(-2)).toEqual(['--', '-x.md']);
  });

  it('shows the file at its path in the commit', () => {
    expect(gitShowArgs('abc', 'docs/a.md')).toEqual(['show', 'abc:docs/a.md']);
  });
});
