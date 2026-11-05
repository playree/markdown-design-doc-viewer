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
 * - `newer`: as installed by a newer version of the extension (which was then downgraded).
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

/** The hashes of the files of an installed copy: of those of the extension's skill, and of those written there (`SkillInstall.files`). */
export interface InstalledHashes {
  bundle: string;
  recorded: string;
}

/**
 * The status of `install`, whose files hash to `installed` (undefined without any of them), when the skill of the
 * extension (of version `version`) hashes to `bundled`.
 */
export function skillInstallStatus(install: SkillInstall, installed: InstalledHashes | undefined, bundled: string, version: string): SkillInstallStatus {
  if (installed === undefined) {
    return 'missing';
  }
  if (installed.bundle === bundled) {
    return 'current';
  }
  if (installed.recorded !== install.hash) {
    return 'modified';
  }
  if (install.version !== undefined && compareVersions(install.version, version) > 0) {
    return 'newer';
  }
  return install.offered === bundled ? 'offered' : 'outdated';
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
