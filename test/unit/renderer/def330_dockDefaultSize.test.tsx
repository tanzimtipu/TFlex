// @vitest-environment jsdom
//
// DEF-330 â€” at the app's DEFAULT maximised window the Action Dock must render as
// designed: labelled, one row, for all four stages. It used to wrap DELIVER onto
// two rows and to drop every label from PAGES/EDIT, because the symmetric
// pill-reserve doubled the WIDER pill's offset and charged the dock for slack
// the other side never used, and because the labelled width was estimated with
// a per-verb constant that cannot tell DELIVER's five wide verbs from PAGES' six
// narrow ones.
//
// The live geometry these tests use is the app's own (qa's ADV-081 probe,
// 1442x903 maximised: canvas host 914px, page pill 154.45px, zoom pill
// 225.80px, both inset 12px).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { ActionDock, type ActionDockProps } from '../../../src/renderer/components/ActionDock';
import {
  DOCK_PILL_GAP,
  DOCK_PILL_INSET,
  labelledDockNeed,
  pillFreeBand,
  type PillBox,
} from '../../../src/renderer/state/dockFit';
import {
  DOCK_SHORT_LABELS,
  dockPrimaryIdsForStage,
} from '../../../src/renderer/state/toolsRegistry';
import type { Stage } from '../../../src/renderer/state/stages';

/** The live default-window geometry (ADV-081). */
const CANVAS = 914;
const PAGE_W = 154.45;
const ZOOM_W = 225.8;

/** Phase 104 (chunk 2) — the dock's CURATED PRIMARY sets, as rendered. The
 *  visible tile label is the short form (`DOCK_SHORT_LABELS`); the remaining
 *  stage verbs live in the stable More menu. At the default-window band these
 *  curated sets FIT as a plain labelled row; the ladder hides labels only below
 *  880px. Derived from the registry so the test can never drift from the dock. */
const DOCK_LABELS: Record<Stage, string[]> = {
  pages: dockPrimaryIdsForStage('pages').map((id) => DOCK_SHORT_LABELS[id] ?? id),
  edit: dockPrimaryIdsForStage('edit').map((id) => DOCK_SHORT_LABELS[id] ?? id),
  review: dockPrimaryIdsForStage('review').map((id) => DOCK_SHORT_LABELS[id] ?? id),
  deliver: dockPrimaryIdsForStage('deliver').map((id) => DOCK_SHORT_LABELS[id] ?? id),
};

/** Phase 104 (chunk 2) — the dock charges the trailing Tools slot in its label
 *  budget (`DOCK_EDIT_SLOT`), so the arrows prediction mirrors it. */
const EDIT_SLOT = 26;

function boxOf(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: (): Record<string, never> => ({}),
  } as DOMRect;
}

function pill(name: 'page' | 'zoom', hostWidth: number): PillBox {
  const width = name === 'page' ? PAGE_W : ZOOM_W;
  const left = name === 'page' ? DOCK_PILL_INSET : hostWidth - DOCK_PILL_INSET - width;
  return { left, right: left + width, top: 850, bottom: 891, width, height: 41 };
}

/** Mount the dock with the two pills stubbed to the live default geometry. */
function mountDock(
  hostWidth: number,
  stage: Stage,
  options: Partial<ActionDockProps> = {},
): { dock: HTMLElement; unmount: () => void } {
  const host = document.createElement('div');
  host.style.position = 'relative';
  document.body.appendChild(host);
  const page = document.createElement('div');
  page.setAttribute('data-page-pill', '');
  const zoom = document.createElement('div');
  zoom.setAttribute('data-zoom-pill', '');
  host.append(page, zoom);
  const pageBox = pill('page', hostWidth);
  const zoomBox = pill('zoom', hostWidth);
  host.getBoundingClientRect = (): DOMRect => boxOf(0, 0, hostWidth, 900);
  page.getBoundingClientRect = (): DOMRect =>
    boxOf(pageBox.left, pageBox.top, pageBox.right, pageBox.bottom);
  zoom.getBoundingClientRect = (): DOMRect =>
    boxOf(zoomBox.left, zoomBox.top, zoomBox.right, zoomBox.bottom);

  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const root = createRoot(mount);
  const props: ActionDockProps = {
    activeStage: stage,
    pageSelection: [],
    onClearPageSelection: vi.fn(),
    bulk: { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() },
    dockPins: [],
    onPinTool: vi.fn(),
    onUnpinTool: vi.fn(),
    onRunTool: vi.fn(),
    canvasWidth: hostWidth,
    ...options,
  };
  act((): void => {
    root.render(createPortal(<ActionDock {...props} />, host));
  });
  const dock = host.querySelector<HTMLElement>('[data-action-dock]');
  if (dock === null) throw new Error('the dock did not mount');
  return {
    dock,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
      mount.remove();
    },
  };
}

