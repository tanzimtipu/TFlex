// @vitest-environment jsdom
//
// Phase 41 (item 2) — the legacy EDIT toolbar is RETIRED.
//
// Criterion 3: the legacy edit toolbar is absent from the DOM in EDIT, and
// EVERY control it offered has a home (dock / Inspector / Ctrl+K palette) with
// its action still runnable. This suite pins:
//   1. the `[data-edit-toolbar]` marker and its `.edit-toolbar*` stylesheet are
//      gone from the whole renderer source (no render path can emit them);
//   2. the four tool modes — off/text/box/image — are the EDIT dock's verbs;
//   3. the Default font control has a real home in the EDIT ContextPanel and
//      fires the host's existing `onEditDefaultFontChange`.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextPanel } from '../../../src/renderer/components/ContextPanel';
import { dockToolsForStage, toolById } from '../../../src/renderer/state/toolsRegistry';
import { PALETTE_INTERACTIVE_ONLY } from '../../../src/renderer/state/commandPalette';
import type { EngineState } from '../../../src/renderer/engine/types';

const RENDERER = resolve(__dirname, '../../../src/renderer');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('Phase 41 item 2 — the legacy EDIT toolbar is gone', () => {
  it('no renderer source emits [data-edit-toolbar] and no stylesheet defines .edit-toolbar', () => {
    const offenders: string[] = [];
    for (const file of walk(RENDERER)) {
      if (file.endsWith('EditToolbar.tsx')) offenders.push(`file survives: ${file}`);
      const text = readFileSync(file, 'utf8');
      if (text.includes('data-edit-toolbar')) offenders.push(`marker in ${file}`);
      if (/\.edit-toolbar[\s,:{]/.test(text)) offenders.push(`selector in ${file}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
    expect(existsSync(join(RENDERER, 'edit/EditToolbar.tsx'))).toBe(false);
  });

  it('the four legacy tool modes are EDIT dock verbs (off/text/box/image)', () => {
    const ids = dockToolsForStage('edit').map((entry) => entry.id);
    for (const id of ['editToolOff', 'editText', 'editTextBox', 'editImage']) {
      expect(ids, `${id} must ride the EDIT dock`).toContain(id);
      expect(toolById(id)?.surface, `${id} surface`).toBe('dock');
    }
    // The exact action each control runs (the same handlers the toolbar called).
    expect(toolById('editToolOff')?.action).toBe('editToolOff');
    expect(toolById('editText')?.action).toBe('editToolText');
    expect(toolById('editTextBox')?.action).toBe('editToolBox');
    expect(toolById('editImage')?.action).toBe('editToolImage');
  });

  it('the Default font capability has a panel home (palette copy names it)', () => {
    expect(toolById('editDefaultFont')?.surface).toBe('panel');
    expect(PALETTE_INTERACTIVE_ONLY.editDefaultFont).toMatch(/Edit panel/i);
  });
});

const STUB_ENGINE = {
  pageCount: 1,
  pageOrder: [0],
  rotations: {},
  deleted: [],
  pageLabels: [],
  annotations: [],
} as unknown as EngineState;

function mount(el: ReturnType<typeof createElement>): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(el);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

describe('Phase 41 item 2 — Default font control in the EDIT ContextPanel', () => {
  it('renders the picker and fires the existing change handler', () => {
    const onChange = vi.fn();
    const { host, unmount } = mount(
      createElement(ContextPanel, {
        stage: 'edit',
        doc: {} as never,
        currentPage: 1,
        defaultWidthPt: 612,
        defaultHeightPt: 792,
        engineState: STUB_ENGINE,
        canUndo: false,
        onJump: vi.fn(),
        outline: null,
        editDefaultFont: 'Helvetica',
        onEditDefaultFontChange: onChange,
      }),
    );
    try {
      const select = host.querySelector<HTMLSelectElement>('[data-edit-default-font]');
      expect(select, 'Default font picker must render in the EDIT panel').not.toBeNull();
      expect(Array.from(select?.options ?? []).map((o) => o.value)).toEqual([
        'Helvetica',
        'Times',
        'Courier',
      ]);
      act((): void => {
        if (select !== null) {
          select.value = 'Times';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      expect(onChange).toHaveBeenCalledWith('Times');
    } finally {
      unmount();
    }
  });

  it('the picker is disabled (never a silent no-op) when the host wires no handler', () => {
    const { host, unmount } = mount(
      createElement(ContextPanel, {
        stage: 'edit',
        doc: {} as never,
        currentPage: 1,
        defaultWidthPt: 612,
        defaultHeightPt: 792,
        engineState: STUB_ENGINE,
        canUndo: false,
        onJump: vi.fn(),
        outline: null,
        editDefaultFont: 'Helvetica',
      }),
    );
    try {
      expect(host.querySelector<HTMLSelectElement>('[data-edit-default-font]')?.disabled).toBe(true);
    } finally {
      unmount();
    }
  });
});
