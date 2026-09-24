// @vitest-environment jsdom
//
// Phase 37 chunk 4 — the Inspector (operator items 1, 3, 5, 10, 22).
//
// These tests pin the Phase 37 Feature A contract:
//   - item 1: the text-manipulation block leads the Inspector column in BOTH
//     flows, split from the stage sections by a subtle divider, with the whole
//     column as the one scroller (no nested scrollbar).
//   - item 5: flush geometry (no rounded left corner, no gap) and one
//     expand/collapse control wired to the host, with the `user || rung`
//     precedence rule.
//   - item 10: professional affordance sizing (pixel targets).
//   - item 22: subtle separators between distinct rows in the Inspector and
//     in the left ContextPanel sections.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Inspector } from '../../../src/renderer/components/Inspector';
import type { InspectorProps } from '../../../src/renderer/components/Inspector';
import { collapsePreferenceAfterToggle, inspectorCollapsedFor, resolveDockLadder } from '../../../src/renderer/state/dockResponsive';
import { defaultTextStyleValues } from '../../../src/renderer/edit/textStyle';

const CSS = readFileSync(
  resolve(__dirname, '../../../src/renderer/styles.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bodies: string[] = [];
  const needle = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = needle.exec(CSS)) !== null) bodies.push(m[1]);
  return bodies.join('\n');
}

function mount(props: InspectorProps): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(createElement(Inspector, props));
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

const textPanel = {
  open: true,
  values: defaultTextStyleValues('Helvetica'),
  defaults: defaultTextStyleValues('Helvetica'),
  onPatch: vi.fn(),
  mode: 'text' as const,
  text: 'Hello',
};

