/**
 * Raises the revision of the Agent Skill (skill/revision.json) if its files changed since, to commit with the change:
 *
 *   pnpm skill:bump
 *
 * The revision is put in the front matter of its SKILL.md (scripts/skill-files.mjs), so that whoever installs the skill
 * can tell an older copy from a newer one.
 */
import { bumpSkillRevision, REVISION_FILE } from './skill-files.mjs';

const { revision, raised } = bumpSkillRevision();
console.log(raised ? `Raised the revision of the Agent Skill to ${revision} in ${REVISION_FILE}.` : `The Agent Skill is unchanged since its revision ${revision}.`);
