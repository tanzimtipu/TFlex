// @vitest-environment jsdom
//
// DEF-332 — every movable text kind advances by the SAME mouse delta.
//
// qa's phase25 C3 probe dragged an annotated textbox / callout / note and an
// Edit-mode text box, then asserted each overlay moved by the mouse delta. The
// three ANNOTATION kinds moved (`moveAnnotation` with the drag delta); the edit
// box reported {0,0}. The move MATH was never the difference — the edit box's
// drag (`EditOverlay`'s `textBoxDrag`, applied with `moveImageRect`) is the
// same delta on the same page grid — so this test pins all four kinds' delta
// so a future kind-specific regression fails here first. The EditOverlay
// source is asserted to keep using the shared helper on the box-move branch.
//
// The real DEF-332 blocker at the default window was the Action Dock covering
// the box's centre and swallowing the pointerdown (fixed by the DEF-330 dock
// geometry); that is an e2e-observable overlap, not a delta-math difference.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moveAnnotation } from '../../../src/renderer/annotations/geometry';
import type { Annotation } from '../../../src/renderer/annotations/model';
import { moveImageRect } from '../../../src/renderer/edit/geometry';

type TextBox = Extract<Annotation, { kind: 'textbox' }>;
type Callout = Extract<Annotation, { kind: 'callout' }>;
type Note = Extract<Annotation, { kind: 'note' }>;

const PAGE_W = 612;
const PAGE_H = 792;
const DX = 120;
const DY = 100;

function base(id: string): {
  id: string;
  page: number;
  color: string;
  createdAt: string;
} {
  return { id, page: 1, color: '#e11d48', createdAt: '2026-01-01T00:00:00Z' };
}

const textbox: TextBox = {
  ...base('tb'),
  kind: 'textbox',
  rect: { x: 100, y: 200, width: 200, height: 70 },
  text: 'TB',
};
const callout: Callout = {
  ...base('co'),
  kind: 'callout',
  rect: { x: 100, y: 200, width: 200, height: 70 },
  at: { x: 40, y: 380 },
  text: 'CO',
};
const note: Note = {
  ...base('nt'),
  kind: 'note',
  at: { x: 300, y: 400 },
  text: 'NT',
};
const editBoxRect = { x: 100, y: 200, width: 200, height: 70 };

describe('DEF-332 — the four movable text kinds advance by the same delta', () => {
  it('moves the annotated textbox by the drag delta', () => {
    const moved = moveAnnotation(textbox, DX, DY) as TextBox;
    expect(moved.rect).toEqual({ x: 220, y: 300, width: 200, height: 70 });
  });

  it('moves the callout box by the drag delta and keeps its arrow anchor fixed', () => {
    const moved = moveAnnotation(callout, DX, DY) as Callout;
    expect(moved.rect).toEqual({ x: 220, y: 300, width: 200, height: 70 });
    // DEF-161 — the box and arrow move independently; the box drag leaves `at`.
    expect(moved.at).toEqual({ x: 40, y: 380 });
  });

  it('moves the note anchor by the drag delta', () => {
    const moved = moveAnnotation(note, DX, DY) as Note;
    expect(moved.at).toEqual({ x: 420, y: 500 });
  });

  it('moves the Edit-mode text box by the same drag delta (moveImageRect)', () => {
    const moved = moveImageRect(editBoxRect, { x: DX, y: DY }, PAGE_W, PAGE_H);
    expect(moved).toEqual({ x: 220, y: 300, width: 200, height: 70 });
    expect(moved.x - editBoxRect.x).toBe(DX);
    expect(moved.y - editBoxRect.y).toBe(DY);
  });

  it('asserts the four deltas together (all four kinds agree)', () => {
    const deltas = {
      textbox: (() => {
        const m = moveAnnotation(textbox, DX, DY) as TextBox;
        return { x: m.rect.x - textbox.rect.x, y: m.rect.y - textbox.rect.y };
      })(),
      callout: (() => {
        const m = moveAnnotation(callout, DX, DY) as Callout;
        return { x: m.rect.x - callout.rect.x, y: m.rect.y - callout.rect.y };
      })(),
      note: (() => {
        const m = moveAnnotation(note, DX, DY) as Note;
        return { x: m.at.x - note.at.x, y: m.at.y - note.at.y };
      })(),
      editBox: (() => {
        const m = moveImageRect(editBoxRect, { x: DX, y: DY }, PAGE_W, PAGE_H);
        return { x: m.x - editBoxRect.x, y: m.y - editBoxRect.y };
      })(),
    };
    for (const kind of ['textbox', 'callout', 'note', 'editBox'] as const) {
      expect(deltas[kind], kind).toEqual({ x: DX, y: DY });
    }
  });

  it('keeps the EditOverlay box-move branch on the shared moveImageRect helper', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../src/renderer/edit/EditOverlay.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    // The move branch (kind === "move") applies the drag with moveImageRect.
    expect(src).toMatch(
      /if \(textBoxDrag\.kind === "move"\)\s*\{[\s\S]*?moveImageRect\(/s,
    );
  });
});
