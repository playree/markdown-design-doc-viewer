import { describe, expect, it } from 'vitest';
import { DocumentCache, FreshComputations, RetainedFiles } from '../src/extension/documentCache';

describe('DocumentCache', () => {
  it('keeps a value for the version of the document it was computed from', () => {
    const cache = new DocumentCache<string>();
    cache.set('a.md', 1, 'v1');
    expect(cache.get('a.md', 1)).toBe('v1');
    expect(cache.get('a.md', 2)).toBeUndefined();
    cache.set('a.md', 2, 'v2');
    expect(cache.get('a.md', 1)).toBeUndefined();
    expect(cache.get('a.md', 2)).toBe('v2');
  });

  it('drops the values computed from a file that changed', () => {
    const cache = new DocumentCache<string>();
    cache.set('a.md', 1, 'a');
    cache.setDependencies('a.md', 'a', new Set(['login.html', 'style.css']));
    cache.set('b.md', 1, 'b');
    cache.setDependencies('b.md', 'b', new Set(['other.html']));
    expect(cache.dependencies('a.md', 1)).toEqual(new Set(['login.html', 'style.css']));
    cache.invalidate('style.css');
    expect(cache.get('a.md', 1)).toBeUndefined();
    expect(cache.get('b.md', 1)).toBe('b');
  });

  it('keeps a value whose files are not known yet', () => {
    const cache = new DocumentCache<string>();
    cache.set('a.md', 1, 'a');
    cache.invalidate('login.html');
    expect(cache.get('a.md', 1)).toBe('a');
    cache.setDependencies('a.md', 'a', new Set(['login.html']));
    cache.invalidate('login.html');
    expect(cache.get('a.md', 1)).toBeUndefined();
  });

  it('does not change a value kept in place of the one given', () => {
    const cache = new DocumentCache<string>();
    cache.set('a.md', 1, 'old');
    cache.set('a.md', 2, 'new');
    cache.setDependencies('a.md', 'old', new Set(['login.html']));
    expect(cache.dependencies('a.md', 2)).toBeUndefined();
    cache.delete('a.md', 'old');
    expect(cache.get('a.md', 2)).toBe('new');
    cache.delete('a.md');
    expect(cache.get('a.md', 2)).toBeUndefined();
    cache.set('b.md', 1, 'b');
    cache.clear();
    expect(cache.get('b.md', 1)).toBeUndefined();
  });
});

describe('RetainedFiles', () => {
  it('keeps the values of the files held, until they change or are no longer held', () => {
    const files = new RetainedFiles<string>();
    files.set('a.html', 'not held');
    expect(files.get('a.html')).toBeUndefined();
    expect(files.retain(['a.html', 'b.css'])).toEqual(['a.html', 'b.css']);
    expect(files.retain(['a.html'])).toEqual([]);
    files.set('a.html', 'A');
    files.set('b.css', 'B');
    expect(files.get('a.html')).toBe('A');
    files.delete('b.css');
    expect(files.get('b.css')).toBeUndefined();
    expect(files.release(['a.html', 'b.css'])).toEqual(['b.css']);
    expect(files.isRetained('b.css')).toBe(false);
    expect(files.get('a.html')).toBe('A');
    expect(files.release(['a.html'])).toEqual(['a.html']);
    expect(files.get('a.html')).toBeUndefined();
    // Not held: nothing to stop following.
    expect(files.release(['a.html'])).toEqual([]);
  });
});

describe('FreshComputations', () => {
  const result = (n: number, ...files: string[]) => ({ n, dependencies: new Set(files) });

  it('computes again when a file it used changed meanwhile', async () => {
    const computations = new FreshComputations();
    let n = 0;
    const value = await computations.run(async () => {
      n++;
      if (n === 1) {
        computations.changed('login.html');
      }
      return result(n, 'login.html');
    }, (r) => r.dependencies);
    expect(value.n).toBe(2);
  });

  it('does not compute again for the other files, nor after the computation', async () => {
    const computations = new FreshComputations();
    let n = 0;
    const value = await computations.run(async () => {
      computations.changed('other.html');
      return result(++n, 'login.html');
    }, (r) => r.dependencies);
    expect(value.n).toBe(1);
    computations.changed('login.html');
    expect(n).toBe(1);
  });

  it('gives up after the attempts', async () => {
    const computations = new FreshComputations();
    let n = 0;
    const value = await computations.run(async () => {
      computations.changed('login.html');
      return result(++n, 'login.html');
    }, (r) => r.dependencies, 2);
    expect(value.n).toBe(2);
  });
});
