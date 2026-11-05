import { createHash } from 'node:crypto';

/** A copy of the Agent Skill installed by the extension's command, as remembered in its global state. */
export interface SkillInstall {
  /** The URI of the skill's folder (…/markdown-design-doc). */
  folder: string;
  /** The hash of the files written there (`hashSkill`). */
  hash: string;
  /** The hash of the extension's skill whose update was declined: not offered again until the extension has another. */
  declined?: string;
}

/**
 * What to do with an installed copy of the skill:
 * - `missing`: its SKILL.md is gone (forget it),
 * - `current`: it is the extension's skill,
 * - `outdated`: it is as installed, and the extension has another (offer to update it),
 * - `modified`: its files were changed since it was installed (leave it to the user, who can install it again),
 * - `declined`: outdated, but its update to the extension's skill was declined.
 */
export type SkillInstallStatus = 'missing' | 'current' | 'outdated' | 'modified' | 'declined';

/**
 * Hashes the files of a skill: those at `paths` (the files of the extension's skill, relative to its folder) in
 * `files`, so that a file the user added to an installed copy does not count, and a missing one does.
 */
export function hashSkill(paths: readonly string[], files: ReadonlyMap<string, Uint8Array>): string {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    const content = files.get(path);
    hash.update(`${path}\0${content === undefined ? '-' : content.length}\0`);
    if (content !== undefined) {
      hash.update(content);
    }
  }
  return hash.digest('hex');
}

/** The status of `install`, whose files hash to `installed` (undefined without its SKILL.md), when the extension's skill hashes to `bundled`. */
export function skillInstallStatus(install: SkillInstall, installed: string | undefined, bundled: string): SkillInstallStatus {
  if (installed === undefined) {
    return 'missing';
  }
  if (installed === bundled) {
    return 'current';
  }
  if (installed !== install.hash) {
    return 'modified';
  }
  return install.declined === bundled ? 'declined' : 'outdated';
}

/** `installs` with `install` in place of the one of the same folder, or added at the end. */
export function withSkillInstall(installs: readonly SkillInstall[], install: SkillInstall): SkillInstall[] {
  const index = installs.findIndex((other) => other.folder === install.folder);
  return index < 0 ? [...installs, install] : installs.map((other, i) => (i === index ? install : other));
}
