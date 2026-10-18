/** Runs git for the history of a file (extension host; no dependency on vscode). */
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { gitLogArgs, gitObjectName, gitRevisionArgs, gitShowArgs, parseGitLog, parseGitRevision, type Revision } from './gitLog';

/** Why git could not give the history. */
export type GitErrorKind = 'notFound' | 'notRepository' | 'failed';

export class GitError extends Error {
  constructor(
    readonly kind: GitErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** A document of several MB is read in full, and so is its history. */
const MAX_BUFFER = 64 * 1024 * 1024;

function run(git: string, args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(git, args, { cwd, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'buffer' }, (error, stdout, buffer) => {
      const stderr = buffer.toString();
      if (!error) {
        resolve(stdout);
      } else if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new GitError('notFound', error.message));
      } else if (/not a git repository/i.test(stderr)) {
        reject(new GitError('notRepository', stderr.trim()));
      } else {
        reject(new GitError('failed', stderr.trim() || error.message));
      }
    });
  });
}

/** The commits that changed the file, the latest first; empty when it has none (e.g. not committed yet). */
export async function gitLog(git: string, file: string): Promise<Revision[]> {
  return parseGitLog((await run(git, gitLogArgs(path.basename(file)), path.dirname(file))).toString());
}

/** The content of the file in the commit, at its path in that commit: bytes, to be decoded like the document. */
export function gitShow(git: string, file: string, revision: Revision): Promise<Uint8Array> {
  return run(git, gitShowArgs(revision.hash, revision.path), path.dirname(file));
}

/** The commit of `revision` (a commit, a tag or a branch) in the repository of the folder `dir`. */
export async function gitRevision(git: string, dir: string, revision: string): Promise<Omit<Revision, 'path'>> {
  const commit = parseGitRevision((await run(git, gitRevisionArgs(revision), dir)).toString());
  if (!commit) {
    throw new GitError('failed', `Unknown revision: ${revision}`);
  }
  return commit;
}

/**
 * The content of the file in the commit `hash` (from `gitRevision`), at its current path: bytes, to be decoded like
 * the document. undefined when the commit does not have it (e.g. added since).
 */
export async function gitShowAt(git: string, file: string, hash: string): Promise<Uint8Array | undefined> {
  const dir = path.dirname(file);
  const object = gitObjectName(hash, path.basename(file));
  try {
    await run(git, ['cat-file', '-e', object], dir);
  } catch (error) {
    // The commit is known: it does not have the file.
    if (error instanceof GitError && error.kind === 'failed') {
      return undefined;
    }
    throw error;
  }
  return run(git, ['show', object], dir);
}
