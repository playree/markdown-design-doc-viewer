/**
 * The caches of the extension host shared by the preview and the diagnostics (documentFiles.ts), without
 * the editor, so that they are tested on their own.
 */

interface Entry<T> {
  version: number;
  value: T;
  /** The files it was computed from, by their URI: undefined until they are known (`setDependencies`). */
  dependencies?: ReadonlySet<string>;
}

/**
 * Values computed from documents, by their key (URI) and version, until the document changes or one of the files they
 * were computed from does (`invalidate`). A value whose files are not known yet (a computation under way) is kept: it is
 * to be computed from the files as they are once it is known (`FreshComputations`).
 */
export class DocumentCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  /** The value kept for the document at `version`, if any. */
  get(key: string, version: number): T | undefined {
    const entry = this.entries.get(key);
    return entry?.version === version ? entry.value : undefined;
  }

  /** The files the value kept for the document at `version` was computed from: undefined when they are not known yet. */
  dependencies(key: string, version: number): ReadonlySet<string> | undefined {
    const entry = this.entries.get(key);
    return entry?.version === version ? entry.dependencies : undefined;
  }

  /** Keeps the value of the document at `version`, in place of that of another version. */
  set(key: string, version: number, value: T): void {
    this.entries.set(key, { version, value });
  }

  /** Sets the files `value` was computed from, unless another value was kept for its document meanwhile. */
  setDependencies(key: string, value: T, dependencies: ReadonlySet<string>): void {
    const entry = this.entries.get(key);
    if (entry?.value === value) {
      entry.dependencies = dependencies;
    }
  }

  /** Drops the value of the document (`value` only: not another one kept meanwhile). */
  delete(key: string, value?: T): void {
    if (value === undefined || this.entries.get(key)?.value === value) {
      this.entries.delete(key);
    }
  }

  /** Drops all the values. */
  clear(): void {
    this.entries.clear();
  }

  /** Drops the values computed from `file`. */
  invalidate(file: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.dependencies?.has(file)) {
        this.entries.delete(key);
      }
    }
  }
}

/**
 * Computations from files that are done again when one of the files they used changed while they were under way, so
 * that their result is not that of a file before its change (which may have been told before the result is known).
 */
export class FreshComputations {
  /** The files changed during each computation under way. */
  private readonly underWay = new Set<Set<string>>();

  /** Notes a change of `file` for the computations under way. */
  changed(file: string): void {
    this.underWay.forEach((changed) => changed.add(file));
  }

  /**
   * `compute()`, done again while one of the files it used (`dependencies` of its result) changed meanwhile, at most
   * `attempts` times. The last result is then returned with those files (`stale`), whose changes it may miss: to be
   * computed again.
   */
  async run<T>(compute: () => Promise<T>, dependencies: (value: T) => ReadonlySet<string>, attempts = 3): Promise<{ value: T; stale: string[] }> {
    for (let attempt = 1; ; attempt++) {
      const changed = new Set<string>();
      this.underWay.add(changed);
      let value: T;
      try {
        value = await compute();
      } finally {
        this.underWay.delete(changed);
      }
      const used = dependencies(value);
      const stale = [...changed].filter((file) => used.has(file));
      if (stale.length === 0 || attempt >= attempts) {
        return { value, stale };
      }
    }
  }
}

/**
 * Values of files (their text), kept only while something holds the files (`retain`): their changes are followed
 * meanwhile, which drop them (`delete`).
 */
export class RetainedFiles<T> {
  private readonly holders = new Map<string, number>();
  private readonly values = new Map<string, T>();

  /** Holds each of `files` once more. Returns those that were not held: their changes are to be followed from now on. */
  retain(files: Iterable<string>): string[] {
    const added: string[] = [];
    for (const file of files) {
      const count = this.holders.get(file) ?? 0;
      this.holders.set(file, count + 1);
      if (count === 0) {
        added.push(file);
      }
    }
    return added;
  }

  /** Holds each of `files` once less. Returns those no longer held, whose values are dropped: their changes are not to be followed any longer. */
  release(files: Iterable<string>): string[] {
    const removed: string[] = [];
    for (const file of files) {
      const count = this.holders.get(file) ?? 0;
      if (count <= 1) {
        this.holders.delete(file);
        this.values.delete(file);
        if (count === 1) {
          removed.push(file);
        }
      } else {
        this.holders.set(file, count - 1);
      }
    }
    return removed;
  }

  isRetained(file: string): boolean {
    return this.holders.has(file);
  }

  get(file: string): T | undefined {
    return this.values.get(file);
  }

  /** Keeps the value of a file that is held: not of the others, whose changes are not followed. */
  set(file: string, value: T): void {
    if (this.holders.has(file)) {
      this.values.set(file, value);
    }
  }

  /** Drops the value of a file (it changed). */
  delete(file: string): void {
    this.values.delete(file);
  }
}
