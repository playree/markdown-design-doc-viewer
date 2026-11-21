import { describe, expect, it } from 'vitest';
import { DocumentCache, RetainedFiles } from '../src/extension/documentCache';

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

  it('drops a value whose files are known after one of them changed', () => {
    const cache = new DocumentCache<string>();
    cache.set('a.md', 1, 'a');
    cache.set('b.md', 1, 'b');
    cache.invalidate('login.html');
    expect(cache.get('a.md', 1)).toBe('a');
    cache.setDependencies('a.md', 'a', new Set(['login.html']));
    cache.setDependencies('b.md', 'b', new Set(['other.html']));
    expect(cache.get('a.md', 1)).toBeUndefined();
    expect(cache.get('b.md', 1)).toBe('b');
    // The changes before are forgotten once the files are known.
    cache.invalidate('login.html');
    expect(cache.get('b.md', 1)).toBe('b');
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
