// @vitest-environment jsdom
//
// Phase 36 (chunk 6) — the Inspector's LIVE selections.
//
// The Inspector component and its per-selection sections already existed; the
// gap was the HOST wiring. These tests pin the pure mapping the host uses
// (`inspectorSelectionFor` / `inspectorTextPanelFor`), that the mapped props
// reach the real sections (a text object and an armed signature), and the
// source seams: the DocumentView publishes its text selection up and App
// threads it into the Inspector.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Inspector,
  inspectorSelectionFor,
  inspectorTextPanelFor,
} from '../../../src/renderer/components/Inspector';
import type { InspectorProps, InspectorTextSelection } from '../../../src/renderer/components/Inspector';
import { defaultTextStyleValues } from '../../../src/renderer/edit/textStyle';

const ROOT = resolve(__dirname, '../../..');

function textSnapshot(overrides: Partial<InspectorTextSelection> = {}): InspectorTextSelection {
  const values = defaultTextStyleValues('Helvetica');
  return {
    targetKey: 'box:box-1',
    name: 'Text object',
    values,
    defaults: values,
    mode: 'text',
    text: 'Hello world',
    onPatch: vi.fn(),
    onTextChange: vi.fn(),
    onTextCommit: vi.fn(),
    focusToken: 1,
    ...overrides,
  };
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

const slots = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>('[data-inspector-slot]')].map(
    (el) => el.getAttribute('data-inspector-slot') ?? '',
  );

describe('Phase 36 chunk 6 — the host mapping helpers', () => {
  it('resolves a text object in EDIT or the annotate (REVIEW) flow, a signature in REVIEW, else the page', () => {
    const text = textSnapshot();
    expect(
      inspectorSelectionFor({ stage: 'edit', text, signatureLabel: null, page: 4 }),
    ).toEqual({ kind: 'text', name: 'Text object' });
    expect(
      inspectorSelectionFor({ stage: 'review', text: null, signatureLabel: 'Ada', page: 4 }),
    ).toEqual({ kind: 'signature', name: 'Ada' });
    // Phase 37 (item 1) — the annotate flow (REVIEW) shows the text panel too.
    expect(
      inspectorSelectionFor({ stage: 'review', text, signatureLabel: null, page: 4 }),
    ).toEqual({ kind: 'text', name: 'Text object' });
    expect(
      inspectorSelectionFor({ stage: 'edit', text: null, signatureLabel: 'Ada', page: 4 }),
    ).toEqual({ kind: 'page', page: 4 });
    expect(
      inspectorSelectionFor({ stage: 'pages', text, signatureLabel: 'Ada', page: 7 }),
    ).toEqual({ kind: 'page', page: 7 });
  });

  it('maps the snapshot onto the text panel props (and null stays null)', () => {
    expect(inspectorTextPanelFor(null)).toBeNull();
    const text = textSnapshot();
    const panel = inspectorTextPanelFor(text);
    expect(panel).not.toBeNull();
    expect(panel?.open).toBe(true);
    expect(panel?.mode).toBe('text');
    expect(panel?.text).toBe('Hello world');
    expect(panel?.values).toBe(text.values);
    expect(panel?.onPatch).toBe(text.onPatch);
    expect(panel?.onTextChange).toBe(text.onTextChange);
    expect(panel?.onTextCommit).toBe(text.onTextCommit);
  });
});

describe('Phase 36 chunk 6 — the real selected object reaches the Inspector', () => {
  it('EDIT + a live text object renders its ACTUAL text and routes edits back', () => {
    const patch = vi.fn();
    const change = vi.fn();
    const text = textSnapshot({ onPatch: patch, onTextChange: change });
    const { host, unmount } = mount({
      stage: 'edit',
      selection: inspectorSelectionFor({ stage: 'edit', text, signatureLabel: null, page: 1 }),
      textPanel: inspectorTextPanelFor(text),
    });
    try {
      // Phase 37 (item 1) — the panel is the top block; the document facts are
      // the sections below it.
      expect(slots(host)).toEqual(['document']);
      expect(host.querySelector('[data-inspector-text-panel]')).not.toBeNull();
      expect(host.querySelector('[data-inspector-divider]')).not.toBeNull();
      expect(host.querySelector('.glass-sidebar-title')?.textContent).toBe('Inspector · Text object');
      const ta = host.querySelector<HTMLTextAreaElement>('[data-txt-text]');
      expect(ta?.value).toBe('Hello world');
      // A style control routes through the VIEW's handler, not a copy.
      const bold = host.querySelector<HTMLButtonElement>('[data-txt-bold]');
      act((): void => {
        bold?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(patch).toHaveBeenCalledWith({ bold: true });
    } finally {
      unmount();
    }
  });

  it('a null snapshot leaves the Inspector on the page/document fallback', () => {
    const { host, unmount } = mount({
      stage: 'edit',
      selection: inspectorSelectionFor({ stage: 'edit', text: null, signatureLabel: null, page: 2 }),
      textPanel: inspectorTextPanelFor(null),
    });
    try {
      expect(slots(host)).toEqual(['cropbox']);
      expect(host.querySelector('[data-inspector-text-panel]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('REVIEW + an armed signature shows its real style and placement hint', () => {
    const { host, unmount } = mount({
      stage: 'review',
      selection: inspectorSelectionFor({
        stage: 'review',
        text: null,
        signatureLabel: 'Ada Lovelace',
        page: 1,
      }),
      signatureStyle: 'Drawn',
      signatureHint: 'Click a page to place',
    });
    try {
      expect(slots(host)).toEqual(['signature']);
      expect(host.querySelector('.glass-sidebar-title')?.textContent).toBe(
        'Inspector · Ada Lovelace',
      );
      expect(host.querySelector('[data-inspector-row="signature-style"]')?.textContent).toContain(
        'Drawn',
      );
      expect(host.querySelector('[data-inspector-row="signature-hint"]')?.textContent).toContain(
        'Click a page to place',
      );
    } finally {
      unmount();
    }
  });
});

describe('Phase 36 chunk 6 — the wiring seams (source)', () => {
  const app = readFileSync(resolve(ROOT, 'src/renderer/App.tsx'), 'utf8');
  const docView = readFileSync(
    resolve(ROOT, 'src/renderer/components/DocumentView.tsx'),
    'utf8',
  );

  it('the DocumentView publishes its live text selection up', () => {
    expect(docView).toContain('onTextSelectionChange?: (selection: InspectorTextSelection | null) => void;');
    expect(docView).toContain('onTextSelectionChangeRef.current?.(textSelection)');
    // Withdraw on unmount so the host never shows a stale object.
    expect(docView).toContain('onTextSelectionChangeRef.current?.(null)');
  });

  it('App mirrors the snapshot and feeds the Inspector the mapped props', () => {
    expect(app).toContain('setInspectorTextSelection');
    expect(app).toContain('onTextSelectionChange={');
    expect(app).toContain('selection={inspectorSelection}');
    expect(app).toContain('textPanel={inspectorTextPanel}');
    expect(app).toContain('inspectorSelectionFor(');
    expect(app).toContain('inspectorTextPanelFor(');
    expect(app).toContain('signatureStyle=');
    expect(app).toContain('signatureHint=');
  });
});
