/**
 * Prepares the Agent Skill for AI assistants in .work/skill: the folder markdown-design-doc/ (to copy into
 * `.claude/skills/` and the like) and markdown-design-doc-skill.zip of it (to upload to claude.ai, or to attach to a release):
 *
 *   pnpm skill:package
 *
 * The skill is not written twice: its SKILL.md is skill/SKILL.md with the authoring guide for AI (docs/ai-authoring-guide.md)
 * put in place of its `<!-- include: … -->` line, and its reference of the command line is docs/cli.md.
 */
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.work/skill');
const NAME = 'markdown-design-doc';
const ZIP = 'markdown-design-doc-skill.zip';

/** The date of the files in the zip, fixed (and written only as a DOS date, without a time zone) so that the same files make the same zip. */
const MTIME = new Date(2000, 0, 1);

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

/** The command line's README without the badges, the screenshot and the link to its other language, which are of no use to an AI. */
const cli = strip(read('docs/cli.md'), [/^\[!\[/, /^!\[/, /^English \| \[/]).replace(/\n{3,}/g, '\n\n');

const skill = read('skill/SKILL.md').replace(/^<!-- include: (\S+) -->$/gm, (_, file) => guide(file));

/** Checks the front matter of SKILL.md against the rules of Agent Skills, as the tools loading it would. */
function check(text) {
  const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1];
  if (frontMatter === undefined) {
    throw new Error('skill/SKILL.md: no front matter');
  }
  const fields = Object.fromEntries(frontMatter.split('\n').map((line) => /^(\w+): (.*)$/.exec(line)?.slice(1) ?? [line, undefined]));
  const { name, description } = fields;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? '') || name.length > 64 || name !== NAME) {
    throw new Error(`skill/SKILL.md: name must be "${NAME}" (lowercase letters, digits and hyphens, up to 64 characters)`);
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

check(skill);

/** The files of the skill, relative to its folder. */
const files = { 'SKILL.md': skill, 'references/cli.md': cli };

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const zip = new yazl.ZipFile();
const output = createWriteStream(join(OUT, ZIP));
zip.addEmptyDirectory(`${NAME}/`, { mtime: MTIME, forceDosTimestamp: true });
for (const [path, content] of Object.entries(files)) {
  const target = join(OUT, NAME, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  zip.addBuffer(Buffer.from(content), `${NAME}/${path}`, { mtime: MTIME, forceDosTimestamp: true, mode: 0o100644 });
}
zip.outputStream.pipe(output);
zip.end();
await finished(output);
console.log(`Agent Skill ${NAME} prepared in ${join(OUT, NAME)} and ${join(OUT, ZIP)}`);