const freeBand = (): { left: number; width: number } =>
  pillFreeBand({ page: pill('page', CANVAS), zoom: pill('zoom', CANVAS), hostLeft: 0 });

describe('DEF-330 â€” the dock renders as designed at the default window', () => {
  it('derives the pill-free band from the two measured pills', () => {
    const band = freeBand();
    // 154.45 + 12 + 8 = 174.45; 914 - 166.45 - 237.8 - 16 = 493.75.
    expect(band.left).toBeCloseTo(174.45, 1);
    expect(band.width).toBeCloseTo(493.75, 1);
    // The old symmetric reserve left only 422px here (DEF-315's measured band).
    expect(CANVAS - (2 * (DOCK_PILL_INSET + ZOOM_W) + 2 * DOCK_PILL_GAP)).toBeCloseTo(422.4, 1);
  });

  it('renders ONE ROW with every label at the default size (arrows lane when the band cannot fit)', () => {
    const band = freeBand().width;
    for (const stage of ['pages', 'edit', 'review', 'deliver'] as const) {
      const { dock, unmount } = mountDock(CANVAS, stage);
      try {
        const labels = [
          ...dock.querySelectorAll('[data-dock-group="primary"] .action-dock-label'),
        ];
        // The band-placed geometry is unchanged.
        expect(dock.getAttribute('data-dock-band-placed'), stage).toBe('true');
        expect(Number(dock.getAttribute('data-dock-free-band')), stage).toBe(Math.round(band));
        expect(Number(dock.getAttribute('data-dock-band')), stage).toBe(Math.round(band));
        // DEF-334 — the 880 rung owns the labels; at the default window (914)
        // the curated PRIMARY set stays labelled, and the stable More control
        // hosts the displaced verbs (never a label drop).
        expect(dock.getAttribute('data-dock-icon-only'), stage).toBe('false');
        expect(labels.map((el) => el.textContent), stage).toEqual(DOCK_LABELS[stage]);
        expect(
          dock.getAttribute('data-dock-arrows'),
          stage,
        ).toBe(labelledDockNeed(DOCK_LABELS[stage]) + EDIT_SLOT > band ? 'true' : 'false');
        expect(dock.querySelector('[data-dock-overflow]'), stage).not.toBeNull();
        // ALWAYS one row: at most the primary group + the pins group.
        expect(dock.querySelectorAll('[data-dock-group]').length, stage).toBeLessThanOrEqual(2);
      } finally {
        unmount();
      }
    }
  });

  it('places the dock explicitly in the pill-free band, not the host half', () => {
    const { dock, unmount } = mountDock(CANVAS, 'deliver');
    try {
      const band = freeBand();
      // The band-placed state: the dock's insets are the band's own, so its
      // available width is the whole band (the old `left: 50%` gave it only the
      // host's right half - 457px - and wrapped the labelled verbs).
      expect(dock.getAttribute('data-dock-band-placed')).toBe('true');
      expect(Number(dock.getAttribute('data-dock-band'))).toBe(Math.round(band.width));
      expect(Number.parseFloat(dock.style.getPropertyValue('--dock-band-left'))).toBeCloseTo(
        band.left,
        1,
      );
      expect(Number.parseFloat(dock.style.getPropertyValue('--dock-band-right'))).toBeCloseTo(
        CANVAS - band.left - band.width,
        1,
      );
      // The inline cap is the band, and the band is larger than the half the
      // old `left: 50%` allowed.
      expect(Number.parseFloat(dock.style.maxWidth)).toBeCloseTo(band.width, 1);
      expect(band.width).toBeGreaterThan(CANVAS / 2);
    } finally {
      unmount();
    }
  });

  it('uses the enlarged verb metrics; a set wider than the band routes to arrows, never a label drop', () => {
    const css = readFileSync(resolve(__dirname, '../../../src/renderer/styles.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    // Phase 38 (feature B) — the dock verb now carries the 20px glyph and the
    // 12px label floor: 5px/8px padding and the 3px group gap are the declared
    // metrics (up from the Phase-37 4px/7px).
    expect(css).toMatch(/\.action-dock-verb\s*\{[^}]*padding:\s*5px 8px/s);
    expect(css).toMatch(/\.action-dock-group\s*\{[^}]*gap:\s*3px/s);
    // Phase 104 (chunk 2) — the CURATED primary DELIVER set now FITS the
    // 493.75px band as a plain labelled row (the displaced verbs moved into the
    // stable More menu), so no arrows lane is needed at the default window.
    expect(labelledDockNeed(DOCK_LABELS.deliver) + EDIT_SLOT).toBeLessThan(freeBand().width);
  });

  it('the stylesheet places the dock in the band with left/right + margin auto', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../src/renderer/styles.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(
      /\.action-dock\[data-dock-band-placed='true'\]\s*\{[^}]*left:\s*var\(--dock-band-left/s,
    );
    expect(css).toMatch(
      /\.action-dock\[data-dock-band-placed='true'\]\s*\{[^}]*right:\s*var\(--dock-band-right/s,
    );
    expect(css).toMatch(
      /\.action-dock\[data-dock-band-placed='true'\]\s*\{[^}]*width:\s*max-content/s,
    );
    expect(css).toMatch(
      /\.action-dock\[data-dock-band-placed='true'\]\s*\{[^}]*margin-inline:\s*auto/s,
    );
  });

  it('parks the dock at the centre of the free band, clear of both pills', () => {
    const { dock, unmount } = mountDock(CANVAS, 'deliver');
    try {
      const band = freeBand();
      expect(Number.parseFloat(dock.style.maxWidth)).toBeCloseTo(band.width, 1);
      const shift = Number.parseFloat(dock.style.getPropertyValue('--dock-shift'));
      expect(shift).toBeCloseTo(band.left + band.width / 2 - CANVAS / 2, 1);
      // The shift is the difference between the band's centre and the host's.
      expect(shift).toBeLessThan(0);
      // Phase 38 (feature B) — the labelled DELIVER set is now WIDER than the
      // band, so the dock is capped to the band and routed to the arrows lane;
      // the clearance contract is the band's own edges (clearance-exclusive),
      // which sit inside both pills by DOCK_PILL_GAP.
      expect(band.left).toBeGreaterThanOrEqual(pill('page', CANVAS).right + DOCK_PILL_GAP - 0.01);
      expect(band.left + band.width).toBeLessThanOrEqual(
        pill('zoom', CANVAS).left - DOCK_PILL_GAP + 0.01,
      );
      expect(Number.parseFloat(dock.style.maxWidth)).toBeCloseTo(band.width, 1);
    } finally {
      unmount();
    }
  });

  it('stays labelled everywhere above the 880 rung, routing to arrows where the band is tight', () => {
    // Phase 104 (chunk 2) — the curated primary sets are narrow enough to fit
    // even a tight band, so the labelled row stays plain (no arrows) while the
    // displaced verbs ride the stable More menu. DEF-334 still keeps the labels
    // above the 880 rung.
    const wideBand = 1100 - (DOCK_PILL_INSET + PAGE_W + DOCK_PILL_GAP) - (DOCK_PILL_INSET + ZOOM_W + DOCK_PILL_GAP);
    for (const stage of ['pages', 'edit', 'review', 'deliver'] as const) {
      const wide = mountDock(1100, stage);
      try {
        expect(wide.dock.getAttribute('data-dock-icon-only'), `1100 ${stage}`).toBe('false');
        expect(
          wide.dock.querySelectorAll('[data-dock-group="primary"] .action-dock-label').length,
          `1100 ${stage}`,
        ).toBe(DOCK_LABELS[stage].length);
        expect(wide.dock.getAttribute('data-dock-arrows'), `1100 ${stage}`).toBe(
          labelledDockNeed(DOCK_LABELS[stage]) + EDIT_SLOT > wideBand ? 'true' : 'false',
        );
      } finally {
        wide.unmount();
      }
    }
    // 900px canvas leaves ~479.75px: the curated sets still fit, and 900 is
    // ABOVE the 880 rung, so the labels stay as a plain row.
    const mediumBand = 900 - (DOCK_PILL_INSET + PAGE_W + DOCK_PILL_GAP) - (DOCK_PILL_INSET + ZOOM_W + DOCK_PILL_GAP);
    for (const stage of ['pages', 'edit', 'review', 'deliver'] as const) {
      const medium = mountDock(900, stage);
      try {
        expect(
          labelledDockNeed(DOCK_LABELS[stage]) + EDIT_SLOT,
          `900 need ${stage}`,
        ).toBeLessThan(mediumBand);
        expect(medium.dock.getAttribute('data-dock-icon-only'), `900 ${stage}`).toBe('false');
        expect(
          medium.dock.querySelectorAll('[data-dock-group="primary"] .action-dock-label').length,
          `900 ${stage}`,
        ).toBe(DOCK_LABELS[stage].length);
        expect(medium.dock.getAttribute('data-dock-arrows'), `900 ${stage}`).toBe('false');
      } finally {
        medium.unmount();
      }
    }
  });

  it('hides labels only below the 880 rung; the compact lane above it is the arrows', () => {
    // 899 is above the 880 rung: the labels stay (the old host-width 900
    // threshold is not the authority). The measured host is inside the
    // icon-only zone (899 < 900), so the still-labelled row routes to arrows.
    const above = mountDock(899, 'review');
    try {
      expect(above.dock.getAttribute('data-dock-icon-only')).toBe('false');
      expect(above.dock.querySelector('.action-dock-label')).not.toBeNull();
      expect(above.dock.getAttribute('data-dock-arrows')).toBe('true');
    } finally {
      above.unmount();
    }
    // 640 is below both rungs: icon-only, arrows present, one row.
    const below = mountDock(640, 'pages');
    try {
      expect(below.dock.getAttribute('data-dock-icon-only')).toBe('true');
      expect(below.dock.querySelector('.action-dock-label')).toBeNull();
      expect(below.dock.getAttribute('data-dock-arrows')).toBe('true');
    } finally {
      below.unmount();
    }
  });

  it('falls back to the symmetric band, unshifted, until the pills are measured', () => {
    const host = document.createElement('div');
    host.style.position = 'relative';
    document.body.appendChild(host);
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const root = createRoot(mount);
    act((): void => {
      root.render(
        <ActionDock
          activeStage="pages"
          pageSelection={[]}
          onClearPageSelection={vi.fn()}
          bulk={{ onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() }}
          dockPins={[]}
          onPinTool={vi.fn()}
          onUnpinTool={vi.fn()}
          onRunTool={vi.fn()}
          canvasWidth={CANVAS}
        />,
      );
    });
    const dock = mount.querySelector<HTMLElement>('[data-action-dock]');
    expect(dock).not.toBeNull();
    // No pills to measure: the reserve fallback caps the dock and the geometry
    // stays exactly as it was before DEF-330 (host centre, no shift).
    expect(Number.parseFloat(dock?.style.maxWidth ?? '')).toBe(CANVAS - 476);
    expect(dock?.getAttribute('data-dock-free-band')).toBeNull();
    expect(dock?.getAttribute('data-dock-band-placed')).toBeNull();
    expect(Number.parseFloat(dock?.style.getPropertyValue('--dock-shift') ?? '')).toBe(0);
    act((): void => {
      root.unmount();
    });
    mount.remove();
    host.remove();
  });
});
