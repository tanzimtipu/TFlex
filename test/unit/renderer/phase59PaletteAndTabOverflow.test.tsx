// @vitest-environment jsdom
//
// Phase 59 (items 7 and 10), repointed by Phase 72 (items 7-8).
//
// item 7 — the Ctrl+K palette must not list dead rows. A registry entry whose
// `action` has no command anywhere (a panel control, a pointer interaction, a
// per-item list) is REMOVED from the corpus. Rows that remain keep the DEF-327
// behaviour: a live gate that refuses them renders them disabled with the dock
// refusal copy.
//
// item 10 — Phase 72 RETIRED the stack/overlap regime. The tab strip keeps ONE
// row by SHRINKING every tab UNIFORMLY: `planTabOverflow` always returns
// `overlap === 0` and the uniform width never exceeds the natural width. TFL-213
// (DEF-441) corrected the lower bound: the width is the LARGEST value that still
// fits `count * width + (count - 1) * gap <= available`, so it may drop below the
// 56px / 24px compactness thresholds (down to 0) when the strip is crowded. The
// strip is no longer a scroll container, so this file pins the pure plan, the
// rendered `--tf-tab-width` contract, and the absence of the retired overlap
// machinery from the source.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
  HARD_MIN_TAB_WIDTH,
  MIN_TAB_WIDTH,
  TAB_GAP,
  TAB_OVERFLOW_METRICS,
  planTabOverflow,
  tabFitAvailableWidth,
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

describe('Phase 59 item 10 / Phase 72 items 7-8 — the tab-overflow DOM contract', () => {
  const sheet = readFileSync('src/renderer/styles.css', 'utf8');
  const headerSource = readFileSync('src/renderer/components/AppHeader.tsx', 'utf8');
  const tabSource = readFileSync('src/renderer/components/AnimatedTab.tsx', 'utf8');

  function blockFor(selector: string): string {
    const at = sheet.indexOf(selector);
    expect(at, selector).toBeGreaterThan(-1);
    return sheet.slice(at, sheet.indexOf('}', at));
  }

  // jsdom has no layout engine, so stub `clientWidth` to give the strip a real
  // measured width. The measure effect then plans the overflow on mount and
  // writes the custom property onto the DOM.
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

  /** Mount the header with `count` colorful tabs (natural 180, floor 56).
   *  Width 700 forces the overflow regime: the TFL-209 trailing-gap reserve
   *  leaves 698px for the tabs, so every one takes the SAME uniform fit width
   *  ((698 - 15*2) / 16 = 41.75px). */
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

  it('the uniform fit width rides --tf-tab-width on .tab-list and the .tab consumes it', () => {
    const host = renderOverflowHeader(16);
    const list = host.querySelector<HTMLElement>('.tab-list');
    // TFL-209 reserves the trailing gap: (700 - 2 - 15*2) / 16 = 41.75px,
    // above HARD_MIN_TAB_WIDTH.
    expect(list?.style.getPropertyValue('--tf-tab-width')).toBe('41.75px');
    expect(blockFor('.tab {')).toContain('width: var(--tf-tab-width');
    for (const tab of host.querySelectorAll('.tab')) {
      expect(tab.classList.contains('tab')).toBe(true);
    }
  });

  it('every tab is the SAME width: no tab ever writes a per-tab overlap', () => {
    const host = renderOverflowHeader(16);
    const tabItems = [...host.querySelectorAll<HTMLElement>('.tab-list > li')].filter(
      (li) => li.querySelector('.tab') !== null,
    );
    expect(tabItems).toHaveLength(16);
    for (const li of tabItems) {
      expect(li.style.getPropertyValue('--tf-tab-overlap'), li.getAttribute('data-animated-tab') ?? '').toBe('');
    }
  });

  it('the retired stack rule and the overlap write are absent from the source', () => {
    expect(sheet).not.toContain('.tab-list > li:not(:first-child) > .tab');
    expect(sheet).not.toContain('--tf-tab-overlap');
    expect(headerSource).not.toContain('--tf-tab-overlap');
    expect(tabSource).not.toContain('--tf-tab-overlap');
  });

  it("the strip never scrolls: .tab-list is overflow:hidden with no scrollbar rule", () => {
    expect(blockFor('.tab-list {')).toMatch(/overflow:\s*hidden/);
    expect(blockFor('.tab-list {')).not.toMatch(/overflow-x:\s*auto/);
    expect(sheet).not.toContain('.tab-list::-webkit-scrollbar');
    expect(blockFor('.tab-list {')).toMatch(/width:\s*100%/);
  });

  it('the colorful tab no longer pins min-width/max-width so the fit width applies', () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab {');
    expect(block).not.toContain('min-width: 132px');
    expect(block).not.toContain('max-width: 200px');
    expect(block).toContain('width: var(--tf-tab-width, 180px)');
  });

  it('the "+" new-tab <li> never carries an overlap', () => {
    const host = renderOverflowHeader(16);
    const newTabItem = host.querySelector<HTMLElement>('.tab-list-new');
    expect(newTabItem).not.toBeNull();
    expect(newTabItem?.style.getPropertyValue('--tf-tab-overlap')).toBe('');
    expect(newTabItem?.querySelector('[data-new-tab]')).not.toBeNull();
  });

  it('the active tab paints above its neighbours (z-index 2)', () => {
    expect(blockFor('.tab-active {')).toContain('z-index: 2');
  });

  it('width animates with the shared motion token (no hardcoded duration)', () => {
    expect(blockFor('.tab {')).toMatch(/width var\(--motion-normal\)/);
  });
});


