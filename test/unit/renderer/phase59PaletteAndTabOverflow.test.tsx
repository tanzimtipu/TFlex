// @vitest-environment jsdom
//
// Phase 59 (items 7 and 10).
//
// item 7 — the Ctrl+K palette must not list dead rows. A registry entry whose
// `action` has no command anywhere (a panel control, a pointer interaction, a
// per-item list) is REMOVED from the corpus. Rows that remain keep the DEF-327
// behaviour: a live gate that refuses them renders them disabled with the dock
// refusal copy.
//
// item 10 — the tab strip keeps ONE row: `planTabOverflow` shrinks the tabs
// toward a floor and then stacks them with a negative inter-tab margin. The
// overlap is applied to the DOM (the value rides `--tf-tab-overlap` on each
// tab's <li> wrapper, the real sibling inside `.tab-list`), so this file pins
// the pure plan AND the rendered DOM contract. DEF-420: the old test asserted
// the `.tab + .tab` stylesheet TEXT, which passed while the rule never matched
// the wrapped tabs (a wrong-oracle test). The removed selector is now asserted
// gone and the live selector is pinned against the real DOM structure.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
  TAB_GAP,
  TAB_MIN_PITCH,
  TAB_OVERFLOW_METRICS,
  planTabOverflow,
} from '../../../src/renderer/components/AppHeader';
import { AppHeader } from '../../../src/renderer/components/AppHeader';
import {
  PALETTE_UNRUNNABLE_ACTIONS,
  buildPaletteRows,
  paletteRowState,
} from '../../../src/renderer/state/commandPalette';
import { TOOL_REGISTRY, toolById } from '../../../src/renderer/state/toolsRegistry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The 13 registry actions with no command anywhere — the dead rows the
 *  operator asked us to remove from Ctrl+K. Phase 59 (item 7) follow-up: the
 *  two rail-tab actions (`railTabThumbnails` / `railTabOutline`) are NO LONGER
 *  here — they are WIRED (App's host-owned `railTab`), so they are listed and
 *  enabled again. The rail's annotations tab stays removed (still SideRail-
 *  local), as do the other 12 genuinely command-less widgets. */
const REMOVED_ACTIONS = [
  'railTabAnnotations',
  'pageContextMenu',
  'dragPageToDocument',
  'editDefaultFont',
  'annotationColor',
  'annotationPenWidth',
  'pageJump',
  'openRecent',
  'removeRecent',
  'openSample',
  'appMenu',
  'panePick',
  'paneResize',
] as const;

const REMOVED_IDS = [
  'annotationsPanel',
  'pageContextMenu',
  'dragPage',
  'editDefaultFont',
  'annColor',
  'annPenWidth',
  'pageJump',
  'openRecent',
  'removeRecent',
  'openSample',
  'appMenu',
  'panePick',
  'paneResize',
] as const;

/** The two wired rail-tab rows: listed again, and enabled with the Pages panel
 *  showing (a document open + the host run map entry present). */
const WIRED_RAIL_IDS = ['pageThumbnails', 'outlinePanel'] as const;
const WIRED_RAIL_ACTIONS = ['railTabThumbnails', 'railTabOutline'] as const;

