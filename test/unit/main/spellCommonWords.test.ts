import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSpellDictionary,
  isSpellMisspelled,
  tokenizeForSpell,
} from '../../../src/shared/spell';

const DICTIONARY_PATH = resolve(
  process.cwd(),
  'assets/dictionary/en-us.txt',
);

// Exact sample named by DEF-479 / e2e phase82_spellcheck.spec.cjs T2.
const COMMON_WORDS = [
  'cat',
  'sat',
  'dog',
  'run',
  'file',
  'page',
  'word',
  'spell',
  'check',
  'hello',
  'blue',
  'pdf',
  'house',
  'world',
  'text',
  'document',
  'red',
  'the',
  'and',
  'of',
  'to',
  'in',
  'is',
  'it',
];

// Size of the dictionary before the DEF-479 augmentation. The merged list
// must never shrink (words are only ever added).
const PRE_AUGMENT_SIZE = 29397;

describe('bundled dictionary common words (DEF-479)', () => {
  const raw = readFileSync(DICTIONARY_PATH, 'utf8');
  const dict = buildSpellDictionary(raw);

  it('contains every word from the DEF-479 common sample', () => {
    const missing = COMMON_WORDS.filter((word) => !dict.has(word));
    expect(missing).toEqual([]);
    for (const word of COMMON_WORDS) {
      expect(dict.has(word), `expected "${word}" in dictionary`).toBe(true);
    }
  });

  it('never shrinks the pre-augment vocabulary', () => {
    expect(dict.size).toBeGreaterThanOrEqual(PRE_AUGMENT_SIZE);
  });

  it('no longer flags the common phrase "teh cat sat" beyond the real typo', () => {
    const text = 'teh cat sat';
    const flagged = tokenizeForSpell(text)
      .map((token) => token.word)
      .filter((word) => isSpellMisspelled(word, dict));
    expect(flagged).toEqual(['teh']);
  });
});