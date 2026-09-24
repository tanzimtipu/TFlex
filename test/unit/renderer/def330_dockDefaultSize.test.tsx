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
import type { Stage } from '../../../src/renderer/state/stages';

/** The live default-window geometry (ADV-081). */
const CANVAS = 914;
const PAGE_W = 154.45;
const ZOOM_W = 225.8;

/** The four curated stages' labels, in registry order. */
const STAGE_LABELS: Record<Stage, string[]> = {
  pages: ['Rotate pages', 'Extract pages', 'Insert pages', 'Replace pages', 'Split pages', 'Delete pages'],
  edit: ['Edit content', 'Edit text', 'Edit images', 'Add a text box', 'Recognize text (OCR)', 'Crop pages'],
  review: ['Annotate', 'Sign', 'Stamp', 'Flatten'],
  deliver: ['Reduce file size', 'Audit space usage', 'Export pages as images', 'Export text', 'Export to Word (.docx)'],
};

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
function mountDock(hostWidth: number, stage: Stage): { dock: HTMLElement; unmount: () => void } {
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

  it('fits all four curated stages labelled in ONE row at the default size', () => {
    const band = freeBand().width;
    for (const stage of ['pages', 'edit', 'review', 'deliver'] as const) {
      const { dock, unmount } = mountDock(CANVAS, stage);
      try {
        const labels = [...dock.querySelectorAll('.action-dock-label')];
        expect(dock.getAttribute('data-dock-icon-only'), stage).toBe('false');
        expect(labels.map((el) => el.textContent), stage).toEqual(STAGE_LABELS[stage]);
        expect(labels.length, stage).toBe(STAGE_LABELS[stage].length);
        // One row: the labelled width fits the band the dock actually has, so
        // nothing wraps (the cap is published for the probe).
        expect(Number(dock.getAttribute('data-dock-free-band')), stage).toBe(Math.round(band));
        expect(dock.getAttribute('data-dock-band-placed'), stage).toBe('true');
        expect(Number(dock.getAttribute('data-dock-band')), stage).toBe(Math.round(band));
        expect(labelledDockNeed(STAGE_LABELS[stage]), stage).toBeLessThanOrEqual(band);
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

  it('the tightened verb metrics fit DELIVER one-row in the live band', () => {
    const css = readFileSync(resolve(__dirname, '../../../src/renderer/styles.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    // The dock verb's horizontal padding and the group gap are the only lever
    // that can fit DELIVER's five REAL labels in the 493.75px band (the pills
    // are fixed geometry): the live probe's per-label widths sum to 390px, and
    // 390 + 5*(2*pad) + 4*gap + dock padding(16) + border(2) must be <= 493.75.
    expect(css).toMatch(/\.action-dock-verb\s*\{[^}]*padding:\s*4px 7px/s);
    expect(css).toMatch(/\.action-dock-group\s*\{[^}]*gap:\s*3px/s);
    const liveLabelWidths = [67, 79, 102, 46, 96]; // qa's ADV-081 probe (DELIVER)
    const verbs = liveLabelWidths.reduce((sum, w) => sum + Math.max(16, w) + 2 * 7, 0);
    const realDockWidth = verbs + 4 * 3 + 2 * 8 + 2;
    expect(realDockWidth).toBeLessThanOrEqual(freeBand().width);
    // ...and the pre-fix metrics (9px padding, 4px gap) did NOT fit, which is
    // why DELIVER wrapped onto two rows.
    const wideVerbs = liveLabelWidths.reduce((sum, w) => sum + Math.max(16, w) + 2 * 9, 0);
    expect(wideVerbs + 4 * 4 + 2 * 8 + 2).toBeGreaterThan(freeBand().width);
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
      // A labelled DELIVER dock still clears each pill by the gap.
      const half = labelledDockNeed(STAGE_LABELS.deliver) / 2;
      const centre = CANVAS / 2 + shift;
      expect(centre - half).toBeGreaterThanOrEqual(pill('page', CANVAS).right + DOCK_PILL_GAP - 0.01);
      expect(centre + half).toBeLessThanOrEqual(pill('zoom', CANVAS).left - DOCK_PILL_GAP + 0.01);
    } finally {
      unmount();
    }
  });

  it('stays labelled at 1100px and yields only where the labels genuinely do not fit', () => {
    for (const stage of ['pages', 'edit', 'review', 'deliver'] as const) {
      const wide = mountDock(1100, stage);
      try {
        expect(wide.dock.getAttribute('data-dock-icon-only'), `1100 ${stage}`).toBe('false');
      } finally {
        wide.unmount();
      }
    }
    // 900px canvas: 479.75px of band. DELIVER's five wide verbs (491.6px) no
    // longer fit, so it yields â€” genuinely narrow, not a threshold artifact.
    for (const stage of ['pages', 'edit', 'review'] as const) {
      const medium = mountDock(900, stage);
      try {
        expect(medium.dock.getAttribute('data-dock-icon-only'), `900 ${stage}`).toBe('false');
      } finally {
        medium.unmount();
      }
    }
    const narrowDeliver = mountDock(900, 'deliver');
    try {
      expect(narrowDeliver.dock.getAttribute('data-dock-icon-only')).toBe('true');
      expect(labelledDockNeed(STAGE_LABELS.deliver)).toBeGreaterThan(900 - 174.45 - 237.8 - 16);
    } finally {
      narrowDeliver.unmount();
    }
  });

  it('keeps the narrow-width behaviour: icon-only under 900px, `...` chip when compact', () => {
    const small = mountDock(899, 'review');
    try {
      expect(small.dock.getAttribute('data-dock-icon-only')).toBe('true');
      expect(small.dock.querySelector('.action-dock-label')).toBeNull();
    } finally {
      small.unmount();
    }
    const compact = mountDock(640, 'pages');
    try {
      // Under the 900px break the labels are gone and the compact plan starts
      // collapsing the tail into the `...` chip (DEF-313/315, unchanged).
      expect(compact.dock.getAttribute('data-dock-icon-only')).toBe('true');
      expect(compact.dock.querySelector('[data-dock-overflow]')).not.toBeNull();
    } finally {
      compact.unmount();
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
