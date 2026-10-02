import { describe, expect, it } from 'vitest';
import {
  SPELL_SUGGESTION_LIMIT,
  SPELL_WORD_MAX,
  buildSpellDictionary,
  isSpellMisspelled,
  suggestSpellCorrections,
  tokenizeForSpell,
} from '../../../src/shared/spell';

describe('tokenizeForSpell', () => {
  it('keeps letters and internal apostrophes with original offsets', () => {
    expect(tokenizeForSpell("Helo wrold's!")).toEqual([
      { word: 'Helo', start: 0, end: 4 },
      { word: "wrold's", start: 5, end: 12 },
    ]);
  });

  it('skips punctuation and leading/trailing apostrophes', () => {
    expect(tokenizeForSpell("Hello, world! 'quoted'")).toEqual([
      { word: 'Hello', start: 0, end: 5 },
      { word: 'world', start: 7, end: 12 },
      { word: 'quoted', start: 15, end: 21 },
    ]);
  });

  it('keeps an internal apostrophe in a short contraction', () => {
    expect(tokenizeForSpell("it's")).toEqual([{ word: "it's", start: 0, end: 4 }]);
  });

  it('skips any token containing a digit', () => {
    expect(tokenizeForSpell('abc123 def 19th')).toEqual([
      { word: 'def', start: 7, end: 10 },
    ]);
  });

  it('returns no tokens for text without words', () => {
    expect(tokenizeForSpell('   -- 42 !!')).toEqual([]);
  });
});

describe('buildSpellDictionary', () => {
  it('lowercases, trims and skips comments and blanks', () => {
    const dict = buildSpellDictionary('# header\r\n\r\nHello \r\nworld\n# tail\n');
    expect([...dict].sort()).toEqual(['hello', 'world']);
  });

  it('handles LF and CRLF input identically', () => {
    expect(buildSpellDictionary('one\ntwo\n').size).toBe(2);
    expect(buildSpellDictionary('one\r\ntwo\r\n').size).toBe(2);
  });
});

describe('isSpellMisspelled', () => {
  const dict = buildSpellDictionary('hello\nworld\nthe\n');

  it('accepts a known word', () => {
    expect(isSpellMisspelled('hello', dict)).toBe(false);
    expect(isSpellMisspelled('HELLO', dict)).toBe(false);
  });

  it('flags a typo', () => {
    expect(isSpellMisspelled('helo', dict)).toBe(true);
  });

  it('never flags short words, acronyms or digit tokens', () => {
    expect(isSpellMisspelled('a', dict)).toBe(false);
    expect(isSpellMisspelled('USA', dict)).toBe(false);
    expect(isSpellMisspelled('NASA', dict)).toBe(false);
    expect(isSpellMisspelled('abc1', dict)).toBe(false);
  });

  it('never flags words longer than the max', () => {
    expect(isSpellMisspelled('x'.repeat(SPELL_WORD_MAX + 1), dict)).toBe(false);
  });

  it('accepts a possessive whose base form is known', () => {
    expect(isSpellMisspelled("world's", dict)).toBe(false);
    expect(isSpellMisspelled("wrold's", dict)).toBe(true);
  });
});

describe('suggestSpellCorrections', () => {
  it('returns the known correction first', () => {
    const dict = buildSpellDictionary('the\nworld\nword\nwould\n');
    expect(suggestSpellCorrections('wrold', dict)[0]).toBe('world');
    expect(suggestSpellCorrections('teh', dict)[0]).toBe('the');
  });

  it('orders equal-distance candidates alphabetically', () => {
    const dict = buildSpellDictionary('cat\ncut\ncot\n');
    expect(suggestSpellCorrections('cxt', dict)).toEqual(['cat', 'cot', 'cut']);
  });

  it('caps the result at the requested limit', () => {
    const dict = buildSpellDictionary('cat\ncot\ncut\ncet\ncit\n');
    expect(suggestSpellCorrections('cxt', dict, 2)).toHaveLength(2);
    expect(suggestSpellCorrections('cxt', dict, 2).length).toBeLessThanOrEqual(SPELL_SUGGESTION_LIMIT);
  });

  it('ignores candidates whose length differs by more than two', () => {
    const dict = buildSpellDictionary('abcdefgh\n');
    expect(suggestSpellCorrections('ab', dict)).toEqual([]);
  });

  it('returns nothing for a non-positive limit', () => {
    const dict = buildSpellDictionary('cat\n');
    expect(suggestSpellCorrections('cxt', dict, 0)).toEqual([]);
  });
});