describe('Phase 59 item 10 / Phase 72 item 7 — planTabOverflow', () => {
  it('fits: every tab keeps its natural width, no overlap', () => {
    const natural = 200;
    const count = 3;
    const gap = TAB_GAP;
    const exactly = count * natural + (count - 1) * gap;
    expect(
      planTabOverflow({ count, naturalWidth: natural, availableWidth: exactly, floor: MIN_TAB_WIDTH }),
    ).toEqual({ width: natural, overlap: 0 });
    expect(
      planTabOverflow({
        count,
        naturalWidth: natural,
        availableWidth: exactly + 500,
        floor: MIN_TAB_WIDTH,
      }),
    ).toEqual({ width: natural, overlap: 0 });
  });

  it('overflow: shrinks uniformly to the fit invariant, always zero overlap', () => {
    const count = 4;
    const availableWidth = 700;
    const plan = planTabOverflow({
      count,
      naturalWidth: 200,
      availableWidth,
      floor: MIN_TAB_WIDTH,
    });
    expect(plan.overlap).toBe(0);
    expect(plan.width).toBeLessThan(200);
    // TFL-213 (DEF-441): the fit invariant, never a clamp up to a hard floor.
    expect(count * plan.width + (count - 1) * TAB_GAP).toBeLessThanOrEqual(availableWidth);
    // (700 - 3*2) / 4
    expect(plan.width).toBeCloseTo(173.5, 5);
  });

  it('10 tabs at a squeezed width: the uniform row fits and never overlaps', () => {
    const count = 10;
    const natural = 200;
    const availableWidth = 900;
    const plan = planTabOverflow({ count, naturalWidth: natural, availableWidth, floor: MIN_TAB_WIDTH });
    expect(plan.overlap).toBe(0);
    // The Phase 72 item 8 invariant: count*width + (count-1)*gap <= available.
    expect(count * plan.width + (count - 1) * TAB_GAP).toBeLessThanOrEqual(availableWidth);
    expect(plan.width).toBeGreaterThanOrEqual(0);
    expect(plan.width).toBeLessThanOrEqual(natural);
  });

  it('always satisfies the fit invariant for every count', () => {
    for (let count = 1; count <= 40; count += 1) {
      const availableWidth = 640;
      const plan = planTabOverflow({
        count,
        naturalWidth: 180,
        availableWidth,
        floor: MIN_TAB_WIDTH,
      });
      expect(plan.overlap, `count ${count}`).toBe(0);
      expect(
        count * plan.width + (count - 1) * TAB_GAP,
        `count ${count}: fit invariant`,
      ).toBeLessThanOrEqual(availableWidth);
      expect(plan.width, `count ${count}`).toBeGreaterThanOrEqual(0);
      expect(plan.width, `count ${count}`).toBeLessThanOrEqual(180);
    }
  });

  it('never returns a positive overlap for any tab count', () => {
    for (let count = 0; count <= 30; count += 1) {
      expect(planTabOverflow({ count, naturalWidth: 200, availableWidth: 120, floor: MIN_TAB_WIDTH }).overlap).toBe(0);
    }
  });

  it('a single tab shrinks to the space it has, fit invariant below the floor included', () => {
    // TFL-213 (DEF-441): the fit wins even for one tab, so the width may go
    // BELOW the compactness floor rather than overflow the strip.
    expect(planTabOverflow({ count: 1, naturalWidth: 200, availableWidth: 40, floor: MIN_TAB_WIDTH })).toEqual({
      width: 40,
      overlap: 0,
    });
    expect(planTabOverflow({ count: 1, naturalWidth: 200, availableWidth: 150, floor: MIN_TAB_WIDTH })).toEqual({
      width: 150,
      overlap: 0,
    });
    expect(planTabOverflow({ count: 1, naturalWidth: 200, availableWidth: 400, floor: MIN_TAB_WIDTH })).toEqual({
      width: 200,
      overlap: 0,
    });
  });

  it('no tabs: the natural plan, nothing to shrink', () => {
    expect(planTabOverflow({ count: 0, naturalWidth: 200, availableWidth: 500, floor: MIN_TAB_WIDTH })).toEqual({
      width: 200,
      overlap: 0,
    });
  });

  it('exposes the Phase 72 metrics and the corrected fit contract', () => {
    expect(TAB_OVERFLOW_METRICS.colorful).toEqual({ natural: 180, floor: MIN_TAB_WIDTH });
    expect(MIN_TAB_WIDTH).toBe(56);
    expect(HARD_MIN_TAB_WIDTH).toBe(24);
    // TFL-213 (DEF-441) — those thresholds are compactness references only; the
    // fit invariant wins, so a crowded strip may take a width below BOTH.
    const tight = planTabOverflow({
      count: 32,
      naturalWidth: 180,
      availableWidth: 640,
      floor: MIN_TAB_WIDTH,
    });
    expect(tight.width).toBeLessThan(MIN_TAB_WIDTH);
    expect(tight.width).toBeLessThan(HARD_MIN_TAB_WIDTH);
    expect(32 * tight.width + 31 * TAB_GAP).toBeLessThanOrEqual(640);
    // The standard style silhouette/sizing is untouched by Phase 72.
    expect(TAB_OVERFLOW_METRICS.standard).toEqual({ natural: 168, floor: 96 });
  });
});

