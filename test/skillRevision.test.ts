import { describe, expect, it } from 'vitest';
import { skillFiles, skillRevision, skillRevisionProblem } from '../scripts/skill-files.mjs';
import { skillRevision as revisionOf } from '../src/extension/skillInstallState';

describe('the revision of the Agent Skill', () => {
  it('was raised when its files changed (run `pnpm skill:bump`)', () => {
    expect(skillRevisionProblem()).toBeUndefined();
  });

  it('is in the front matter of its SKILL.md, as the extension reads it', () => {
    const { files, revision } = skillFiles();
    expect(revision).toBe(skillRevision().revision);
    expect(revisionOf(files['SKILL.md'])).toBe(revision);
  });
});
