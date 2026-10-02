/**
 * Phase 82 — pure offline spell-check helpers.
 *
 * NO DOM, NO fs, NO electron imports: this module is shared by the renderer
 * (tokenising the text-edit flow) and the backend tests. The dictionary bytes
 * are loaded over IPC; everything here operates on plain strings and a Set.
 */

/** Longest word the checker will judge. Words longer than this are treated
 *  as not-misspelled (they are usually identifiers / concatenations). */
export const SPELL_WORD_MAX = 48;

/** Maximum number of correction suggestions returned per word. */
export const SPELL_SUGGESTION_LIMIT = 5;

/** A word occurrence in the original text. `start` is inclusive and `end` is
 *  exclusive, both indexing the ORIGINAL string. */
export interface SpellToken {
  word: string;
  start: number;
  end: number;
}

const APOSTROPHES = "'\u2019";

function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function isWordChar(ch: string): boolean {
  return isLetter(ch) || (ch >= '0' && ch <= '9');
}

function isApostrophe(ch: string): boolean {
  return APOSTROPHES.includes(ch);
}

/**
 * Split `text` into word tokens. A token is a run of letters plus INTERNAL
 * apostrophes (an apostrophe with a word character before it and a letter
 * after it). Tokens containing a digit are skipped entirely. Offsets index the
 * original text.
 */
export function tokenizeForSpell(text: string): SpellToken[] {
  const tokens: SpellToken[] = [];
  const len = text.length;
  let i = 0;
  while (i < len) {
    if (!isWordChar(text[i])) {
      i++;
      continue;
    }
    const start = i;
    let j = i;
    let hasDigit = false;
    while (j < len) {
      const ch = text[j];
      if (isWordChar(ch)) {
        if (!isLetter(ch)) hasDigit = true;
        j++;
        continue;
      }
      if (
        isApostrophe(ch) &&
        j > start &&
        isWordChar(text[j - 1]) &&
        j + 1 < len &&
        isLetter(text[j + 1])
      ) {
        j++;
        continue;
      }
      break;
    }
    if (!hasDigit && j > start) {
      tokens.push({ word: text.slice(start, j), start, end: j });
    }
    i = j;
  }
  return tokens;
}

/**
 * Build a lookup set from raw dictionary text: split on CRLF or LF, trim,
 * lowercase, and skip blank lines and `#` comments.
 */
export function buildSpellDictionary(raw: string): Set<string> {
  const out = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const word = line.trim().toLowerCase();
    if (word.length === 0 || word.startsWith('#')) continue;
    out.add(word);
  }
  return out;
}

/**
 * True when `word` should be underlined as misspelled. Never flags words
 * shorter than two letters, words longer than `SPELL_WORD_MAX`, tokens
 * containing a digit, or all-caps acronyms of four letters or fewer. A
 * possessive/apostrophe form is accepted when the form before the apostrophe
 * is in the dictionary.
 */
export function isSpellMisspelled(word: string, dict: Set<string>): boolean {
  if (word.length < 2) return false;
  const lower = word.toLowerCase();
  if (lower.length > SPELL_WORD_MAX) return false;
  if (/[0-9]/.test(word)) return false;
  const letters = word.replace(/[^A-Za-z]/g, '');
  if (
    letters.length > 0 &&
    letters === letters.toUpperCase() &&
    letters.length <= 4
  ) {
    return false;
  }
  const apos = lower.search(/['\u2019]/);
  if (apos > 0 && dict.has(lower.slice(0, apos))) return false;
  return !dict.has(lower);
}

/** Optimal string alignment (bounded Damerau-Levenshtein) distance. */
function osaDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev2: number[] = new Array(m + 1);
  let prev: number[] = new Array(m + 1);
  let cur: number[] = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        best = Math.min(best, prev2[j - 2] + 1);
      }
      cur[j] = best;
    }
    const tmp = prev2;
    prev2 = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[m];
}

/**
 * Return up to `limit` lowercase corrections for `word`, ascending by edit
 * distance then alphabetical. Candidates are dictionary words sharing the
 * first letter with a length within two of the input.
 */
export function suggestSpellCorrections(
  word: string,
  dict: Set<string>,
  limit = SPELL_SUGGESTION_LIMIT,
): string[] {
  if (limit <= 0) return [];
  const lower = word.toLowerCase();
  if (lower.length === 0) return [];
  const first = lower[0];
  const scored: Array<{ word: string; distance: number }> = [];
  for (const candidate of dict) {
    if (candidate.length === 0 || candidate[0] !== first) continue;
    if (candidate === lower) continue;
    if (Math.abs(candidate.length - lower.length) > 2) continue;
    scored.push({ word: candidate, distance: osaDistance(lower, candidate) });
  }
  scored.sort((x, y) =>
    x.distance !== y.distance
      ? x.distance - y.distance
      : x.word < y.word
        ? -1
        : x.word > y.word
          ? 1
          : 0,
  );
  return scored.slice(0, limit).map((s) => s.word);
}