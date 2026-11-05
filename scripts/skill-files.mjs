/**
 * The files of the Agent Skill for AI assistants, written by scripts/skill-package.mjs (the zip attached to each release)
 * and by esbuild.mjs (dist/skill/, in the extension for Copilot's `chatSkills` and for its command that installs the skill).
 *
 * The skill is not written twice: its SKILL.md is skill/SKILL.md with the authoring guide for AI (docs/ai-authoring-guide.md)
 * put in place of its `<!-- include: … -->` line, and its reference of the command line is docs/cli.md.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The name of the skill, which is also the name of its folder. */
export const SKILL_NAME = 'markdown-design-doc';

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
  const fields = Object.fromEntries(frontMatter.split('\n').map((line) => /^(\w+): (.*)$/.exec(line)?.slice(1) ?? [line, undefined]));
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
  const unknown = Object.keys(fields).filter((key) => !['name', 'description'].includes(key));
  if (unknown.length > 0) {
    throw new Error(`skill/SKILL.md: unexpected lines in the front matter: ${unknown.join(', ')}`);
  }
  if (text.includes('<!-- include:')) {
    throw new Error('skill/SKILL.md: an include was not replaced');
  }
}

/** The files of the skill, relative to its folder, with their contents. Throws if SKILL.md breaks the rules of Agent Skills. */
export function skillFiles() {
  /** The command line's README without the badges, the screenshot and the link to its other language, which are of no use to an AI. */
  const cli = strip(read('docs/cli.md'), [/^\[!\[/, /^!\[/, /^English \| \[/]).replace(/\n{3,}/g, '\n\n');
  const skill = read('skill/SKILL.md').replace(/^<!-- include: (\S+) -->$/gm, (_, file) => guide(file));
  check(skill);
  return { 'SKILL.md': skill, 'references/cli.md': cli };
}

/** Writes the skill to `dir`/markdown-design-doc/ (emptied first), and returns the files written. */
export function writeSkill(dir) {
  const files = skillFiles();
  const folder = join(dir, SKILL_NAME);
  rmSync(folder, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return files;
}
