// @vitest-environment jsdom
//
// DEF-327 — the Command Palette must present a verb as runnable only when it
// really is. The palette and the Action Dock show the same registry entries, so
// they share ONE availability gate: the pane publishes the pair the dock
// consumes (`isToolEnabled` + `disabledReasonFor`) and the palette's rows use
// it, which is what stops "Undo" on an empty stack, the edit-layer tools with
// Edit mode off and the Multi-Mode-only pane verbs from being silent no-ops.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { DocumentView } from '../../../src/renderer/components/DocumentView';
import { CommandPalette } from '../../../src/renderer/components/CommandPalette';
import type { EngineState } from '../../../src/renderer/engine/types';
import {
  dockAvailabilityFor,
  type DockAvailability,
} from '../../../src/renderer/state/dockModel';
import { PALETTE_ACTION_REASONS, paletteDisabledReasonFor, paletteRowState } from '../../../src/renderer/state/commandPalette';
import { toolById } from '../../../src/renderer/state/toolsRegistry';

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  g.IntersectionObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  g.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  const proto = Element.prototype as unknown as { scrollTo?: unknown };
  proto.scrollTo ??= (): void => undefined;
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void> } => ({ promise: Promise.resolve() }),
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
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

interface ViewHarness {
  availability: DockAvailability;
  commands: Record<string, () => void>;
  unmount: () => void;
}