describe('Phase 37 item 1 — the text panel leads the Inspector column', () => {
  it('renders the text block at the TOP, a divider, then the stage sections', () => {
    const { host, unmount } = mount({
      stage: 'edit',
      selection: { kind: 'text' },
      textPanel,
      pageCount: 7,
    });
    try {
      const body = host.querySelector('.inspector-body') as HTMLElement;
      const kids = [...body.children];
      expect(kids[0]?.getAttribute('data-inspector-text-panel')).not.toBeNull();
      expect(kids[1]?.getAttribute('data-inspector-divider')).not.toBeNull();
      // The stage's own content (the document facts) renders below.
      expect(kids[2]?.getAttribute('data-inspector-slot')).toBe('document');
      // The re-parented component's selectors survive.
      expect(host.querySelector('[data-text-panel]')).not.toBeNull();
      expect(host.querySelector('[data-txt-font]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it('also lifts the panel in the REVIEW/annotate flow with the sections below', () => {
    const { host, unmount } = mount({
      stage: 'review',
      selection: { kind: 'text' },
      textPanel,
      annotations: [],
    });
    try {
      const kids = [...(host.querySelector('.inspector-body') as HTMLElement).children];
      expect(kids[0]?.getAttribute('data-inspector-text-panel')).not.toBeNull();
      expect(kids[1]?.getAttribute('data-inspector-divider')).not.toBeNull();
      expect(kids[2]?.getAttribute('data-inspector-slot')).toBe('comments');
      expect(kids[3]?.getAttribute('data-inspector-slot')).toBe('annotations');
    } finally {
      unmount();
    }
  });

  it('the body is the ONE scroller and the inline panel never scrolls itself', () => {
    const body = ruleBody('.inspector .inspector-body');
    expect(body).toMatch(/overflow-y:\s*auto/);
    const inline = ruleBody('.inspector .inspector-body .text-props-panel');
    expect(inline).toMatch(/overflow:\s*visible/);
    expect(inline).toMatch(/max-height:\s*none/);
  });
});

describe('Phase 37 item 5 — flush geometry and one collapse control', () => {
  it('is flush: no rounded left corner and no shadow seam', () => {
    const rule = ruleBody('.inspector');
    expect(rule).toMatch(/border-radius:\s*0/);
    expect(rule).toMatch(/box-shadow:\s*none/);
    // DEF-333 — the panel is a child of `.app-main` (position: relative), whose
    // padding box starts at the caption line (44px), the same edge the canvas
    // and the left ContextPanel start at. `top: 0` is the correct
    // containing-block value; the retired command-row `--toolbar-h` offset must
    // not come back (it left the Inspector 52px below the canvas top).
    expect(rule).toMatch(/top:\s*0;/);
    expect(rule).not.toMatch(/top:\s*var\(--toolbar-h/);
    expect(rule).toMatch(/border-left:\s*1px solid var\(--panel-border\)/);
  });

  it('the collapsed strip keeps its own inset (never overlaps the canvas)', () => {
    const rule = ruleBody(".app-main[data-inspector-collapsed='true']");
    expect(rule).toMatch(/--tools-panel-w:\s*var\(--inspector-collapsed-w,\s*44px\)/);
    expect(rule).toMatch(/--tf-tools-inset:\s*var\(--tools-panel-w,\s*44px\)/);
  });

  it('renders one expand/collapse control in both states, wired to the host', () => {
    const onToggle = vi.fn();
    const expanded = mount({
      stage: 'pages',
      selection: { kind: 'none' },
      collapsed: false,
      onToggleCollapsed: onToggle,
    });
    try {
      expect(expanded.host.querySelectorAll('[data-inspector-collapse]')).toHaveLength(1);
      expect(expanded.host.querySelector('[data-inspector]')?.getAttribute('data-inspector-collapsed')).toBe('false');
      const btn = expanded.host.querySelector<HTMLButtonElement>('[data-inspector-collapse]');
      expect(btn?.getAttribute('aria-expanded')).toBe('true');
      act((): void => {
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(onToggle).toHaveBeenCalledTimes(1);
    } finally {
      expanded.unmount();
    }

    const collapsed = mount({
      stage: 'pages',
      selection: { kind: 'none' },
      collapsed: true,
      onToggleCollapsed: onToggle,
    });
    try {
      expect(collapsed.host.querySelectorAll('[data-inspector-collapse]')).toHaveLength(1);
      expect(collapsed.host.querySelector('[data-inspector-collapsed-strip]')).not.toBeNull();
      expect(collapsed.host.querySelector('.inspector-body')).toBeNull();
      const btn = collapsed.host.querySelector<HTMLButtonElement>('[data-inspector-collapse]');
      expect(btn?.getAttribute('aria-expanded')).toBe('false');
      act((): void => {
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(onToggle).toHaveBeenCalledTimes(2);
    } finally {
      collapsed.unmount();
    }
  });

  it('precedence is `user || rung`: the ladder never loses to a manual expand', () => {
    const wide = resolveDockLadder(1600);
    const narrow = resolveDockLadder(1100);
    expect(wide.inspectorCollapsed).toBe(false);
    expect(narrow.inspectorCollapsed).toBe(true);
    expect(inspectorCollapsedFor(false, wide)).toBe(false);
    expect(inspectorCollapsedFor(true, wide)).toBe(true);
    // A user's expand cannot override rung 1 while the ladder is engaged.
    expect(inspectorCollapsedFor(false, narrow)).toBe(true);
    expect(inspectorCollapsedFor(true, narrow)).toBe(true);
  });

  it('the host resolves the effective state and wires the one control (source seam)', () => {
    const app = readFileSync(
      resolve(__dirname, '../../../src/renderer/App.tsx'),
      'utf8',
    );
    expect(app).toContain('inspectorCollapsedFor(inspectorCollapsed, dockLadder)');
    // DEF-335 — the control records the intent its label shows, not a raw
    // toggle of the user preference.
    expect(app).toContain('collapsePreferenceAfterToggle(inspectorCollapsedEffective)');
    // The collapsed strip's inset target matches its CSS width.
    expect(app).toContain('INSPECTOR_COLLAPSED_W_PX');
  });
});

// ---------------------------------------------------------------------------
// DEF-335 — the Expand control records the expand intent while the ladder
// forces the collapse, so the surface reverses when the window grows.
// ---------------------------------------------------------------------------

describe('DEF-335 — the collapse control never latches the ladder collapse', () => {
  it('Inspector: one click at rung 1 records expand and expands at 1300', () => {
    const narrow = resolveDockLadder(1100);
    const wide = resolveDockLadder(1300);
    expect(narrow.inspectorCollapsed).toBe(true);
    expect(wide.inspectorCollapsed).toBe(false);
    // The control renders the EFFECTIVE state: collapsed, labelled "Expand".
    const effectiveCollapsed = inspectorCollapsedFor(false, narrow);
    expect(effectiveCollapsed).toBe(true);
    // One click records the expand intent (not `!userCollapsed`, which would
    // latch it to collapsed).
    const pref = collapsePreferenceAfterToggle(effectiveCollapsed);
    expect(pref).toBe(false);
    // Growing past the rung now leaves it expanded.
    expect(inspectorCollapsedFor(pref, wide)).toBe(false);
    // At the idle width the control still toggles both ways.
    const collapsedPref = collapsePreferenceAfterToggle(
      inspectorCollapsedFor(pref, wide),
    );
    expect(collapsedPref).toBe(true);
    expect(inspectorCollapsedFor(collapsedPref, wide)).toBe(true);
  });

  it('panel: one click at rung 2 records expand and expands at 1300', () => {
    const narrow = resolveDockLadder(900);
    const wide = resolveDockLadder(1300);
    expect(narrow.panelCollapsed).toBe(true);
    expect(wide.panelCollapsed).toBe(false);
    const effectiveCollapsed = false || narrow.panelCollapsed;
    const pref = collapsePreferenceAfterToggle(effectiveCollapsed);
    expect(pref).toBe(false);
    expect(pref || wide.panelCollapsed).toBe(false);
  });
});

describe('Phase 37 item 10 — professional affordance sizing', () => {
  it('the action buttons hit 28px with a legible 12px label', () => {
    const action = ruleBody('.inspector-action');
    expect(action).toMatch(/min-height:\s*28px/);
    expect(action).toMatch(/font-size:\s*var\(--fs-sm\)/);
    expect(action).toMatch(/padding:\s*4px 10px/);
    expect(action).toMatch(/border-radius:\s*var\(--radius-2\)/);
  });

  it('the inline link gets a comfortable target too', () => {
    const link = ruleBody('.inspector-link');
    expect(link).toMatch(/min-height:\s*24px/);
    expect(link).toMatch(/font-size:\s*var\(--fs-sm\)/);
  });
});

describe('Phase 37 item 22 — subtle separators', () => {
  it('separates inspector rows with the hairline divider token', () => {
    const rule = ruleBody('.inspector-section-body > * + *');
    expect(rule).toMatch(/border-top:\s*1px solid var\(--divider\)/);
  });

  it('separates ContextPanel blocks with the same hairline token', () => {
    const rule = ruleBody(
      '.context-panel-section > *:not(.context-panel-section-title) + *:not(.context-panel-section-title)',
    );
    expect(rule).toMatch(/border-top:\s*1px solid var\(--divider\)/);
  });

  it('uses tokens only (no hardcoded colours in the separator rules)', () => {
    const rule = ruleBody('.context-panel-section > *:not(.context-panel-section-title) + *:not(.context-panel-section-title)');
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rule).not.toMatch(/rgba?\(/);
  });
});