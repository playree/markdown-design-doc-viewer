/**
 * The history of a file in git: the arguments of `git log` and the parsing of its output, shared by the extension
 * (gitCli.ts) and the desktop app. No dependency on vscode or Node.
 */

/** A commit that changed the file. */
export interface Revision {
  hash: string;
  shortHash: string;
  author: string;
  /** Author date, ISO 8601. */
  date: string;
  subject: string;
  /**
   * Path of the file in this commit, from the root of the repository (`git show <hash>:<path>`). It differs from the
   * current one in the commits before the file was renamed.
   */
  path: string;
}

/** The commits listed, the latest first. */
export const MAX_REVISIONS = 200;

const RECORD = '\x1e';
const FIELD = '\x1f';
const END = '\0';

/**
 * The arguments of `git log` listing the commits that changed `fileName` (in the working folder), following its
 * renames, each with the file's path in it (`--name-only`, ended by a NUL with `-z`: never quoted). Not those that
 * deleted it, where it has no content.
 */
export function gitLogArgs(fileName: string): string[] {
  return [
    'log',
    '--follow',
    '-z',
    '--diff-filter=d',
    `-n${MAX_REVISIONS}`,
    '--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s',
    '--name-only',
    '--',
    fileName,
  ];
}

/** The arguments of `git show` writing the content of the file at `path` in the commit `hash`. */
export function gitShowArgs(hash: string, path: string): string[] {
  return ['show', `${hash}:${path}`];
}

/** Parses the output of `git log` with `gitLogArgs`. */
export function parseGitLog(output: string): Revision[] {
  const revisions: Revision[] = [];
  for (const record of output.split(RECORD).slice(1)) {
    // `<header>\0`, then `\n<path>\0` for the file (none for a merge).
    const [header, ...rest] = record.split(END);
    const [hash, shortHash, author, date, subject] = header.split(FIELD);
    if (!hash || subject === undefined) {
      continue;
    }
    const path = rest.map((part) => part.replace(/^\n/, '')).find((part) => part !== '') ?? '';
    revisions.push({ hash, shortHash, author, date, subject, path });
  }
  // A merge lists no file: it has the path of the commit before it (older), or else after it.
  for (let i = revisions.length - 2; i >= 0; i--) {
    revisions[i].path ||= revisions[i + 1].path;
  }
  for (let i = 1; i < revisions.length; i++) {
    revisions[i].path ||= revisions[i - 1].path;
  }
  return revisions.filter((revision) => revision.path !== '');
}
