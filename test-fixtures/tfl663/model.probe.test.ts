// TFL-663 — model-level adversarial probe for H1 / H7.
import { describe, expect, it } from 'vitest';
import {
  DOCK_GLOBAL_IDS,
  DOCK_STAGE_IDS,
  dockPickerIdsForStage,
  dockRelevantIdsForStage,
  isDockPinnableId,
} from '../../src/renderer/state/toolsRegistry';
import {
  addDockPin,
  pinDockTool,
  sanitizeDockCuration,
  sanitizeDockPins,
  sanitizeDockUnpinned,
  unpinDockTool,
} from '../../src/renderer/state/dockModel';
import type { Stage } from '../../src/renderer/state/stages';

const STAGES: readonly Stage[] = ['pages', 'edit', 'review', 'deliver'];
const NON_DOCK = [
  'openSample', 'windowMaximize', 'windowMinimize', 'windowClose', 'toggleTheme',
  'zoomIn', 'zoomOut', 'fitWidth', 'fitPage', 'save', 'saveAs', 'open', 'print',
  'multi-mode', 'panMode', 'paneOpen', 'renumberPages', 'redact', 'toolsPalette',
];

describe('TFL-663 H1: picker outputs are always acceptable to the pin writers', () => {
  for (const stage of STAGES) {
    it(`${stage}: picker set == relevant set + curated globals, all pinnable`, () => {
      const picker = dockPickerIdsForStage(stage);
      for (const id of picker) expect(isDockPinnableId(id), id).toBe(true);
      const relevant = dockRelevantIdsForStage(stage);
      // The derived set must equal the explicit stage list (the sanitize rule).
      expect([...relevant].sort()).toEqual([...DOCK_STAGE_IDS[stage]].sort());
      const expected = [...relevant, ...DOCK_GLOBAL_IDS.filter((id) => !relevant.includes(id))];
      expect(picker).toEqual(expected);
    });
  }
});

describe('TFL-663 H1: hostile settings payloads cannot seed a non-dock row', () => {
  it('sanitizeDockPins drops every non-dock global and keeps the legal ids', () => {
    const raw = [...NON_DOCK, 'rotate', 'undo', 'redo', 'openReadingView', 'forms', 'rotate'];
    const out = sanitizeDockPins(raw);
    expect(out).toEqual(['rotate', 'undo', 'redo', 'openReadingView', 'forms']);
    for (const id of NON_DOCK) expect(out).not.toContain(id);
  });

  it('addDockPin refuses each hostile id and accepts curated globals', () => {
    for (const id of NON_DOCK) expect(addDockPin([], id), id).toEqual([]);
    expect(addDockPin([], 'undo')).toEqual(['undo']);
  });

  it('sanitizeDockCuration: un-pin wins, non-pinnable pins dropped', () => {
    const curated = sanitizeDockCuration({
      pins: ['openSample', 'rotate', 'zoomIn', 'fitWidth', 'rotate'],
      unpinned: ['rotate', 'zoomIn', 'openSample', 'unknown-id', 'rotate'],
    });
    // rotate is in both -> un-pin wins -> dropped from pins.
    expect(curated.pins).toEqual([]);
    // unknown ids are not registry ids -> dropped from unpinned too.
    expect(curated.unpinned.sort()).toEqual(['openSample', 'rotate', 'zoomIn'].sort());
  });

  it('a hostile drawable stack: pins survive sanitize only if dock-pinnable', () => {
    const hostile = {
      pins: ['openSample', 'windowMaximize', 'toggleTheme', 'zoomIn', 'fitWidth', 'save', 'rotate', 'undo'],
      unpinned: [],
    };
    const { pins } = sanitizeDockCuration(hostile);
    // The ActionDock renders sanitizeDockPins(dockPins) filtered by stage; every
    // surviving id is dock-pinnable, so no dead (unrunnable) row can render.
    const renderable = sanitizeDockPins(pins);
    expect(renderable).toEqual(['rotate', 'undo']);
  });

  it('H7 — legacy upgrade shape drops zoomIn/openSample/fitWidth, keeps the legal pin', () => {
    const legacy = sanitizeDockCuration({ pins: ['zoomIn', 'openSample', 'fitWidth', 'rotate'], unpinned: [] });
    expect(legacy.pins).toEqual(['rotate']);
    for (const dead of ['zoomIn', 'openSample', 'fitWidth']) expect(legacy.pins).not.toContain(dead);
  });

  it('H7: a removed legacy pin cannot resurrect from a dockUnpinned interaction', () => {
    // legacy pins + the user has un-pinned one of them; unpin must win.
    const curated = sanitizeDockCuration({
      pins: ['fitWidth', 'openSample'],
      unpinned: ['fitWidth', 'openSample'],
    });
    expect(curated.pins).toEqual([]);
    // Re-pinning some other stage default must not resurrect the illegal ids.
    const after = pinDockTool({ pins: curated.pins, unpinned: curated.unpinned }, 'rotate', ['rotate', 'split']);
    expect(after.pins).not.toContain('fitWidth');
    expect(after.pins).not.toContain('openSample');
    // And unpinDockTool sanitizes its output.
    const after2 = unpinDockTool({ pins: ['openSample', 'rotate'], unpinned: [] }, 'split', ['split']);
    expect(after2.pins).not.toContain('openSample');
  });

  it('H7 observation: pinDockTool restore branch preserves pre-existing hostile pins (renders filtered)', () => {
    // This documents an asymmetry: unpinDockTool sanitizes, the restore branch of
    // pinDockTool copies pins verbatim. Proves rendering is the only filter.
    const out = pinDockTool({ pins: ['openSample', 'rotate'], unpinned: [] }, 'rotate', ['rotate']);
    // out.pins still carries the illegal id in the returned list...
    expect(out.pins).toContain('openSample');
    // ...but the dock's read path (sanitizeDockPins) never renders it.
    expect(sanitizeDockPins(out.pins)).not.toContain('openSample');
  });

  it('sanitizeDockUnpinned keeps only registry ids (no render path for unknown)', () => {
    expect(sanitizeDockUnpinned(['zoomIn', 'nope', 'rotate', 5, null])).toEqual(['zoomIn', 'rotate']);
  });
});