describe('Phase 59 item 7 — the palette removes rows that can never act', () => {
  it('names exactly the command-less actions (and every registry entry still exists)', () => {
    expect(PALETTE_UNRUNNABLE_ACTIONS.size).toBe(REMOVED_ACTIONS.length);
    for (const action of REMOVED_ACTIONS) {
      expect(PALETTE_UNRUNNABLE_ACTIONS.has(action), action).toBe(true);
    }
    // The registry entries still exist (the dock / rail / panel own them).
    for (const id of REMOVED_IDS) {
      expect(toolById(id), `${id} registry entry`).toBeDefined();
    }
    for (const id of REMOVED_IDS) {
      expect(PALETTE_UNRUNNABLE_ACTIONS.has(toolById(id)!.action), `${id} action`).toBe(true);
    }
  });

  it('drops every dead row from the built corpus', () => {
    const ids = new Set(
      buildPaletteRows({ query: '' }).map((row) => (row.kind === 'tool' ? row.id : '')),
    );
    for (const id of REMOVED_IDS) {
      expect(ids.has(id), `${id} must be gone`).toBe(false);
    }
    // A runnable row is untouched.
    expect(ids.has('merge')).toBe(true);
    expect(ids.has('sign')).toBe(true);
  });

  it('lists the two wired rail-tab rows again and ENABLES them (Pages + doc)', () => {
    // Phase 59 (item 7) follow-up: the two actions have a host handler now, so
    // they are NOT filtered; with the Pages panel showing (the host's live gate
    // reports available) both rows render ENABLED and can run.
    const rows = buildPaletteRows({ query: '', isToolEnabled: () => true });
    for (const id of WIRED_RAIL_IDS) {
      const row = rows.find((r) => r.kind === 'tool' && r.id === id);
      expect(row, `${id} must be listed`).toBeDefined();
      expect(row?.kind === 'tool' && row.enabled, `${id} must be enabled`).toBe(true);
    }
    for (const action of WIRED_RAIL_ACTIONS) {
      expect(PALETTE_UNRUNNABLE_ACTIONS.has(action), action).toBe(false);
    }
  });

  it('keeps the DEF-327 live gate: a refused row stays listed and disabled with the dock copy', () => {
    const rows = buildPaletteRows({
      query: 'edit text',
      isToolEnabled: (): boolean => false,
      disabledReasonFor: (): string => 'Turn on Edit content first',
    });
    const row = rows.find((r) => r.kind === 'tool' && r.id === 'editText');
    expect(row?.kind).toBe('tool');
    expect(row?.kind === 'tool' && row.enabled).toBe(false);
    expect(row?.kind === 'tool' && row.reason).toBe('Turn on Edit content first');
  });

  it('paletteRowState reports enabled only when the host gate allows it', () => {
    const entry = toolById('merge')!;
    expect(paletteRowState(entry, { isToolEnabled: () => true }).enabled).toBe(true);
    const closed = paletteRowState(entry, { isToolEnabled: () => false });
    expect(closed.enabled).toBe(false);
    expect(closed.reason).toBe('Open a document first');
  });

  it('the whole registry is accounted for: listed + removed = registry', () => {
    const listed = buildPaletteRows({ query: '' }).filter((r) => r.kind === 'tool').length;
    expect(listed + PALETTE_UNRUNNABLE_ACTIONS.size).toBe(TOOL_REGISTRY.length);
  });
});

