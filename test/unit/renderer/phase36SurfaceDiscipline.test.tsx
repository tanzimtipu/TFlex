// @vitest-environment jsdom
//
// Phase 36 / operator section 3A — SURFACE DISCIPLINE (criterion 11).
//
// The governing rule: ContextPanel = "which thing?", Inspector = "what IS
// it?", Action Dock = "what can I DO to it?", right-click = a shortcut to the
// SAME dock verbs. Never the same data or the same action affordance on two
// surfaces at once.
//
// This suite walks `toolsRegistry` against the AFFORDANCES RENDERED BY THE
// REAL SURFACES — it mounts the `Inspector` (every stage x selection), the
// `ActionDock` (every stage + the State-2 selection override) and the
// `ContextPanel` (every stage), and reads the thumbnail menu from
// `buildPageMenuItems`. A capability is only allowed on the surfaces its
// ruling assigns it; anything else is a duplicate and fails.
//
// The four inspected surfaces, named so a future duplicate fails loudly:
//   1. DOCK      `[data-dock-verb]`        (ActionDock)
//   2. PANEL     `[data-context-panel-action]` + `[data-context-panel-combine]`
//   3. INSPECTOR `[data-inspector-action]`
//   4. MENU      `[data-menu-item]`        (thumbnail right-click)
// The command palette is EXEMPT (it indexes everything by design).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ActionDock, buildSelectionVerbs } from '../../../src/renderer/components/ActionDock';
import type { ActionDockProps, DockBulkActions } from '../../../src/renderer/components/ActionDock';
import {
  ContextPanel,
  buildPageMenuItems,
} from '../../../src/renderer/components/ContextPanel';
import { Inspector } from '../../../src/renderer/components/Inspector';
import type { InspectorProps, InspectorSelectionKind } from '../../../src/renderer/components/Inspector';
import { dockToolsForStage } from '../../../src/renderer/state/toolsRegistry';
import type { EngineState } from '../../../src/renderer/engine/types';
import type { Stage } from '../../../src/renderer/state/stages';
import type { SavedSignature } from '../../../src/shared/types';

// ---------------------------------------------------------------------------
// The surface vocabulary
// ---------------------------------------------------------------------------

type Surface = 'dock' | 'panel' | 'inspector' | 'menu';

/** The capabilities the sweep knows about. Each is a registry tool id or a
 *  documented non-registry control (its own affordance). */
type Capability = string;

/** The surfaces each capability is ALLOWED to render on, with the ruling that
 *  sanctions it. A capability observed anywhere else fails the sweep. */
