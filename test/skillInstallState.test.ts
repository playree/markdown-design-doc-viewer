import { describe, expect, it } from 'vitest';
import { hashSkill, type SkillInstall, skillInstallStatus, withSkillInstall } from '../src/skillInstallState';

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

  it('does not take the boundary between a path and a content for another one', () => {
    expect(hashSkill(['a', 'b'], files({ a: 'x', b: '' }))).not.toBe(hashSkill(['a', 'b'], files({ a: '', b: 'x' })));
  });
});

describe('skillInstallStatus', () => {
  const install: SkillInstall = { folder: 'file:///home/u/.claude/skills/markdown-design-doc', hash: 'old' };

  it('is missing without the installed files', () => {
    expect(skillInstallStatus(install, undefined, 'new')).toBe('missing');
  });

  it('is current when the installed files are the bundled ones, even if changed since', () => {
    expect(skillInstallStatus(install, 'new', 'new')).toBe('current');
    expect(skillInstallStatus({ ...install, hash: 'new' }, 'new', 'new')).toBe('current');
  });

  it('is outdated when the installed files are as written and the bundled ones differ', () => {
    expect(skillInstallStatus(install, 'old', 'new')).toBe('outdated');
  });

  it('is modified when the installed files were changed', () => {
    expect(skillInstallStatus(install, 'edited', 'new')).toBe('modified');
  });

  it('is declined until the bundled files change again', () => {
    expect(skillInstallStatus({ ...install, declined: 'new' }, 'old', 'new')).toBe('declined');
    expect(skillInstallStatus({ ...install, declined: 'new' }, 'old', 'newer')).toBe('outdated');
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