describe('Phase 59 item 10 — the tab-overflow DOM contract', () => {
  const sheet = readFileSync('src/renderer/styles.css', 'utf8');

  function blockFor(selector: string): string {
    const at = sheet.indexOf(selector);
    expect(at, selector).toBeGreaterThan(-1);
    return sheet.slice(at, sheet.indexOf('}', at));
  }

  // jsdom has no layout engine, so stub `clientWidth` to give the strip a real
  // measured width. The measure effect then plans the overflow on mount and
  // writes the custom properties onto the DOM.
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const hadOwnClientWidth = Object.prototype.hasOwnProperty.call(proto, 'clientWidth');
  const originalClientWidth = hadOwnClientWidth
    ? Object.getOwnPropertyDescriptor(proto, 'clientWidth')
    : undefined;

  beforeEach((): void => {
    Object.defineProperty(proto, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement): number {
        // Only the strip is given a width; everything else keeps jsdom's 0.
        return this.classList?.contains('tab-list') ? 700 : 0;
      },
    });
  });

  afterEach((): void => {
    if (hadOwnClientWidth && originalClientWidth !== undefined) {
      Object.defineProperty(proto, 'clientWidth', originalClientWidth);
    } else {
      delete proto.clientWidth;
    }
    document.body.innerHTML = '';
  });

  /** Mount the header with `count` tabs in the colorful style (natural 200,
   *  floor 132). Width 700 forces the extreme-overflow regime: every tab pins
   *  at the 132px floor and the plan stacks them with a negative overlap. */
  function renderOverflowHeader(count: number): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const tabs = Array.from({ length: count }, (_, i) => ({
      id: `t${i}`,
      title: `doc-${i}.pdf`,
      modified: false,
    }));
    act((): void => {
      root.render(
        <AppHeader
          activeId="t0"
          tabs={tabs}
          onActivate={(): void => undefined}
          onClose={(): void => undefined}
          theme="frosted"
          onThemeChange={(): void => undefined}
          onNewEmptyTab={(): void => undefined}
          onOpenPreferences={(): void => undefined}
          tabStyle="colorful"
        />,
      );
    });
    return container;
  }

  it('the tab width rides --tf-tab-width on .tab-list and the .tab consumes it', () => {
    const host = renderOverflowHeader(16);
    const list = host.querySelector<HTMLElement>('.tab-list');
    expect(list?.style.getPropertyValue('--tf-tab-width')).toBe('132px');
    // The width custom property is consumed by the real `.tab` elements
    // (selector matches the DOM: `.tab` is the rendered tab surface).
    expect(blockFor('.tab {')).toContain('width: var(--tf-tab-width');
    for (const tab of host.querySelectorAll('.tab')) {
      expect(tab.classList.contains('tab')).toBe(true);
    }
  });

  it('the negative overlap reaches the DOM: every tab after the first carries --tf-tab-overlap on its <li>', () => {
    const host = renderOverflowHeader(16);
    // The real siblings in `.tab-list` are the <li> wrappers, not the `.tab`s.
    const tabItems = [...host.querySelectorAll<HTMLElement>('.tab-list > li')].filter(
      (li) => li.querySelector('.tab') !== null,
    );
    expect(tabItems).toHaveLength(16);

    // The first tab never overlaps the tab "before" it.
    expect(tabItems[0].style.getPropertyValue('--tf-tab-overlap')).toBe('');
    // Every later tab carries the plan's negative overlap inline.
    for (const li of tabItems.slice(1)) {
      const raw = li.style.getPropertyValue('--tf-tab-overlap');
      expect(raw, li.getAttribute('data-animated-tab') ?? '').not.toBe('');
      expect(parseFloat(raw), raw).toBeLessThan(0);
    }
    // 16 tabs, 700px available, floor 132, gap 2 ->
    // (16*132 + 15*2 - 700) / 15 = 96.1333px.
    expect(parseFloat(tabItems[1].style.getPropertyValue('--tf-tab-overlap'))).toBeCloseTo(-96.1333, 3);
  });

  it('the "+" new-tab <li> never carries the overlap (it is never pulled under a tab)', () => {
    const host = renderOverflowHeader(16);
    const newTabItem = host.querySelector<HTMLElement>('.tab-list-new');
    expect(newTabItem).not.toBeNull();
    expect(newTabItem?.style.getPropertyValue('--tf-tab-overlap')).toBe('');
    // ...and the new-tab control itself is still a button, not a `.tab`.
    expect(newTabItem?.querySelector('[data-new-tab]')).not.toBeNull();
  });

  it('the consuming selector matches the RENDERED tree (the dead .tab + .tab rule is gone)', () => {
    // DEF-420 regression guard: the old selector can never match wrapped tabs.
    expect(sheet).not.toContain('.tab + .tab {');
    expect(sheet).toContain('.tab-list > li:not(:first-child) > .tab');
    // Prove the selector's structure is real: every `.tab` is a direct child of
    // an <li> that is itself a direct child of `.tab-list`.
    const host = renderOverflowHeader(4);
    const tabs = [...host.querySelectorAll<HTMLElement>('.tab')];
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) {
      expect(tab.parentElement?.tagName).toBe('LI');
      expect(tab.parentElement?.parentElement?.classList.contains('tab-list')).toBe(true);
    }
  });

  it('the active tab paints above its overlapping neighbour (z-index 2)', () => {
    expect(blockFor('.tab-active {')).toContain('z-index: 2');
  });

  it('width and margin animate with the shared motion token (no hardcoded duration)', () => {
    const block = blockFor('.tab {');
    expect(block).toMatch(/width var\(--motion-normal\)/);
    expect(block).toMatch(/margin-left var\(--motion-normal\)/);
  });

  it("keeps the strip's own scroll contract (DEF-324) intact", () => {
    expect(blockFor('.tab-list {')).toMatch(/overflow-x:\s*auto/);
    expect(blockFor('.tab-list {')).toMatch(/width:\s*100%/);
  });
});


