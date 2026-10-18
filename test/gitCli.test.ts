import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitError, gitFilesAt, gitRevision, gitShowAt } from '../src/gitCli';

// Runs git (the command line's --diff-base), in a repository made without the user's settings (e.g. signed commits).
describe('the revision of --diff-base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdai-git-'));
  const docs = join(dir, 'docs');
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd: dir,
      stdio: 'ignore',
      env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' },
    });
  };
  beforeAll(() => {
    git('init', '-q');
    mkdirSync(docs);
    writeFileSync(join(docs, 'a.md'), '# Old\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'First version');
    git('tag', 'v1.0');
    writeFileSync(join(docs, 'a.md'), '# New\n');
    writeFileSync(join(docs, 'b.md'), '# Added\n');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('finds the commit of a tag', async () => {
    const commit = await gitRevision('git', docs, 'v1.0');
    expect(commit.subject).toBe('First version');
    expect(commit.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('lists the files of a folder in that commit, and reads them from it', async () => {
    const { hash } = await gitRevision('git', docs, 'v1.0');
    expect([...(await gitFilesAt('git', docs, hash))]).toEqual(['a.md']);
    expect(new TextDecoder().decode(await gitShowAt('git', join(docs, 'a.md'), hash))).toBe('# Old\n');
  });

  it('fails for an unknown revision', async () => {
    await expect(gitRevision('git', dir, 'v9.9')).rejects.toBeInstanceOf(GitError);
  });
});
