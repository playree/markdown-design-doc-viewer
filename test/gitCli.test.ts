import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitError, gitRevision, gitShowAt } from '../src/gitCli';

describe('the revision of --diff-base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdai-git-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: dir, stdio: 'ignore' });
  };
  git('init', '-q');
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/a.md'), '# Old\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'First version');
  git('tag', 'v1.0');
  writeFileSync(join(dir, 'docs/a.md'), '# New\n');
  writeFileSync(join(dir, 'docs/b.md'), '# Added\n');

  it('finds the commit of a tag', async () => {
    const commit = await gitRevision('git', join(dir, 'docs'), 'v1.0');
    expect(commit.subject).toBe('First version');
    expect(commit.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reads a document in that commit, from its folder, or nothing when it did not have it', async () => {
    const { hash } = await gitRevision('git', join(dir, 'docs'), 'v1.0');
    expect(new TextDecoder().decode(await gitShowAt('git', join(dir, 'docs/a.md'), hash))).toBe('# Old\n');
    expect(await gitShowAt('git', join(dir, 'docs/b.md'), hash)).toBeUndefined();
  });

  it('fails for an unknown revision', async () => {
    await expect(gitRevision('git', dir, 'v9.9')).rejects.toBeInstanceOf(GitError);
  });
});