describe('Phase 59 item 10 — planTabOverflow', () => {
  it('fits: every tab keeps its natural width, no overlap', () => {
    const natural = 200;
    const count = 3;
    const gap = TAB_GAP;
    const exactly = count * natural + (count - 1) * gap;
    expect(
      planTabOverflow({ count, naturalWidth: natural, availableWidth: exactly, floor: 132 }),
    ).toEqual({ width: natural, overlap: 0 });
    expect(
      planTabOverflow({
        count,
        naturalWidth: natural,
        availableWidth: exactly + 500,
        floor: 132,
      }),
    ).toEqual({ width: natural, overlap: 0 });
  });

  it('overflow: shrinks uniformly toward the floor with no overlap yet', () => {
    const plan = planTabOverflow({
      count: 4,
      naturalWidth: 200,
      availableWidth: 700,
      floor: 132,
    });
    expect(plan.overlap).toBe(0);
    expect(plan.width).toBeLessThan(200);
    expect(plan.width).toBeGreaterThanOrEqual(132);
    // (700 - 3*2) / 4
    expect(plan.width).toBeCloseTo(173.5, 5);
  });

  it('extreme overflow: the width pins at the floor and the tabs stack', () => {
    const plan = planTabOverflow({
      count: 6,
      naturalWidth: 200,
      availableWidth: 700,
      floor: 132,
    });
    expect(plan.width).toBe(132);
    expect(plan.overlap).toBeGreaterThan(0);
    // (6*132 + 5*2 - 700) / 5
    expect(plan.overlap).toBeCloseTo(20.4, 5);
  });

  it('never shrinks below the floor and never overlaps a tab away', () => {
    const plan = planTabOverflow({
      count: 12,
      naturalWidth: 200,
      availableWidth: 200,
      floor: 132,
    });
    expect(plan.width).toBe(132);
    const maxOverlap = 132 + TAB_GAP - TAB_MIN_PITCH;
    expect(plan.overlap).toBeLessThanOrEqual(maxOverlap);
    // A sliver of every tab (the ACTIVE one included) stays visible: the pitch
    // never falls below the minimum.
    const pitch = plan.width + TAB_GAP - plan.overlap;
    expect(pitch).toBeGreaterThanOrEqual(TAB_MIN_PITCH);
    expect(plan.overlap).toBeLessThan(plan.width);
  });

  it('a single tab shrinks to the space it has, never below the floor', () => {
    expect(planTabOverflow({ count: 1, naturalWidth: 200, availableWidth: 90, floor: 132 })).toEqual({
      width: 132,
      overlap: 0,
    });
    expect(planTabOverflow({ count: 1, naturalWidth: 200, availableWidth: 150, floor: 132 })).toEqual({
      width: 150,
      overlap: 0,
    });
    expect(planTabOverflow({ count: 1, naturalWidth: 200, availableWidth: 400, floor: 132 })).toEqual({
      width: 200,
      overlap: 0,
    });
  });

  it('no tabs: the natural plan, nothing to stack', () => {
    expect(planTabOverflow({ count: 0, naturalWidth: 200, availableWidth: 500, floor: 132 })).toEqual({
      width: 200,
      overlap: 0,
    });
  });

  it('exposes natural/floor metrics for both tab styles', () => {
    expect(TAB_OVERFLOW_METRICS.colorful).toEqual({ natural: 180, floor: 132 });
    expect(TAB_OVERFLOW_METRICS.standard.floor).toBeLessThan(TAB_OVERFLOW_METRICS.colorful.floor);
  });
});
