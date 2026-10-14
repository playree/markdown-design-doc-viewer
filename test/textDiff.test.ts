import { describe, expect, it } from 'vitest';
import { diffWordLists, groupChanges, similarity, splitWords, wordSegmenter } from '../src/textDiff';

describe('splitWords', () => {
  it('splits words, spaces and punctuation', () => {
    expect(splitWords('Hello, world')).toEqual(['Hello', ',', ' ', 'world']);
  });

  it('splits Japanese into words with a segmenter, else into characters', () => {
    const text = 'ログインする';
    expect(splitWords(text).join('')).toBe(text);
    expect(splitWords(text)).toHaveLength(text.length);
    const words = splitWords(text, wordSegmenter('ja'));
    expect(words.join('')).toBe(text);
    expect(words.length).toBeLessThan(text.length);
  });
});

describe('diffWordLists', () => {
  it('lists the words kept, removed and added', () => {
    const changes = diffWordLists(splitWords('a b c'), splitWords('a x c'))!;
    expect(changes.filter((c) => c.type !== 'equal')).toEqual([
      { type: 'removed', tokens: ['b'] },
      { type: 'added', tokens: ['x'] },
    ]);
  });
});

describe('similarity', () => {
  it('is 1 for the same text and lower the more it differs', () => {
    expect(similarity('abc def', 'abc def')).toBe(1);
    const close = similarity('ユーザー情報を取得する', 'ユーザー情報を更新する');
    const far = similarity('ユーザー情報を取得する', '別の段落です');
    expect(close).toBeGreaterThan(0.4);
    expect(far).toBeLessThan(close);
  });
});

describe('groupChanges', () => {
  it('joins the changes apart by spaces into the old words and the new ones', () => {
    const changes = diffWordLists(splitWords('checks are for usability only;'), splitWords('checks only help the user;'))!;
    expect(groupChanges(changes).map((c) => [c.type, c.tokens.join('')])).toEqual([
      ['equal', 'checks '],
      ['removed', 'are for usability only'],
      ['added', 'only help the user'],
      ['equal', ';'],
    ]);
  });
});
