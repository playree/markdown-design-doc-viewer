/** Runs git for the history of a file (extension host; no dependency on vscode). */
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { gitLogArgs, gitShowArgs, parseGitLog, type Revision } from './gitLog';

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