/** Mount DocumentView and read back what it publishes to the host. */
async function mountView(canUndo: boolean, editModeOpen = false): Promise<ViewHarness> {
  stubObservers();
  const harness: { availability: DockAvailability | null; commands: Record<string, () => void> } = {
    availability: null,
    commands: {},
  };
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async (): Promise<void> => {
    root.render(
      createElement(DocumentView, {
        doc: makeDocStub(3),
        pageCount: 3,
        outline: null,
        initial: {
          zoomMode: 'fit-width',
          manualScale: 1,
          currentPage: 1,
          searchOpen: false,
          query: '',
          activeHitIndex: -1,
        },
        onPersist: (): void => undefined,
        onDiagnostics: (): void => undefined,
        engineState: makeEngineState(3),
        canUndo,
        canRedo: canUndo,
        editModeOpen,
        onEditModeToggle: (): void => undefined,
        saveInPlaceEnabled: false,
        annotations: [],
        formFields: [],
        signatures: [],
        savedSignatures: [],
        stampAnnotations: [],
        activeStage: 'edit',
        registerViewCommands: (commands): void => {
          harness.commands = commands ?? {};
        },
        registerDockAvailability: (availability): void => {
          harness.availability = availability;
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    get availability(): DockAvailability {
      if (harness.availability === null) throw new Error('the view published no availability');
      return harness.availability;
    },
    get commands(): Record<string, () => void> {
      return harness.commands;
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const GATE_ARGS = {
  pageSelectionCount: 0,
  editModeOpen: false,
  canUndo: false,
  canRedo: false,
  viewActions: {},
} as const;

function entry(id: string): NonNullable<ReturnType<typeof toolById>> {
  const found = toolById(id);
  if (found === undefined) throw new Error(`unknown tool ${id}`);
  return found;
}

describe('DEF-327 — one availability gate for the dock and the palette', () => {
  it('disables the edit-layer tools until Edit mode is on', () => {
    for (const id of ['editText', 'editTextBox', 'editImage']) {
      expect(dockAvailabilityFor(entry(id), GATE_ARGS), id).toBe(false);
      expect(
        dockAvailabilityFor(entry(id), { ...GATE_ARGS, editModeOpen: true }),
        id,
      ).toBe(true);
    }
    // `editMode` itself IS the control that turns Edit mode on (DEF-314).
    expect(
      dockAvailabilityFor(entry('editMode'), {
        ...GATE_ARGS,
        viewActions: { editModeToggle: (): void => undefined },
      }),
    ).toBe(true);
  });

  it('disables undo/redo on an empty stack and the pane verbs outside Multi Mode', () => {
    expect(dockAvailabilityFor(entry('undo'), GATE_ARGS)).toBe(false);
    expect(dockAvailabilityFor(entry('redo'), GATE_ARGS)).toBe(false);
    expect(dockAvailabilityFor(entry('undo'), { ...GATE_ARGS, canUndo: true })).toBe(true);
    expect(dockAvailabilityFor(entry('redo'), { ...GATE_ARGS, canRedo: true })).toBe(true);
    // paneOpen/paneClear are host-level: this pane does not govern them, so the
    // verdict is `undefined` and the host's own gate decides (Multi Mode off).
    expect(dockAvailabilityFor(entry('paneOpen'), GATE_ARGS)).toBeUndefined();
    expect(dockAvailabilityFor(entry('paneClear'), GATE_ARGS)).toBeUndefined();
  });

  it('resolves what this pane governs and defers everything else', () => {
    expect(dockAvailabilityFor(entry('clearPageSelection'), GATE_ARGS)).toBe(false);
    expect(
      dockAvailabilityFor(entry('clearPageSelection'), { ...GATE_ARGS, pageSelectionCount: 2 }),
    ).toBe(true);
    expect(dockAvailabilityFor(entry('zoomIn'), GATE_ARGS)).toBeUndefined();
    expect(
      dockAvailabilityFor(entry('zoomIn'), {
        ...GATE_ARGS,
        viewActions: { zoomIn: (): void => undefined },
      }),
    ).toBe(true);
    // A dock-hosted app verb asks the App's own gate.
    let appCalled = 0;
    expect(
      dockAvailabilityFor(entry('recognizeText'), {
        ...GATE_ARGS,
        appEnabled: (): boolean => {
          appCalled += 1;
          return true;
        },
      }),
    ).toBe(true);
    expect(appCalled).toBe(1);
    // ...and without one it is unavailable rather than a silent no-op.
    expect(dockAvailabilityFor(entry('recognizeText'), GATE_ARGS)).toBe(false);
  });

  it('explains a disabled row with the dock s own copy, then the shared action copy', () => {
    const editText = entry('editText');
    const withPaneReason = {
      isToolEnabled: (e: typeof editText): boolean => dockAvailabilityFor(e, GATE_ARGS) === true,
      disabledReasonFor: (e: typeof editText): string | undefined =>
        e.action.startsWith('editTool') ? 'Turn on Edit content first' : undefined,
    };
    expect(paletteRowState(editText, withPaneReason)).toEqual({
      enabled: false,
      reason: 'Turn on Edit content first',
    });
    expect(
      paletteDisabledReasonFor({ entry: editText, paneReason: withPaneReason.disabledReasonFor }),
    ).toBe('Turn on Edit content first');
    expect(
      paletteDisabledReasonFor({ entry: entry('undo'), actionReasons: PALETTE_ACTION_REASONS }),
    ).toBe('Nothing to undo');
    expect(
      paletteDisabledReasonFor({ entry: entry('paneOpen'), actionReasons: PALETTE_ACTION_REASONS }),
    ).toBe('Turn on Multi Mode first');
    // No live copy at all: the row falls back to the registry availability.
    expect(paletteDisabledReasonFor({ entry: entry('open') })).toBeUndefined();
    // An interactive-only entry keeps its own copy (never the availability one).
    expect(paletteRowState(entry('pageThumbnails'), withPaneReason)).toEqual({
      enabled: false,
      reason: 'Switch to the Pages panel to use this',
    });
  });
});

describe('DEF-327 — the palette renders the pane gate s verdict', () => {
  it('publishes the dock s gate from the focused view and disables the no-op rows', async () => {
    const view = await mountView(false);
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    const onRunTool = vi.fn();
    const onClose = vi.fn();
    const gate = view.availability;
    // Exactly the pair App wires: the pane s verdict + copy, then the shared
    // per-action copy, then the registry s declared availability.
    const reasonFor = (e: Parameters<typeof gate.disabledReasonFor>[0]): string | undefined =>
      paletteDisabledReasonFor({
        entry: e,
        paneReason: gate.disabledReasonFor,
        actionReasons: PALETTE_ACTION_REASONS,
      });
    await act(async (): Promise<void> => {
      root.render(
        createElement(CommandPalette, {
          open: true,
          onClose,
          onRunTool,
          onPinTool: (): void => undefined,
          isToolEnabled: (e): boolean => gate.isToolEnabled(e) === true,
          disabledReasonFor: reasonFor,
        }),
      );
    });
    try {
      const row = (id: string): HTMLElement | null =>
        host.querySelector<HTMLElement>(`[data-palette-tool-id="${id}"]`);
      // Edit mode is OFF: the three edit tools are disabled, with the dock copy.
      for (const id of ['editText', 'editTextBox', 'editImage']) {
        const el = row(id);
        expect(el, id).not.toBeNull();
        expect(el?.getAttribute('data-palette-disabled'), id).toBe('true');
        expect(el?.getAttribute('title'), id).toBe('Turn on Edit content first');
        await act(async (): Promise<void> => {
          el?.click();
        });
      }
      // An empty undo stack: disabled, never a silent no-op.
      expect(row('undo')?.getAttribute('data-palette-disabled')).toBe('true');
      expect(row('undo')?.getAttribute('title')).toBe('Nothing to undo');
      expect(onRunTool).not.toHaveBeenCalled();

      // Edit mode ON: a fresh view (the prop is host state) publishes the SAME
      // rows as runnable, and reopening the palette presents that current
      // availability (the rows rebuild on `open`, never a stale verdict).
      const withEdit = await mountView(false, true);
      expect(withEdit.availability.isToolEnabled(entry('editText'))).toBe(true);
      const draw = (open: boolean): void => {
        root.render(
          createElement(CommandPalette, {
            open,
            onClose,
            onRunTool,
            onPinTool: (): void => undefined,
            isToolEnabled: (e): boolean => withEdit.availability.isToolEnabled(e) === true,
            disabledReasonFor: (e): string | undefined =>
              paletteDisabledReasonFor({
                entry: e,
                paneReason: withEdit.availability.disabledReasonFor,
                actionReasons: PALETTE_ACTION_REASONS,
              }),
          }),
        );
      };
      await act(async (): Promise<void> => {
        draw(false);
      });
      await act(async (): Promise<void> => {
        draw(true);
      });
      expect(row('editText')?.getAttribute('data-palette-disabled')).toBe('false');
      await act(async (): Promise<void> => {
        row('editText')?.click();
      });
      expect(onRunTool).toHaveBeenCalledWith('editText');
      withEdit.unmount();
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
      view.unmount();
    }
  });

  it('withdraws the published gate on unmount', async () => {
    stubObservers();
    const published: (DockAvailability | null)[] = [];
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    await act(async (): Promise<void> => {
      root.render(
        createElement(DocumentView, {
          doc: makeDocStub(2),
          pageCount: 2,
          outline: null,
          initial: {
            zoomMode: 'fit-width',
            manualScale: 1,
            currentPage: 1,
            searchOpen: false,
            query: '',
            activeHitIndex: -1,
          },
          onPersist: (): void => undefined,
          onDiagnostics: (): void => undefined,
          engineState: makeEngineState(2),
          canUndo: false,
          annotations: [],
          formFields: [],
          signatures: [],
          savedSignatures: [],
          stampAnnotations: [],
          registerDockAvailability: (availability): void => {
            published.push(availability);
          },
        }),
      );
      await Promise.resolve();
    });
    act((): void => {
      root.unmount();
    });
    host.remove();
    expect(published[0]).not.toBeNull();
    expect(published.at(-1)).toBeNull();
  });
});
