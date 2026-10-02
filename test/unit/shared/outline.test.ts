import { describe, expect, it } from 'vitest';
import {
  countOutline,
  indentEntry,
  insertEntry,
  normalizeOutline,
  outdentEntry,
  removeEntry,
  renameEntry,
  retargetEntry,
  type OutlineEntry,
} from '../../../src/shared/outline';

/** Freeze a tree (and nested arrays) so an accidental in-place mutation in a
 *  helper throws in strict mode instead of silently passing. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function tree(): OutlineEntry[] {
  return [
    {
      title: 'A',
      page: 1,
      children: [
        { title: 'A1', page: 2, children: [] },
        { title: 'A2', page: 3, children: [] },
      ],
    },
    { title: 'B', page: null, children: [] },
    { title: 'C', page: 4, children: [] },
  ];
}

function titles(entries: OutlineEntry[]): string[] {
  return entries.map((e) => e.title);
}

// ---------------------------------------------------------------------------
// normalizeOutline
// ---------------------------------------------------------------------------

describe('normalizeOutline', () => {
  it('returns [] for non-array input', () => {
    expect(normalizeOutline(null)).toEqual([]);
    expect(normalizeOutline('x')).toEqual([]);
    expect(normalizeOutline({ title: 'A' })).toEqual([]);
  });

  it('drops entries with a missing, non-string, empty or whitespace title', () => {
    const out = normalizeOutline([
      { title: 'Keep', page: 1, children: [] },
      { title: '', page: 1, children: [] },
      { title: '   ', page: 1, children: [] },
      { title: 42, page: 1, children: [] },
      { page: 1, children: [] },
      null,
      'nope',
    ]);
    expect(titles(out)).toEqual(['Keep']);
  });

  it('trims titles and coerces an invalid page to null', () => {
    const out = normalizeOutline([
      { title: '  Trimmed  ', page: 3, children: [] },
      { title: 'Zero', page: 0, children: [] },
      { title: 'Neg', page: -2, children: [] },
      { title: 'Frac', page: 2.5, children: [] },
      { title: 'Str', page: '2', children: [] },
      { title: 'Absent', children: [] },
      { title: 'Null', page: null, children: [] },
    ]);
    expect(out.map((e) => [e.title, e.page])).toEqual([
      ['Trimmed', 3],
      ['Zero', null],
      ['Neg', null],
      ['Frac', null],
      ['Str', null],
      ['Absent', null],
      ['Null', null],
    ]);
  });

  it('treats a non-array children value as empty', () => {
    const out = normalizeOutline([{ title: 'A', page: 1, children: 'x' }]);
    expect(out[0].children).toEqual([]);
  });

  it('clamps nesting to 64 levels', () => {
    let node: OutlineEntry = { title: 'leaf', page: null, children: [] };
    for (let i = 0; i < 69; i++) {
      node = { title: `n${i}`, page: null, children: [node] };
    }
    const norm = normalizeOutline([node]);
    let depth = 0;
    let cur: OutlineEntry | undefined = norm[0];
    while (cur !== undefined) {
      depth += 1;
      cur = cur.children[0];
    }
    expect(depth).toBe(64);
  });

  it('does not mutate its input', () => {
    const input = deepFreeze([
      { title: ' A ', page: 2, children: [{ title: '  ', page: 9, children: [] }] },
    ]);
    const out = normalizeOutline(input);
    expect(out).toEqual([{ title: 'A', page: 2, children: [] }]);
  });
});

// ---------------------------------------------------------------------------
// countOutline
// ---------------------------------------------------------------------------

describe('countOutline', () => {
  it('counts every node including descendants', () => {
    expect(countOutline(tree())).toBe(5);
    expect(countOutline([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// insertEntry
// ---------------------------------------------------------------------------

describe('insertEntry', () => {
  it('appends at the root for an empty path', () => {
    const base = deepFreeze(tree());
    const out = insertEntry(base, [], { title: 'D', page: null, children: [] });
    expect(titles(out)).toEqual(['A', 'B', 'C', 'D']);
    expect(out).not.toBe(base);
    expect(titles(base)).toEqual(['A', 'B', 'C']);
  });

  it('appends as the last child of the node at the path', () => {
    const base = deepFreeze(tree());
    const out = insertEntry(base, [0], { title: 'A3', page: null, children: [] });
    expect(titles(out[0].children)).toEqual(['A1', 'A2', 'A3']);
    expect(out[0].children).not.toBe(base[0].children);
    expect(base[0].children).toHaveLength(2);
  });

  it('is a no-op for an unresolvable path or an invalid entry', () => {
    const base = tree();
    expect(insertEntry(base, [9], { title: 'X', page: null, children: [] })).toEqual(base);
    expect(insertEntry(base, [0, 5], { title: 'X', page: null, children: [] })).toEqual(base);
    expect(insertEntry(base, [], { title: '   ', page: null, children: [] })).toEqual(base);
  });
});

// ---------------------------------------------------------------------------
// renameEntry / retargetEntry / removeEntry
// ---------------------------------------------------------------------------

describe('renameEntry', () => {
  it('renames the node at the path and trims the title', () => {
    const base = deepFreeze(tree());
    const out = renameEntry(base, [0, 1], '  A2x  ');
    expect(out[0].children[1].title).toBe('A2x');
    expect(base[0].children[1].title).toBe('A2');
    expect(out).not.toBe(base);
  });

  it('is a no-op for a non-string title or an unresolvable path', () => {
    const base = tree();
    expect(renameEntry(base, [0], 5 as unknown as string)).toEqual(base);
    expect(renameEntry(base, [7], 'x')).toEqual(base);
  });
});

describe('retargetEntry', () => {
  it('sets the page at the path and coerces invalid pages to null', () => {
    const base = deepFreeze(tree());
    const out = retargetEntry(base, [1], 5);
    expect(out[1].page).toBe(5);
    expect(out[2].page).toBe(4);
    const out2 = retargetEntry(base, [2], -1);
    expect(out2[2].page).toBeNull();
    expect(base[1].page).toBeNull();
  });
});

describe('removeEntry', () => {
  it('removes the node and its subtree', () => {
    const base = deepFreeze(tree());
    const out = removeEntry(base, [0, 0]);
    expect(titles(out)).toEqual(['A', 'B', 'C']);
    expect(titles(out[0].children)).toEqual(['A2']);
    expect(countOutline(out)).toBe(4);
    expect(countOutline(base)).toBe(5);
  });

  it('is a no-op for an empty or unresolvable path', () => {
    const base = tree();
    expect(removeEntry(base, [])).toEqual(base);
    expect(removeEntry(base, [9])).toEqual(base);
  });
});

// ---------------------------------------------------------------------------
// indentEntry / outdentEntry
// ---------------------------------------------------------------------------

describe('indentEntry', () => {
  it('moves a top-level node under its previous sibling', () => {
    const base = deepFreeze(tree());
    const out = indentEntry(base, [2]);
    expect(titles(out)).toEqual(['A', 'B']);
    expect(titles(out[1].children)).toEqual(['C']);
    expect(countOutline(out)).toBe(5);
    // Original is untouched and the tree is a fresh value.
    expect(titles(base)).toEqual(['A', 'B', 'C']);
    expect(base[1].children).toHaveLength(0);
    expect(out).not.toBe(base);
  });

  it('moves a nested node under its previous sibling', () => {
    const base = deepFreeze(tree());
    const out = indentEntry(base, [0, 1]);
    expect(titles(out[0].children)).toEqual(['A1']);
    expect(titles(out[0].children[0].children)).toEqual(['A2']);
    expect(base[0].children[1].children).toHaveLength(0);
  });

  it('is a no-op for a first sibling or an unresolvable path', () => {
    const base = tree();
    expect(indentEntry(base, [0])).toEqual(base);
    expect(indentEntry(base, [0, 0])).toEqual(base);
    expect(indentEntry(base, [9])).toEqual(base);
    expect(indentEntry(base, [])).toEqual(base);
  });
});

describe('outdentEntry', () => {
  it('moves a nested node up to sit just after its parent', () => {
    const base = deepFreeze(tree());
    const out = outdentEntry(base, [0, 1]);
    expect(titles(out)).toEqual(['A', 'A2', 'B', 'C']);
    expect(titles(out[0].children)).toEqual(['A1']);
    expect(countOutline(out)).toBe(5);
    expect(titles(base)).toEqual(['A', 'B', 'C']);
    expect(base[0].children).toHaveLength(2);
  });

  it('is a no-op at the root or for an unresolvable path', () => {
    const base = tree();
    expect(outdentEntry(base, [0])).toEqual(base);
    expect(outdentEntry(base, [9, 0])).toEqual(base);
    expect(outdentEntry(base, [0, 9])).toEqual(base);
    expect(outdentEntry(base, [])).toEqual(base);
  });
});