const SANCTIONED: Record<Capability, { surfaces: Surface[]; why: string }> = {
  // ---- PAGES ---------------------------------------------------------
  merge: {
    surfaces: ['dock', 'panel'],
    why: 'Phase 37 item 21: Merge joined the PAGES dock default set; the PAGES panel header keeps `＋ Combine…`',
  },
  rotate: { surfaces: ['dock', 'menu'], why: 'ruling 1: verb on the hover/dock/right-click ONLY' },
  rotateCounterClockwise: {
    surfaces: ['menu'],
    why: 'ruling 1: the right-click is a page-verb shortcut; the dock uses `rotate`',
  },
  extract: { surfaces: ['dock', 'menu'], why: 'ruling 1: verb on the hover/dock/right-click ONLY' },
  delete: { surfaces: ['dock', 'menu'], why: 'ruling 1: verb on the hover/dock/right-click ONLY' },
  split: { surfaces: ['dock'], why: 'the dock is its verb home; no panel/inspector duplication' },
  insertPages: { surfaces: ['dock'], why: 'the dock is its verb home' },
  replacePages: { surfaces: ['dock', 'menu'], why: 'the right-click is a page-verb shortcut' },
  insertBlankPage: { surfaces: ['menu'], why: 'immediate blank insert is a page-verb shortcut' },
  clearPageSelection: { surfaces: ['dock'], why: 'the State-2 override control is dock-only' },
  renumberPages: {
    surfaces: ['inspector'],
    why: 'ruling 2: Inspector `Label · renumber…` ONLY (REMOVED from the menu)',
  },
  cropPages: {
    surfaces: ['dock'],
    why: 'Phase 37 item 21: crop rides its registry stage (PAGES) on the dock; no PAGES inspector crop row',
  },

  // ---- EDIT ----------------------------------------------------------
  editMode: {
    surfaces: [],
    why: 'Phase 37 item 13: entering the EDIT STAGE is the switch; no dock verb',
  },
  editText: { surfaces: ['dock'], why: 'the EDIT dock verb' },
  editImage: { surfaces: ['dock'], why: 'the EDIT dock verb' },
  editTextBox: { surfaces: ['dock'], why: 'the EDIT dock verb' },
  editToolOff: {
    surfaces: ['dock'],
    why: 'Phase 41 item 2: the retired EDIT toolbar\'s off mode rides the EDIT dock',
  },
  recognizeText: {
    surfaces: ['dock', 'panel'],
    why: 'the dock verb + the EDIT panel Recognition section (ruling 4 keeps the panel home)',
  },
  ocrSuspects: {
    surfaces: ['dock', 'panel'],
    why: 'Phase 37 item 21 adds the OCR-suspects dialog command to the dock; ruling 4 keeps the panel home',
  },
  batchOcr: { surfaces: ['dock'], why: 'Phase 37 item 21: batch OCR rides the EDIT dock' },

  // ---- REVIEW --------------------------------------------------------
  annotate: { surfaces: ['dock'], why: 'the REVIEW dock primary (opens the one flyout)' },
  sign: {
    surfaces: ['dock', 'panel'],
    why: 'the dock Sign verb + the REVIEW panel signature list / manager',
  },
  stamp: { surfaces: ['dock'], why: 'the REVIEW dock verb' },
  flatten: { surfaces: ['dock'], why: 'the REVIEW dock verb' },
  forms: { surfaces: ['dock'], why: 'Phase 37 item 21: Forms dialog command rides the REVIEW dock' },
  watermark: { surfaces: ['dock'], why: 'Phase 37 item 21 (and item 20): Watermark rides the REVIEW dock' },
  exportComments: {
    surfaces: ['dock', 'inspector'],
    why: 'Phase 37 item 21 adds the REVIEW dock verb; ruling 8 keeps the Inspector FDF export',
  },
  importComments: {
    surfaces: ['dock', 'inspector'],
    why: 'Phase 37 item 21 adds the REVIEW dock verb; ruling 8 keeps the Inspector FDF import',
  },
  fillFromCsv: {
    surfaces: ['dock'],
    why: 'Phase 53 (feature G mode 2): the CSV form-fill verb rides the REVIEW dock; the dialog is its only home',
  },

  // ---- DELIVER -------------------------------------------------------
  optimize: {
    surfaces: ['dock', 'panel'],
    why: 'ruling 5: Optimize is DELIVER-only; the dock verb + the panel pre-flight entry',
  },
  audit: { surfaces: ['dock'], why: 'ruling 5: Audit is DELIVER-only and the dock owns its verb' },
  exportPages: {
    surfaces: ['dock', 'inspector'],
    why: 'the DELIVER dock export verb + the DELIVER export section submit',
  },
  exportText: { surfaces: ['dock'], why: 'the DELIVER dock verb' },
  exportDocx: { surfaces: ['dock'], why: 'the DELIVER dock verb' },
  createFromImages: {
    surfaces: ['dock', 'panel'],
    why: 'Phase 37 item 21 adds the DELIVER dock verb; the panel `From images…` entry stays',
  },
  encrypt: {
    surfaces: ['dock'],
    why: 'Phase 52: the DELIVER dock verb opens the Create-encrypted dialog; no panel/inspector duplicate',
  },

  // ---- Inspector-only, non-registry controls -------------------------
  jumpToReview: {
    surfaces: ['inspector'],
    why: 'ruling 6: the read-only Annotations count jumps to REVIEW (documented exception)',
  },
};

