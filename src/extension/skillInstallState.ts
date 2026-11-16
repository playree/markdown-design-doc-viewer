import { createHash } from 'node:crypto';

/** A copy of the Agent Skill installed by the extension's command, as remembered in its global state. */
export interface SkillInstall {
  /** The URI of the skill's folder (…/markdown-design-doc). */
  folder: string;
  /** The hash of the files written there (`hashSkill`). */
  hash: string;
  /** The version of the extension that wrote them: a copy written by a newer one is not offered to be replaced by an older skill. */
  version?: string;
  /** The paths of the files written there, relative to the folder: those the next version no longer has are removed by its update. */
  files?: string[];
  /** The URI of the workspace folder the copy is in (its `.claude/skills`): its update is offered only in a window with that folder. */
  workspaceFolder?: string;
  /** The hash of the extension's skill whose update was offered: not offered again until the extension has another. */
  offered?: string;
}

/**
 * What to do with an installed copy of the skill:
 * - `missing`: its files are gone (forget it),
 * - `current`: it is the extension's skill,
 * - `outdated`: it is as installed, and the extension has another (offer to update it),
 * - `modified`: its files were changed since it was installed (leave it to the user, who can install it again),
 * - `offered`: outdated, but its update to the extension's skill was already offered,
 * - `newer`: of a later revision (replaced since with a newer skill), or as installed by a newer version of the extension
 *   (which was then downgraded).
 */
export type SkillInstallStatus = 'missing' | 'current' | 'outdated' | 'modified' | 'offered' | 'newer';

/**
 * Hashes the files of a skill: those at `paths` (the files of the extension's skill, relative to its folder) in
 * `files`, so that a file the user added to an installed copy does not count, and a missing one does. CRLF line endings
 * count as LF, as Git may check the copy of a project out with either.
 */
export function hashSkill(paths: readonly string[], files: ReadonlyMap<string, Uint8Array>): string {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    const content = files.get(path);
    const normalized = content && content.filter((byte, i) => !(byte === 0x0d && content[i + 1] === 0x0a));
    hash.update(`${path}\0${normalized === undefined ? '-' : normalized.length}\0`);
    if (normalized !== undefined) {
      hash.update(normalized);
    }
  }
  return hash.digest('hex');
}

/**
 * The hashes of the files of an installed copy: of those of the extension's skill, and of those written there
 * (`SkillInstall.files`); and the revision of its SKILL.md (`skillRevision`).
 */
export interface InstalledHashes {
  bundle: string;
  recorded: string;
  revision: number;
}

/** The extension's skill: the hash of its files, and its revision. */
export interface BundledSkill {
  hash: string;
  revision: number;
}

/**
 * The revision of a skill in the front matter of its SKILL.md (`metadata.revision`, raised each time its files change,
 * by scripts/skill-files.mjs), or 0 without one (a copy made before skills had a revision).
 */
export function skillRevision(skillMd: string): number {
  const frontMatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(skillMd)?.[1];
  // Its indented lines, and the blank lines between them.
  const metadata = frontMatter && /^metadata:[ \t]*\r?\n((?:[ \t]*\r?\n|[ \t]+.*(?:\r?\n|$))*)/m.exec(frontMatter)?.[1];
  // A key of the metadata itself, indented as its first one, not of a map in it.
  const indent = metadata && /^([ \t]+)\S/m.exec(metadata)?.[1];
  const revision = indent && new RegExp(`^${indent}revision:[ \\t]*(["']?)(\\d+)\\1[ \\t]*\\r?$`, 'm').exec(metadata)?.[2];
  return revision ? Number(revision) : 0;
}

/**
 * The status of `install`, whose files hash to `installed` (undefined without any of them), when the skill of the
 * extension (of version `version`) is `bundled`.
 */
export function skillInstallStatus(install: SkillInstall, installed: InstalledHashes | undefined, bundled: BundledSkill, version: string): SkillInstallStatus {
  if (installed === undefined) {
    return 'missing';
  }
  if (installed.bundle === bundled.hash) {
    return 'current';
  }
  // Replaced since with a newer skill, as from the zip of a later release.
  if (installed.revision > bundled.revision) {
    return 'newer';
  }
  if (installed.recorded !== install.hash) {
    return 'modified';
  }
  if (install.version !== undefined && compareVersions(install.version, version) > 0) {
    return 'newer';
  }
  return install.offered === bundled.hash ? 'offered' : 'outdated';
}

/**
 * What to do with a copy of the skill that the extension did not install (unzipped from a release, or written by
 * another tool) found in a skills folder, by its revision (`installed`):
 * - `current`: the revision of the extension's skill (`bundled`),
 * - `newer`: a later one,
 * - `outdated`: an earlier one (offer to update it),
 * - `offered`: an earlier one, whose update to the extension's skill was already offered (`offered`, the revision then offered).
 */
export function unrecordedSkillStatus(installed: number, bundled: number, offered: number | undefined): 'current' | 'newer' | 'outdated' | 'offered' {
  if (installed === bundled) {
    return 'current';
  }
  if (installed > bundled) {
    return 'newer';
  }
  return offered === bundled ? 'offered' : 'outdated';
}

/** Compares the versions `a` and `b` (`1.4.0`, `1.5.0-rc.1`) by their numbers: negative if `a` is older, positive if newer. */
export function compareVersions(a: string, b: string): number {
  const numbers = (version: string) => (/^(\d+)\.(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number);
  const [x, y] = [numbers(a), numbers(b)];
  for (let i = 0; i < 3; i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * The files a previous version wrote into a copy (`install.files`) that the extension's skill (`paths`) no longer has.
 * Only relative paths inside the copy's folder, whatever the global state holds.
 */
export function staleSkillFiles(install: SkillInstall | undefined, paths: readonly string[]): string[] {
  const inside = (path: string) => path !== '' && !/^[\\/]|^[a-z]:|(^|[\\/])\.\.?([\\/]|$)/i.test(path);
  return (install?.files ?? []).filter((path) => typeof path === 'string' && inside(path) && !paths.includes(path));
}
