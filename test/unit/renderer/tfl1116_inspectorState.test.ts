// @vitest-environment jsdom
//
// TFL-1116 C11 (R17) — the Inspector's EXPLICIT state precedence.
//
// R17: entering Edit with Select showed "CROPBOX / Box" although no crop
// workflow was active. The fix resolves ONE explicit state (none / page /
// text / signature / crop / ocr-review / export) and gates the CropBox section
// on the actual crop session. This suite pins both the pure truth table and the
// rendered contract, so an empty CropBox can never return to the default Edit.
//
// Deliberately a `.ts` file: it renders through `createElement` (no JSX), so it
// matches the exact path the chunk brief names.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Inspector,
  inspectorSections,
  inspectorSectionsForState,
  resolveInspectorState,
} from '../../../src/renderer/components/Inspector';
import type { InspectorProps } from '../../../src/renderer/components/Inspector';
import { defaultTextStyleValues } from '../../../src/renderer/edit/textStyle';

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(props: InspectorProps): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  act((): void => {
    root.render(createElement(Inspector, props));
  });
  roots.push(root);
  hosts.push(host);
  return host;
}

beforeEach((): void => {
  roots = [];
  hosts = [];
});

afterEach((): void => {
  const rs = roots;
  const hs = hosts;
  roots = [];
  hosts = [];
  for (const root of rs) act((): void => root.unmount());
  for (const h of hs) h.remove();
  document.body.innerHTML = '';
});

const textPanel = {
  open: true,
  values: defaultTextStyleValues('Helvetica'),
  defaults: defaultTextStyleValues('Helvetica'),
  onPatch: vi.fn(),
  mode: 'text' as const,
  text: 'Hello',
};

function state(host: HTMLElement): string | null {
  return host.querySelector('[data-inspector]')?.getAttribute('data-inspector-state') ?? null;
}

describe('R17 — resolveInspectorState precedence (pure)', () => {
  it('an open OCR review wins over every stage/selection', () => {
    expect(
      resolveInspectorState({
        stage: 'edit',
        selection: { kind: 'page', page: 1 },
        cropActive: true,
        ocrSuspectsOpen: true,
      }),
    ).toBe('ocr-review');
  });

  it('an active crop session wins over a page selection', () => {
    expect(
      resolveInspectorState({ stage: 'edit', selection: { kind: 'page', page: 1 }, cropActive: true }),
    ).toBe('crop');
  });

  it('a selected object resolves text / signature', () => {
    expect(resolveInspectorState({ stage: 'edit', selection: { kind: 'text' } })).toBe('text');
    expect(resolveInspectorState({ stage: 'review', selection: { kind: 'signature' } })).toBe(
      'signature',
    );
  });

  it('the Deliver stage resolves the export surface', () => {
    expect(resolveInspectorState({ stage: 'deliver', selection: { kind: 'page', page: 2 } })).toBe(
      'export',
    );
  });

  it('a plain page selection resolves page facts; nothing is none', () => {
    expect(resolveInspectorState({ stage: 'edit', selection: { kind: 'page', page: 3 } })).toBe('page');
    expect(resolveInspectorState({ stage: 'pages', selection: { kind: 'none' } })).toBe('none');
  });

  it('inspectorSections: EDIT + page is page facts now, NEVER a bare cropbox', () => {
    expect(inspectorSections('edit', 'page')).toEqual(['page', 'document']);
    expect(inspectorSectionsForState('crop', 'edit')).toEqual(['cropbox']);
    // The rest of the per-stage contract is unchanged.
    expect(inspectorSections('pages', 'page')).toEqual(['page', 'on-page', 'document']);
    expect(inspectorSections('review', 'signature')).toEqual(['signature']);
    expect(inspectorSections('deliver', 'none')).toEqual(['export', 'document']);
  });
});

describe('R17 — the rendered Inspector', () => {
  it('default Edit with no selection does NOT render the CropBox section', () => {
    const host = mount({ stage: 'edit', selection: { kind: 'none' }, pageCount: 3 });
    expect(state(host)).toBe('none');
    expect(host.querySelector('[data-inspector-section="cropbox"]')).toBeNull();
  });

  it('a page selection in Edit shows page facts + guidance, not a CropBox', () => {
    const host = mount({
      stage: 'edit',
      selection: { kind: 'page', page: 1 },
      pageCount: 3,
      pageSize: { widthPt: 612, heightPt: 792 },
    });
    expect(state(host)).toBe('page');
    expect(host.querySelector('[data-inspector-section="page"]')).not.toBeNull();
    expect(host.querySelector('[data-inspector-section="cropbox"]')).toBeNull();
    expect(host.querySelector('[data-inspector-edit-guidance]')).not.toBeNull();
  });

  it('an active crop session shows Crop bounds with units', () => {
    const host = mount({
      stage: 'edit',
      selection: { kind: 'page', page: 1 },
      cropActive: true,
      cropBox: { x: 10.4, y: 20.6, width: 300.2, height: 400.9 },
    });
    expect(state(host)).toBe('crop');
    expect(host.querySelector('[data-inspector-section="cropbox"]')).not.toBeNull();
    expect(host.querySelector('[data-inspector-row="cropbox-x"]')?.textContent).toContain('10 pt');
    expect(host.querySelector('[data-inspector-row="cropbox-units"]')?.textContent).toContain('pt');
  });

  it('OCR review shows suspects and suppresses the stage sections', () => {
    const host = mount({
      stage: 'edit',
      selection: { kind: 'page', page: 1 },
      ocrSuspects: { suspects: [], hasRun: true, onNavigate: vi.fn(), onClose: vi.fn() },
    });
    expect(state(host)).toBe('ocr-review');
    expect(host.querySelector('[data-inspector-section="ocr-suspects"]')).not.toBeNull();
    expect(host.querySelector('[data-inspector-section="cropbox"]')).toBeNull();
  });

  it('a text selection shows its properties', () => {
    const host = mount({ stage: 'edit', selection: { kind: 'text' }, textPanel });
    expect(state(host)).toBe('text');
    expect(host.querySelector('[data-inspector-text-panel]')).not.toBeNull();
    expect(host.querySelector('[data-inspector-section="cropbox"]')).toBeNull();
  });
});
