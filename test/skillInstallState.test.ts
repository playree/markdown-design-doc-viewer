import { describe, expect, it } from 'vitest';
import { hashSkill, type InstalledHashes, type SkillInstall, skillInstallStatus, staleSkillFiles, withSkillInstall } from '../src/skillInstallState';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const PATHS = ['SKILL.md', 'references/cli.md'];

const files = (entries: Record<string, string>): Map<string, Uint8Array> => new Map(Object.entries(entries).map(([path, text]) => [path, bytes(text)]));

describe('hashSkill', () => {
  const skill = files({ 'SKILL.md': 'skill', 'references/cli.md': 'cli' });

  it('does not depend on the order of the paths', () => {
    expect(hashSkill([...PATHS].reverse(), skill)).toBe(hashSkill(PATHS, skill));
  });

  it('changes with the content of a file', () => {
    expect(hashSkill(PATHS, files({ 'SKILL.md': 'skill', 'references/cli.md': 'cli 2' }))).not.toBe(hashSkill(PATHS, skill));
  });

  it('counts a missing file, and does not count a file that is not in the paths', () => {
    expect(hashSkill(PATHS, files({ 'SKILL.md': 'skill' }))).not.toBe(hashSkill(PATHS, skill));
    expect(hashSkill(PATHS, files({ 'SKILL.md': 'skill', 'references/cli.md': 'cli', 'notes.md': 'mine' }))).toBe(hashSkill(PATHS, skill));
  });

  it('takes CRLF line endings as LF', () => {
    expect(hashSkill(PATHS, files({ 'SKILL.md': 'a\r\nb\r\n', 'references/cli.md': 'cli' }))).toBe(hashSkill(PATHS, files({ 'SKILL.md': 'a\nb\n', 'references/cli.md': 'cli' })));
    expect(hashSkill(PATHS, files({ 'SKILL.md': 'a\rb', 'references/cli.md': 'cli' }))).not.toBe(hashSkill(PATHS, files({ 'SKILL.md': 'ab', 'references/cli.md': 'cli' })));
  });

  it('does not take the boundary between a path and a content for another one', () => {
    expect(hashSkill(['a', 'b'], files({ a: 'x', b: '' }))).not.toBe(hashSkill(['a', 'b'], files({ a: '', b: 'x' })));
  });
});

describe('skillInstallStatus', () => {
  const install: SkillInstall = { folder: 'file:///home/u/.claude/skills/markdown-design-doc', hash: 'old' };
  /** Installed files hashing to `bundle` over the files of the extension's skill, and to `recorded` over those written there. */
  const hashes = (bundle: string, recorded = bundle): InstalledHashes => ({ bundle, recorded });

  it('is missing without the installed files', () => {
    expect(skillInstallStatus(install, undefined, 'new')).toBe('missing');
  });

  it('is current when the installed files are the bundled ones, even if changed since', () => {
    expect(skillInstallStatus(install, hashes('new'), 'new')).toBe('current');
    expect(skillInstallStatus({ ...install, hash: 'new' }, hashes('new'), 'new')).toBe('current');
  });

  it('is outdated when the installed files are as written and the bundled ones differ', () => {
    expect(skillInstallStatus(install, hashes('old'), 'new')).toBe('outdated');
  });

  it('is outdated when the skill of the extension has a file the installed one does not', () => {
    expect(skillInstallStatus(install, hashes('old without the new file', 'old'), 'new')).toBe('outdated');
  });

  it('is modified when the installed files were changed', () => {
    expect(skillInstallStatus(install, hashes('edited'), 'new')).toBe('modified');
  });

  it('is offered until the bundled files change again', () => {
    expect(skillInstallStatus({ ...install, offered: 'new' }, hashes('old'), 'new')).toBe('offered');
    expect(skillInstallStatus({ ...install, offered: 'new' }, hashes('old'), 'newer')).toBe('outdated');
  });
});

describe('withSkillInstall', () => {
  const a: SkillInstall = { folder: 'file:///a', hash: '1' };
  const b: SkillInstall = { folder: 'file:///b', hash: '2' };

  it('replaces the install of the same folder', () => {
    expect(withSkillInstall([a, b], { folder: 'file:///a', hash: '3' })).toEqual([{ folder: 'file:///a', hash: '3' }, b]);
  });

  it('adds the install of another folder', () => {
    expect(withSkillInstall([a], b)).toEqual([a, b]);
  });
});

describe('staleSkillFiles', () => {
  const install = (files: string[]): SkillInstall => ({ folder: 'file:///a', hash: '1', files });

  it('lists the files written before that the skill no longer has', () => {
    expect(staleSkillFiles(install(['SKILL.md', 'references/cli.md', 'references/old.md']), PATHS)).toEqual(['references/old.md']);
  });

  it('lists nothing for a folder not installed by the command, or installed before the files were remembered', () => {
    expect(staleSkillFiles(undefined, PATHS)).toEqual([]);
    expect(staleSkillFiles({ folder: 'file:///a', hash: '1' }, PATHS)).toEqual([]);
  });

  it('lists only relative paths inside the folder', () => {
    expect(staleSkillFiles(install(['../x', 'a/../../x', '/etc/x', '\\x', 'C:/x', '.', 'a/./b', '', 'ok.md']), PATHS)).toEqual(['ok.md']);
  });
});
