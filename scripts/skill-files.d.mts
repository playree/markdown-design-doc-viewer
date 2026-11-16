/** The types of scripts/skill-files.mjs, for the tests. */

export const SKILL_NAME: string;
export const REVISION_FILE: string;

export function skillRevision(): { revision: number; hash: string; current: string };
export function skillRevisionProblem(): string | undefined;
export function checkSkillRevision(): void;
export function bumpSkillRevision(): { revision: number; raised: boolean };
export function skillFiles(): { files: Record<string, string>; revision: number };
export function writeSkill(dir: string): Record<string, string>;