/** Every capability the sweep may see on more than one surface. Explicit so a
 *  FUTURE duplicate must be added here (and justified) or fail. */
const RULED_MULTI_SURFACE: Capability[] = [
  'rotate',
  'extract',
  'delete',
  'replacePages',
  'recognizeText',
  'sign',
  'optimize',
  'exportPages',
  // Phase 37 item 21 — the dock's widened default set deliberately shares these
  // dialog commands with their existing panel/inspector homes.
  'merge',
  'ocrSuspects',
  'exportComments',
  'importComments',
  'createFromImages',
];
// ---------------------------------------------------------------------------
// jsdom stubs (the ContextPanel PAGES body mounts the live ThumbnailRail)
// ---------------------------------------------------------------------------

function stubObservers(): void {
  const g = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
  };
  if (g.IntersectionObserver === undefined) {
    class NoopIO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = NoopIO;
  }
  if (g.ResizeObserver === undefined) {
    class NoopRO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopRO;
  }
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState['rotations'],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

function mount(node: ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// DOM affordance -> capability maps
// ---------------------------------------------------------------------------

const INSPECTOR_ACTION_MAP: Record<string, Capability> = {
  renumber: 'renumberPages',
  'jump-to-review': 'jumpToReview',
  'export-comments': 'exportComments',
  'import-comments': 'importComments',
  export: 'exportPages',
};

const PANEL_ACTION_MAP: Record<string, Capability> = {
  recognize: 'recognizeText',
  suspects: 'ocrSuspects',
  optimize: 'optimize',
  'from-images': 'createFromImages',
  'manage-signatures': 'sign',
};

const MENU_ITEM_MAP: Record<string, Capability> = {
  'rotate-cw': 'rotate',
  'rotate-ccw': 'rotateCounterClockwise',
  extract: 'extract',
  'insert-blank': 'insertBlankPage',
  replace: 'replacePages',
  delete: 'delete',
};

const STAGES: readonly Stage[] = ['pages', 'edit', 'review', 'deliver'];
const SELECTION_KINDS: readonly InspectorSelectionKind[] = [
  'none',
  'page',
  'text',
  'signature',
];

// ---------------------------------------------------------------------------
// Surface collectors
// ---------------------------------------------------------------------------

/** DOCK � the stage verb set plus the State-2 selection override. */
function collectDock(stage: Stage): Capability[] {
  const bulk: DockBulkActions = { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() };
  const base: ActionDockProps = {
    activeStage: stage,
    pageSelection: [],
    onClearPageSelection: vi.fn(),
    bulk,
    dockPins: [],
    onPinTool: vi.fn(),
    onUnpinTool: vi.fn(),
    onRunTool: vi.fn(),
    canvasWidth: 1400,
  };
  const ids: Capability[] = [];
  const stageHost = mount(createElement(ActionDock, base));
  try {
    for (const el of stageHost.host.querySelectorAll('[data-dock-verb]')) {
      ids.push(el.getAttribute('data-dock-verb') ?? '');
    }
  } finally {
    stageHost.unmount();
  }
  // State 2 = the pages selection override.
  ids.push(...buildSelectionVerbs([1, 2], bulk, vi.fn()).map((v) => v.id));
  return ids.filter((id) => id !== '');
}

/** PANEL � the ContextPanel's own action affordances for a stage. */
function collectPanel(stage: Stage): Capability[] {
  stubObservers();
  const host = mount(
    createElement(ContextPanel, {
      stage,
      doc: makeDocStub(3),
      currentPage: 1,
      defaultWidthPt: 612,
      defaultHeightPt: 792,
      engineState: makeEngineState(3),
      canUndo: false,
      outline: null,
      onUndo: vi.fn(),
      onJump: vi.fn(),
      onMerge: vi.fn(),
      onExtractPages: vi.fn(),
      onInsertBlank: vi.fn(),
      onReplacePages: vi.fn(),
      onDeletePage: vi.fn(),
      onOptimize: vi.fn(),
      onRecognizeText: vi.fn(),
      onOpenOcrSuspects: vi.fn(),
      onManageSignatures: vi.fn(),
      onCreateFromImages: vi.fn(),
      fileSize: 2048,
      ocrStatus: 'Recognized',
      ocrHasRun: true,
      ocrSuspectCount: 2,
    }),
  );
  const caps: Capability[] = [];
  try {
    for (const el of host.host.querySelectorAll('[data-context-panel-action]')) {
      const id = el.getAttribute('data-context-panel-action') ?? '';
      const cap = PANEL_ACTION_MAP[id];
      if (cap !== undefined) caps.push(cap);
    }
    if (host.host.querySelector('[data-context-panel-combine]') !== null) caps.push('merge');
  } finally {
    host.unmount();
  }
  return caps;
}

/** INSPECTOR � every (stage, selection) pair's action affordances. */
function collectInspector(): Capability[] {
  const caps: Capability[] = [];
  for (const stage of STAGES) {
    for (const kind of SELECTION_KINDS) {
      const props: InspectorProps = {
        stage,
        selection: { kind },
        pageCount: 3,
        pageSize: { widthPt: 612, heightPt: 792 },
        pageRotation: 90,
        pageLabel: 'ii',
        cropBox: { x: 0, y: 0, width: 612, height: 792 },
        annotationCount: 2,
        formFieldCount: 1,
        fileSize: 2048,
        documentTitle: 'Doc.pdf',
        onRenumberPages: vi.fn(),
        onJumpToReview: vi.fn(),
        signatureStyle: 'Drawn',
        signatureHint: 'Click a page to place',
        annotations: [],
        onExportComments: vi.fn(),
        onImportComments: vi.fn(),
        exportFormat: 'png',
        exportPages: 'All',
        exportPreset: 'Default',
        onExport: vi.fn(),
      };
      const { host, unmount } = mount(createElement(Inspector, props));
      try {
        for (const el of host.querySelectorAll('[data-inspector-action]')) {
          const id = el.getAttribute('data-inspector-action') ?? '';
          const cap = INSPECTOR_ACTION_MAP[id];
          if (cap !== undefined) caps.push(cap);
        }
      } finally {
        unmount();
      }
    }
  }
  return caps;
}

/** MENU � the thumbnail right-click menu, as data. */
function collectMenu(): Capability[] {
  const items = buildPageMenuItems(1, {
    onRotateCw: vi.fn(),
    onRotateCcw: vi.fn(),
    onExtract: vi.fn(),
    onInsertBlank: vi.fn(),
    onReplace: vi.fn(),
    onDeletePage: vi.fn(),
  });
  return items.map((i) => MENU_ITEM_MAP[i.id] ?? i.id);
}

/** Every surface's rendered capability set, keyed by surface. */
function observedSurfaces(): Record<Surface, Set<Capability>> {
  const dock = new Set<Capability>();
  for (const stage of STAGES) for (const id of collectDock(stage)) dock.add(id);
  const panel = new Set<Capability>();
  for (const stage of STAGES) for (const id of collectPanel(stage)) panel.add(id);
  const inspector = new Set<Capability>(collectInspector());
  const menu = new Set<Capability>(collectMenu());
  return { dock, panel, inspector, menu };
}

// ---------------------------------------------------------------------------
// Criterion 11 (a) � no duplicate action affordance
// ---------------------------------------------------------------------------

describe('Phase 36 / 3A criterion 11(a) � surface discipline sweep', () => {
  it('every rendered affordance sits only on its sanctioned surface(s)', () => {
    const observed = observedSurfaces();
    const surfaces: Surface[] = ['dock', 'panel', 'inspector', 'menu'];
    for (const surface of surfaces) {
      for (const cap of observed[surface]) {
        const rule = SANCTIONED[cap];
        expect(rule, `unknown capability "${cap}" on ${surface}`).toBeDefined();
        expect(
          rule.surfaces.includes(surface),
          `"${cap}" must not render on the ${surface} surface (${rule.why})`,
        ).toBe(true);
      }
    }
  });

  it('a capability on two surfaces is explicitly ruled multi-surface', () => {
    const observed = observedSurfaces();
    const surfaces: Surface[] = ['dock', 'panel', 'inspector', 'menu'];
    for (const cap of new Set(Object.values(observed).flatMap((s) => [...s]))) {
      const on = surfaces.filter((s) => observed[s].has(cap));
      if (on.length > 1) {
        expect(
          RULED_MULTI_SURFACE.includes(cap),
          `"${cap}" renders on ${on.join(' + ')} without a ruling sanctioning it`,
        ).toBe(true);
      }
    }
  });

  it('the specific ruling negatives hold', () => {
    const observed = observedSurfaces();
    // ruling 1 � rotate/extract/delete are GETTING VERBS, never inspector values
    expect(observed.inspector.has('rotate')).toBe(false);
    // ruling 3 � crop is not a PAGES inspector affordance
    expect(observed.inspector.has('cropPages')).toBe(false);
    // ruling 2 � renumber is inspector-only, never a menu entry
    expect(observed.menu.has('renumberPages')).toBe(false);
    expect(observed.inspector.has('renumberPages')).toBe(true);
    // Phase 37 item 21 — Merge joined the PAGES dock default set; the panel
    // header retains its `＋ Combine…` affordance.
    expect(observed.dock.has('merge')).toBe(true);
    expect(observed.panel.has('merge')).toBe(true);
    // rulings 5 / 8 � optimize/audit are DELIVER dock+panel, FDF is REVIEW inspector
    expect(observed.inspector.has('optimize')).toBe(false);
    expect(observed.inspector.has('audit')).toBe(false);
    expect(observed.inspector.has('exportComments')).toBe(true);
    expect(observed.panel.has('exportComments')).toBe(false);
  });

  it('names the four surfaces it checks (future duplicates fail loudly)', () => {
    const observed = observedSurfaces();
    expect(Object.keys(observed).sort()).toEqual(['dock', 'inspector', 'menu', 'panel']);
    // The sweep is not vacuous: every surface renders at least one affordance.
    for (const [surface, set] of Object.entries(observed)) {
      expect(set.size, `${surface} rendered nothing`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 11 (b) � inspector values are read-only (one documented jump)
// ---------------------------------------------------------------------------

describe('Phase 36 / 3A criterion 11(b) � inspector values have no click affordance', () => {
  const mountPagesPage = (overrides: Partial<InspectorProps> = {}): {
    host: HTMLElement;
    unmount: () => void;
  } =>
    mount(
      createElement(Inspector, {
        stage: 'pages',
        selection: { kind: 'page', page: 2 },
        pageCount: 9,
        pageSize: { widthPt: 612, heightPt: 792 },
        pageRotation: 90,
        pageLabel: 'ii',
        annotationCount: 4,
        formFieldCount: 2,
        fileSize: 2048,
        documentTitle: 'Report.pdf',
        onRenumberPages: vi.fn(),
        onJumpToReview: vi.fn(),
        ...overrides,
      }),
    );

  it('Rotation and File size render as plain values (no buttons)', () => {
    const { host, unmount } = mountPagesPage();
    try {
      for (const row of ['rotation', 'file-size']) {
        const el = host.querySelector(`[data-inspector-row="${row}"]`);
        expect(el, row).not.toBeNull();
        expect(el?.querySelector('button'), `${row} must be read-only`).toBeNull();
        expect(el?.querySelector('[data-inspector-action]')).toBeNull();
      }
      // No disclosure / optimize / audit affordance anywhere.
      expect(host.querySelector('[data-inspector-action="document-menu"]')).toBeNull();
      expect(host.querySelector('[data-inspector-action="optimize"]')).toBeNull();
      expect(host.querySelector('[data-inspector-action="audit"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('the Annotations count is the ONE clickable value and it jumps to REVIEW', () => {
    const onJumpToReview = vi.fn();
    const { host, unmount } = mountPagesPage({ onJumpToReview });
    try {
      const row = host.querySelector('[data-inspector-row="annotations"]');
      const jump = row?.querySelector<HTMLButtonElement>('[data-inspector-action="jump-to-review"]');
      expect(jump).not.toBeNull();
      expect(jump?.querySelector('[data-inspector-annotations-count]')?.textContent).toBe('4');
      act((): void => {
        jump?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(onJumpToReview).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 11 (c) � the thumbnail right-click menu has no Renumber entry
// ---------------------------------------------------------------------------

describe('Phase 36 / 3A criterion 11(c) � the menu has no Renumber entry', () => {
  it('the data list and the rendered menu both carry six page verbs, no renumber', () => {
    const items = buildPageMenuItems(3, {
      onRotateCw: vi.fn(),
      onRotateCcw: vi.fn(),
      onExtract: vi.fn(),
      onInsertBlank: vi.fn(),
      onReplace: vi.fn(),
      onDeletePage: vi.fn(),
    });
    expect(items.map((i) => i.id)).toEqual([
      'rotate-cw',
      'rotate-ccw',
      'extract',
      'insert-blank',
      'replace',
      'delete',
    ]);
    expect(items.some((i) => i.id === 'renumber')).toBe(false);

    // And the REAL component renders exactly those � no Renumber row.
    stubObservers();
    const { host, unmount } = mount(
      createElement(ContextPanel, {
        stage: 'pages',
        doc: makeDocStub(3),
        currentPage: 1,
        defaultWidthPt: 612,
        defaultHeightPt: 792,
        engineState: makeEngineState(3),
        canUndo: false,
        outline: null,
        onUndo: vi.fn(),
        onJump: vi.fn(),
        onMerge: vi.fn(),
      }),
    );
    try {
      const thumb = host.querySelector('.thumb-item');
      expect(thumb).not.toBeNull();
      act((): void => {
        thumb?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      });
      const rendered = [...host.querySelectorAll('[data-menu-item]')].map(
        (el) => el.getAttribute('data-menu-item') ?? '',
      );
      expect(rendered).toHaveLength(6);
      expect(rendered).not.toContain('renumber');
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// The nine rulings, one assertion each
// ---------------------------------------------------------------------------

function mountDock(stage: Stage): { host: HTMLElement; unmount: () => void } {
  return mount(
    createElement(ActionDock, {
      activeStage: stage,
      pageSelection: [],
      onClearPageSelection: vi.fn(),
      bulk: { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() },
      dockPins: [],
      onPinTool: vi.fn(),
      onUnpinTool: vi.fn(),
      onRunTool: vi.fn(),
      canvasWidth: 1400,
    }),
  );
}

function mountPanel(stage: Stage, savedSignatures: readonly SavedSignature[] = []): {
  host: HTMLElement;
  unmount: () => void;
} {
  stubObservers();
  return mount(
    createElement(ContextPanel, {
      stage,
      doc: makeDocStub(3),
      currentPage: 1,
      defaultWidthPt: 612,
      defaultHeightPt: 792,
      engineState: makeEngineState(3),
      canUndo: false,
      outline: null,
      onUndo: vi.fn(),
      onJump: vi.fn(),
      onMerge: vi.fn(),
      ocrStatus: 'Recognized',
      ocrHasRun: true,
      ocrSuspectCount: 2,
      savedSignatures,
      onSignSignature: vi.fn(),
      onManageSignatures: vi.fn(),
    }),
  );
}

describe('Phase 36 / 3A � the nine rulings', () => {
  it('ruling 1: rotation is read-only in the Inspector; rotate/extract/delete are verbs', () => {
    const { host, unmount } = mount(
      createElement(Inspector, {
        stage: 'pages',
        selection: { kind: 'page', page: 1 },
        pageRotation: 90,
        onRenumberPages: vi.fn(),
      }),
    );
    try {
      expect(host.querySelector('[data-inspector-action="rotate"]')).toBeNull();
      const rotation = host.querySelector('[data-inspector-row="rotation"]');
      expect(rotation?.querySelector('button')).toBeNull();
    } finally {
      unmount();
    }
    const dock = mountDock('pages');
    try {
      const ids = [...dock.host.querySelectorAll('[data-dock-verb]')].map((e) =>
        e.getAttribute('data-dock-verb'),
      );
      expect(ids).toEqual(expect.arrayContaining(['rotate', 'extract', 'delete']));
    } finally {
      dock.unmount();
    }
    expect(collectMenu()).toEqual(
      expect.arrayContaining(['rotate', 'extract', 'delete']),
    );
  });

  it('ruling 2: renumber lives in the Inspector and is ABSENT from the menu', () => {
    expect(collectMenu()).not.toContain('renumberPages');
    const { host, unmount } = mount(
      createElement(Inspector, {
        stage: 'pages',
        selection: { kind: 'page', page: 1 },
        pageLabel: 'ii',
        onRenumberPages: vi.fn(),
      }),
    );
    try {
      expect(host.querySelector('[data-inspector-action="renumber"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it('ruling 3: no Crop row in the PAGES inspector; crop rides its PAGES dock', () => {
    const { host, unmount } = mount(
      createElement(Inspector, {
        stage: 'pages',
        selection: { kind: 'page', page: 1 },
        onRenumberPages: vi.fn(),
      }),
    );
    try {
      expect(host.querySelector('[data-inspector-row="crop"]')).toBeNull();
      expect(host.querySelector('[data-inspector-action="crop"]')).toBeNull();
    } finally {
      unmount();
    }
    // Phase 37 item 21 — crop rides its registry stage (PAGES) on the dock.
    expect(dockToolsForStage('pages').map((e) => e.id)).toContain('cropPages');
    expect(dockToolsForStage('edit').map((e) => e.id)).not.toContain('cropPages');
  });

  it('ruling 4: OCR status/suspects are the EDIT panel ONLY, never the Inspector', () => {
    const insp = mount(
      createElement(Inspector, {
        stage: 'edit',
        selection: { kind: 'page', page: 1 },
        cropBox: { x: 0, y: 0, width: 612, height: 792 },
      }),
    );
    try {
      expect(insp.host.querySelector('[data-inspector-row="ocr-status"]')).toBeNull();
      expect(insp.host.querySelector('[data-inspector-action="recognize"]')).toBeNull();
    } finally {
      insp.unmount();
    }
    const panel = mountPanel('edit');
    try {
      expect(panel.host.querySelector('[data-ocr-status]')?.textContent).toContain('Recognized');
      expect(panel.host.querySelector('[data-context-panel-action="recognize"]')).not.toBeNull();
      expect(panel.host.querySelector('[data-context-panel-action="suspects"]')).not.toBeNull();
    } finally {
      panel.unmount();
    }
  });

  it('ruling 5: file size is read-only; Optimize/Audit are not Inspector affordances', () => {
    const { host, unmount } = mount(
      createElement(Inspector, {
        stage: 'deliver',
        selection: { kind: 'none' },
        fileSize: 2048,
        onExport: vi.fn(),
      }),
    );
    try {
      const row = host.querySelector('[data-inspector-row="file-size"]');
      expect(row?.querySelector('button')).toBeNull();
      expect(host.querySelector('[data-inspector-action="optimize"]')).toBeNull();
      expect(host.querySelector('[data-inspector-action="audit"]')).toBeNull();
    } finally {
      unmount();
    }
    // The DELIVER dock owns the verbs.
    expect(dockToolsForStage('deliver').map((e) => e.id)).toEqual(
      expect.arrayContaining(['optimize', 'audit']),
    );
  });

  it('ruling 6: the Annotations count is read-only and jumps to REVIEW', () => {
    const onJumpToReview = vi.fn();
    const { host, unmount } = mount(
      createElement(Inspector, {
        stage: 'pages',
        selection: { kind: 'page', page: 1 },
        annotationCount: 5,
        onJumpToReview,
      }),
    );
    try {
      const jump = host.querySelector<HTMLButtonElement>('[data-inspector-action="jump-to-review"]');
      expect(jump?.querySelector('[data-inspector-annotations-count]')?.textContent).toBe('5');
      act((): void => {
        jump?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(onJumpToReview).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it('ruling 7: the saved-signature LIST is the REVIEW panel; the Inspector edits the armed one', () => {
    const panel = mountPanel('review', [
      {
        id: 's1',
        label: 'Ada',
        createdAt: '2026-01-01T00:00:00.000Z',
        source: { kind: 'typed', text: 'Ada', width: 120, height: 40 },
      },
    ]);
    try {
      expect(panel.host.querySelector('[data-saved-signatures-list]')).not.toBeNull();
    } finally {
      panel.unmount();
    }
    const { host, unmount } = mount(
      createElement(Inspector, {
        stage: 'review',
        selection: { kind: 'signature' },
        signatureStyle: 'Drawn',
        signatureHint: 'Click a page to place',
      }),
    );
    try {
      expect(host.querySelector('[data-saved-signatures-list]')).toBeNull();
      expect(host.querySelector('[data-saved-signature]')).toBeNull();
      expect(host.querySelector('[data-inspector-row="signature-style"]')?.textContent).toContain(
        'Drawn',
      );
      expect(host.querySelector('[data-inspector-row="signature-hint"]')?.textContent).toContain(
        'Click a page',
      );
    } finally {
      unmount();
    }
  });

  it('ruling 8: FDF export/import is the REVIEW inspector ONLY', () => {
    const { host, unmount } = mount(
      createElement(Inspector, {
        stage: 'review',
        selection: { kind: 'none' },
        annotations: [],
        onExportComments: vi.fn(),
        onImportComments: vi.fn(),
      }),
    );
    try {
      expect(host.querySelector('[data-inspector-action="export-comments"]')).not.toBeNull();
      expect(host.querySelector('[data-inspector-action="import-comments"]')).not.toBeNull();
    } finally {
      unmount();
    }
    const panel = mountPanel('review');
    try {
      expect(panel.host.querySelector('[data-context-panel-action="export-comments"]')).toBeNull();
      expect(panel.host.querySelector('[data-context-panel-action="import-comments"]')).toBeNull();
    } finally {
      panel.unmount();
    }
  });

  it('ruling 9: State 2 is [chip] | Rotate � Extract � Delete � Clear (no merge)', () => {
    const bulk: DockBulkActions = { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() };
    expect(buildSelectionVerbs([1, 2], bulk, vi.fn()).map((v) => v.id)).toEqual([
      'rotate',
      'extract',
      'delete',
      'clearPageSelection',
    ]);
    // Merge is the PAGES panel header's combine affordance only.
    const panel = mountPanel('pages');
    try {
      expect(panel.host.querySelector('[data-context-panel-combine]')).not.toBeNull();
    } finally {
      panel.unmount();
    }
    // Phase 37 item 21 — Merge IS a PAGES dock verb now, but it is NOT part of
    // the State-2 selection override (the four ids asserted above).
    expect(dockToolsForStage('pages').map((e) => e.id)).toContain('merge');
  });
});