describe('TFL-209 — the trailing tab gap is reserved so scrollWidth <= clientWidth', () => {
  it('subtracts the strip padding, the "+" and exactly ONE trailing gap', () => {
    // The CSS draws `margin-right: TAB_GAP` on EVERY `.tab`, the last included,
    // so the caller must reserve one gap beyond the plan's (count - 1) gaps.
    expect(
      tabFitAvailableWidth({
        clientWidth: 640,
        paddingLeft: 8,
        paddingRight: 4,
        plusWidth: 36,
      }),
    ).toBe(640 - 8 - 4 - 36 - TAB_GAP);
  });

  it('makes the plan include the rendered trailing margin (observed 1656 case)', () => {
    const clientWidth = 1656;
    const plus = 36;
    const count = 16;
    const natural = TAB_OVERFLOW_METRICS.colorful.natural;
    const fitWidth = tabFitAvailableWidth({
      clientWidth,
      paddingLeft: 0,
      paddingRight: 0,
      plusWidth: plus,
    });
    const plan = planTabOverflow({ count, naturalWidth: natural, availableWidth: fitWidth, floor: MIN_TAB_WIDTH });
    // The rendered content is count tabs + a margin on EACH + the "+".
    const rendered = count * plan.width + count * TAB_GAP + plus;
    expect(rendered, `rendered ${rendered} <= clientWidth ${clientWidth}`).toBeLessThanOrEqual(clientWidth);
    // Without the trailing-gap reservation this is exactly the old off-by-one.
    const planNoGap = planTabOverflow({
      count,
      naturalWidth: natural,
      availableWidth: fitWidth + TAB_GAP,
      floor: MIN_TAB_WIDTH,
    });
    const renderedNoGap = count * planNoGap.width + count * TAB_GAP + plus;
    expect(renderedNoGap).toBeGreaterThan(clientWidth);
  });

  it('lands exactly on clientWidth at the 640px minimum (observed 156 case)', () => {
    const clientWidth = 156;
    const plus = 36;
    const count = 3;
    const fitWidth = tabFitAvailableWidth({
      clientWidth,
      paddingLeft: 0,
      paddingRight: 0,
      plusWidth: plus,
    });
    const plan = planTabOverflow({
      count,
      naturalWidth: TAB_OVERFLOW_METRICS.colorful.natural,
      availableWidth: fitWidth,
      floor: MIN_TAB_WIDTH,
    });
    expect(count * plan.width + count * TAB_GAP + plus).toBe(clientWidth);
  });

  it('the caller passes the reserved width (source pin)', () => {
    const source = readFileSync('src/renderer/components/AppHeader.tsx', 'utf8');
    expect(source).toContain('tabFitAvailableWidth({');
    expect(source).not.toContain('availableWidth: available - plus,');
  });
});
