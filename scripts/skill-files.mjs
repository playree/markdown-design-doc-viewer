/**
 * The files of the Agent Skill for AI assistants, written by scripts/skill-package.mjs (the zip attached to each release)
 * and by esbuild.mjs (dist/skill/, in the extension for Copilot's `chatSkills` and for its command that installs the skill).
 *
 * The skill is not written twice: its SKILL.md is skill/SKILL.md with the authoring guide for AI (docs/ai-authoring-guide.md)
 * put in place of its `<!-- include: … -->` line, and its reference of the command line is docs/cli.md.
 *
 * Its front matter has the revision of skill/revision.json (`metadata.revision`), a number raised each time its files
 * change (`pnpm skill:bump`), so that whoever installs it (the extension, the zip, the npm package of the embeddable
 * viewer) can tell an older copy from a newer one. The file also has the hash of the files of that revision: when they
 * no longer hash to it, the revision was not raised (`checkSkillRevision`).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The name of the skill, which is also the name of its folder. */
export const SKILL_NAME = 'markdown-design-doc';

/** The file with the revision of the skill and the hash of its files (without the revision). */
export const REVISION_FILE = 'skill/revision.json';

/** Reads a file of the repository, with LF line endings whatever the checkout has. */
const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

/** Removes the lines of `text` matching one of `patterns`, and the blank lines left at its start. */
function strip(text, patterns) {
  return text
    .split('\n')
    .filter((line) => !patterns.some((pattern) => pattern.test(line)))
    .join('\n')
    .replace(/^\n+/, '');
}

/** The guide without its title (its first line) and the link to its other language: SKILL.md has its own title. */
function guide(file) {
  return strip(read(file).replace(/^# .*\n/, ''), [/^English \| \[/]).trimEnd();
}

/** Checks the front matter of SKILL.md against the rules of Agent Skills, as the tools loading it would. */
function check(text) {
  const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1];
  if (frontMatter === undefined) {
    throw new Error('skill/SKILL.md: no front matter');
  }
  // The metadata (a map of strings in Agent Skills) has only the revision.
  const lines = frontMatter.replace(/^metadata:\n {2}revision: "[1-9]\d*"$/m, 'metadata: -').split('\n');
  const fields = Object.fromEntries(lines.map((line) => /^(\w+): (.*)$/.exec(line)?.slice(1) ?? [line, undefined]));
  const { name, description } = fields;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? '') || name.length > 64 || name !== SKILL_NAME) {
    throw new Error(`skill/SKILL.md: name must be "${SKILL_NAME}" (lowercase letters, digits and hyphens, up to 64 characters)`);
  }
  if (!description || description.length > 1024) {
    throw new Error(`skill/SKILL.md: description must be on one line, up to 1024 characters (${description?.length ?? 0})`);
  }
  // Written as a plain YAML scalar, it must not hold what YAML would parse in it, nor the angle brackets claude.ai rejects.
  if (/: | #|[<>]|^[-?:,[\]{}&*!|'"%@`]/.test(description)) {
    throw new Error('skill/SKILL.md: description must not contain ": ", " #", "<" or ">", nor start with a YAML indicator');
  }
  if (fields.metadata !== '-') {
    throw new Error('skill/SKILL.md: the front matter must end with the metadata of the revision');
  }
  const unknown = Object.keys(fields).filter((key) => !['name', 'description', 'metadata'].includes(key));
  if (unknown.length > 0) {
    throw new Error(`skill/SKILL.md: unexpected lines in the front matter: ${unknown.join(', ')}`);
  }
  if (text.includes('<!-- include:')) {
    throw new Error('skill/SKILL.md: an include was not replaced');
  }
}

/** The files of the skill without its revision, relative to its folder, with their contents. */
function unrevisedSkillFiles() {
  /** The command line's README without the badges, the screenshot and the link to its other language, which are of no use to an AI. */
  const cli = strip(read('docs/cli.md'), [/^\[!\[/, /^!\[/, /^English \| \[/]).replace(/\n{3,}/g, '\n\n');
  const skill = read('skill/SKILL.md').replace(/^<!-- include: (\S+) -->$/gm, (_, file) => guide(file));
  return { 'SKILL.md': skill, 'references/cli.md': cli };
}

/** The hash of the files of the skill (without its revision): of their paths, in order, and contents. */
function hashFiles(files) {
  const hash = createHash('sha256');
  for (const path of Object.keys(files).sort()) {
    const content = Buffer.from(files[path]);
    hash.update(`${path}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}

/** The revision of the skill and the hash recorded with it (skill/revision.json), and the hash of its files now. */
export function skillRevision() {
  const recorded = JSON.parse(read(REVISION_FILE));
  if (!Number.isInteger(recorded.revision) || recorded.revision < 1 || typeof recorded.hash !== 'string') {
    throw new Error(`${REVISION_FILE}: must have a revision (an integer from 1) and a hash`);
  }
  return { revision: recorded.revision, hash: recorded.hash, current: hashFiles(unrevisedSkillFiles()) };
}

/** The message telling that the files of the skill changed without its revision being raised, or undefined if it was. */
export function skillRevisionProblem() {
  const { revision, hash, current } = skillRevision();
  return hash === current
    ? undefined
    : `The files of the Agent Skill changed since its revision ${revision} (${REVISION_FILE}): run \`pnpm skill:bump\` to raise it.`;
}

/** Throws if the files of the skill changed without its revision being raised (`skillRevisionProblem`). */
export function checkSkillRevision() {
  const problem = skillRevisionProblem();
  if (problem) {
    throw new Error(problem);
  }
}

/** Raises the revision of the skill if its files changed since (skill/revision.json), and returns it. */
export function bumpSkillRevision() {
  const { revision, hash, current } = skillRevision();
  if (hash === current) {
    return { revision, raised: false };
  }
  writeFileSync(join(ROOT, REVISION_FILE), `${JSON.stringify({ revision: revision + 1, hash: current }, null, 2)}\n`);
  return { revision: revision + 1, raised: true };
}

/**
 * The files of the skill, relative to its folder, with their contents, and its revision (put in the front matter of its
 * SKILL.md). Throws if SKILL.md breaks the rules of Agent Skills.
 */
export function skillFiles() {
  const files = unrevisedSkillFiles();
  const { revision } = skillRevision();
  const skill = files['SKILL.md'].replace(/^(---\n[\s\S]*?\n)---\n/, (_, frontMatter) => `${frontMatter}metadata:\n  revision: "${revision}"\n---\n`);
  check(skill);
  return { files: { ...files, 'SKILL.md': skill }, revision };
}

/** Writes the skill to `dir`/markdown-design-doc/ (emptied first), and returns the files written. */
export function writeSkill(dir) {
  const { files } = skillFiles();
  const folder = join(dir, SKILL_NAME);
  rmSync(folder, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return files;
}
