/**
 * Prepares the Agent Skill for AI assistants in .work/skill: the folder markdown-design-doc/ (to copy into
 * `.claude/skills/` and the like) and markdown-design-doc-skill.zip of it (to upload to claude.ai, or to attach to a release):
 *
 *   pnpm skill:package
 *
 * Its files are made by scripts/skill-files.mjs, which the build (esbuild.mjs) also uses to put the skill in the extension.
 */
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';
import { SKILL_NAME, writeSkill } from './skill-files.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.work/skill');
const ZIP = 'markdown-design-doc-skill.zip';

/** The date of the files in the zip, fixed (and written only as a DOS date, without a time zone) so that the same files make the same zip. */
const MTIME = new Date(2000, 0, 1);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const files = writeSkill(OUT);
const zip = new yazl.ZipFile();
const output = createWriteStream(join(OUT, ZIP));
zip.addEmptyDirectory(`${SKILL_NAME}/`, { mtime: MTIME, forceDosTimestamp: true });
for (const [path, content] of Object.entries(files)) {
  zip.addBuffer(Buffer.from(content), `${SKILL_NAME}/${path}`, { mtime: MTIME, forceDosTimestamp: true, mode: 0o100644 });
}
zip.outputStream.pipe(output);
zip.end();
await finished(output);
console.log(`Agent Skill ${SKILL_NAME} prepared in ${join(OUT, SKILL_NAME)} and ${join(OUT, ZIP)}`);
