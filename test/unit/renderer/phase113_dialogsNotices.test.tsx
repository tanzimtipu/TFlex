// @vitest-environment jsdom
// Phase 113 (Quiet Actions) — migration wave F1: dialogs and the Command Palette.
//
// Pins the wave-F1 call sites onto the Phase 113 axes (`intent` / `kind` /
// `density`) via the chunk-B `Button` / `IconButton` primitive and the canonical
// class contract in docs/BUTTON-SYSTEM.md. Every assertion reads the shipped
// classes / ARIA the primitive emits; no behaviour (label, handler, data-* hook,
// role, aria state, disabled predicate) is re-derived here.
//
// DELIBERATE EXCEPTIONS — the crop editor mask / corner handles in
// CropPagesDialog.tsx are pointer-drag targets (`<div>`s), and the Command
// Palette's `role="option"` rows host a nested pin toggle, so they adopt the
// canonical classes without becoming a raw `<button>`; both are documented in
// docs/BUTTON-SYSTEM.md.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { AboutDialog } from "../../../src/renderer/components/AboutDialog";
import { AccountsDialog } from "../../../src/renderer/components/AccountsDialog";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";
import { CommandPalette } from "../../../src/renderer/components/CommandPalette";
import { SignatureManagerModal } from "../../../src/renderer/signatures/SignatureManagerModal";
import { DEFAULT_CONVERT_DEFAULTS } from "../../../src/shared/convert";
import type { AccountsAuthAdapter } from "../../../src/renderer/accounts/adapter";
import type { SyncReport } from "../../../src/shared/accounts";
import type { SavedSignature } from "../../../src/shared/types";
import { ConversionNotice } from "../../../src/renderer/components/ConversionNotice";
import { Pdf3dNotice } from "../../../src/renderer/components/Pdf3dNotice";
import { ProtectionNotice } from "../../../src/renderer/components/ProtectionNotice";
import { Toasts } from "../../../src/renderer/components/Toasts";
import { ValidationNotice } from "../../../src/renderer/components/ValidationNotice";
import { MultiPaneEmpty } from "../../../src/renderer/components/MultiPane";
import { BookView } from "../../../src/renderer/components/BookView";
import { ReadingView } from "../../../src/renderer/components/ReadingView";
import { StampAnnotations } from "../../../src/renderer/annotations/StampAnnotations";
import { FormsOverlay } from "../../../src/renderer/forms/FormsOverlay";
import { Welcome } from "../../../src/renderer/components/Welcome";
import { HOME_FIXED_TOOL_ID } from "../../../src/renderer/state/homeTools";
import { setAnimationsEnabledPreference } from "../../../src/renderer/hooks/motionPolicy";
import {
  DEFAULT_READING_DEFAULTS,
  type DocumentProtectionState,
  type Pdf3dContent,
} from "../../../src/shared/types";
import type { ConvertNoticeState } from "../../../src/renderer/state/convert";
import type { ValidationReport } from "../../../src/shared/validation";
import type { FormField } from "../../../src/shared/types";
import type { PDFDocumentProxy } from "pdfjs-dist";

const NOOP = (): void => undefined;

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(ui: ReactElement): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act((): void => {
    root.render(ui);
  });
  roots.push(root);
  hosts.push(host);
  return host;
}

function cls(el: Element | null): string {
  if (el === null) throw new Error("expected element");
  return el.getAttribute("class") ?? "";
}

function click(target: Element | null): void {
  if (target === null) throw new Error("expected clickable element");
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
  for (const root of rs) {
    act((): void => {
      root.unmount();
    });
  }
  for (const h of hs) h.remove();
  delete (window as unknown as { tflex?: unknown }).tflex;
  document.body.innerHTML = "";
});

describe("Phase 113 — AboutDialog storage rows", () => {
  it("renders a storage-path reveal as a canonical tertiary action", () => {
    const host = mount(<AboutDialog open onClose={NOOP} />);
    const link = host.querySelector(".about-row-value-link");
    expect(link).not.toBeNull();
    expect(cls(link)).toContain("btn");
    expect(cls(link)).toContain("btn-ghost");
    expect(cls(link)).toContain("about-row-value-link");
  });
});

describe("Phase 113 — AccountsDialog mode tabs", () => {
  it("renders the sign-in mode tab as a canonical tertiary exclusive-selection item", async () => {
    (window as unknown as { tflex?: unknown }).tflex = {
      accounts: {
        getConfig: vi.fn(async () => ({ configured: true, authBaseUrl: "https://example.invalid" })),
        getStatus: vi.fn(async () => ({ status: "signed-out", email: null, name: null })),
        setSession: vi.fn(async () => undefined),
        clearSession: vi.fn(async () => undefined),
        syncNow: vi.fn(async () => ({ phase: "synced" }) as SyncReport),
        onSyncReport: vi.fn(() => () => undefined),
      },
    };
    const host = mount(
      <AccountsDialog
        open
        onClose={NOOP}
        createAdapter={(): AccountsAuthAdapter => ({} as AccountsAuthAdapter)}
      />,
    );
    await flush();
    const tab = host.querySelector("[data-accounts-mode-signin]");
    expect(tab).not.toBeNull();
    expect(cls(tab)).toContain("btn");
    expect(cls(tab)).toContain("btn-ghost");
    expect(cls(tab)).toContain("btn-segmented-item");
    expect(cls(tab)).toContain("accounts-mode-tab");
    expect(tab?.getAttribute("role")).toBe("tab");
    expect(tab?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("Phase 113 — PreferencesDialog call sites", () => {
  function renderPrefs(): HTMLElement {
    return mount(
      <PreferencesDialog
        open
        onClose={NOOP}
        themeDefault="light"
        recentsCap={10}
        onSetThemeDefault={NOOP}
        onThemeChange={NOOP}
        onSetRecentsCap={NOOP}
        animationsEnabled
        onSetAnimationsEnabled={NOOP}
        convertDefaults={DEFAULT_CONVERT_DEFAULTS}
        onSetConvertDefaults={NOOP}
        tabStyle="colorful"
        onSetTabStyle={NOOP}
      />,
    );
  }

  it("renders a rail tab as a canonical secondary exclusive-selection compact item", () => {
    const host = renderPrefs();
    const tab = host.querySelector('[data-prefs-category="general"]');
    expect(cls(tab)).toContain("btn");
    expect(cls(tab)).toContain("btn-secondary");
    expect(cls(tab)).toContain("btn-segmented-item");
    expect(cls(tab)).toContain("btn-compact");
    expect(cls(tab)).toContain("prefs-cat");
    expect(tab?.getAttribute("role")).toBe("tab");
    expect(tab?.getAttribute("aria-selected")).toBe("true");
  });

  it("renders a storage row as a canonical secondary compact action", () => {
    const host = renderPrefs();
    const row = host.querySelector('[data-prefs-panel="storage"] .prefs-path');
    expect(cls(row)).toContain("btn");
    expect(cls(row)).toContain("btn-secondary");
    expect(cls(row)).toContain("btn-compact");
    expect(cls(row)).toContain("prefs-path");
    expect(row?.getAttribute("title")).toBeTruthy();
  });
});

function savedSignature(): SavedSignature {
  return {
    id: "s1",
    label: "Ada",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: { kind: "typed", text: "Ada", width: 100, height: 40 },
  };
}

describe("Phase 113 — SignatureManagerModal call sites", () => {
  it("renders the tabs as canonical secondary exclusive-selection items", () => {
    const host = mount(
      <SignatureManagerModal
        open
        onClose={NOOP}
        onApply={NOOP}
        savedSignatures={[]}
      />,
    );
    const tab = host.querySelector(".sig-tab");
    expect(cls(tab)).toContain("btn");
    expect(cls(tab)).toContain("btn-secondary");
    expect(cls(tab)).toContain("btn-segmented-item");
    expect(cls(tab)).toContain("sig-tab");
    expect(tab?.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders the saved delete as a canonical destructive compact icon button", () => {
    const host = mount(
      <SignatureManagerModal
        open
        onClose={NOOP}
        onApply={NOOP}
        savedSignatures={[savedSignature()]}
      />,
    );
    const tabs = host.querySelectorAll<HTMLElement>(".sig-tab");
    const savedTab = Array.from(tabs).find((t) => t.textContent?.startsWith("Saved"));
    click(savedTab ?? null);
    const del = host.querySelector(".sig-saved-row .sig-saved-delete");
    expect(cls(del)).toContain("btn");
    expect(cls(del)).toContain("btn-danger");
    expect(cls(del)).toContain("btn-compact");
    expect(cls(del)).toContain("btn-icon");
    expect(cls(del)).toContain("sig-saved-delete");
    expect(del?.getAttribute("aria-label")).toBe("Delete Ada");
  });
});

describe("Phase 113 — CommandPalette rows", () => {
  it("renders a recent row as a canonical secondary action", () => {
    const host = mount(
      <CommandPalette
        open
        onClose={NOOP}
        onRunTool={NOOP}
        onPinTool={NOOP}
        entries={[]}
        recentFiles={[{ path: "/tmp/a.pdf", label: "a.pdf" }]}
      />,
    );
    const row = host.querySelector('[data-palette-row="recent"]');
    expect(cls(row)).toContain("btn");
    expect(cls(row)).toContain("btn-secondary");
    expect(cls(row)).toContain("command-palette-row");
    expect(row?.getAttribute("role")).toBe("option");
  });
});

// ---------------------------------------------------------------------------
// Phase 113 (Quiet Actions) — migration wave F2: notices, empty states and
// overlays. Same contract as the F1 cases above: read the shipped classes /
// ARIA the primitive emits; never re-derive a handler.
// ---------------------------------------------------------------------------

const CONVERSION_NOTICE: ConvertNoticeState = {
  sourceLabel: "Text document",
  sourceFormat: "text",
  fidelity: "layout",
  warnings: [],
};

const PDF3D_ENTRIES: readonly Pdf3dContent[] = [{ page: 2, name: "Turbine" }];

const PROTECTION: DocumentProtectionState = {
  encrypted: true,
  v: 5,
  r: 6,
  cfm: "AESV3",
  algorithm: "AES-256",
  permissions: {
    print: false,
    highResPrint: false,
    copy: true,
    accessibleCopy: true,
    modify: false,
    comment: false,
    assemble: false,
    fillForms: true,
  },
};

const VALIDATION_REPORT: ValidationReport = {
  target: "pdfa-1b",
  standard: "pdfa",
  declared: "PDF/A-1b",
  conforms: true,
  violations: [],
};

describe("Phase 113 — wave F2 notice controls", () => {
  beforeEach((): void => {
    setAnimationsEnabledPreference(false);
  });
  afterEach((): void => {
    setAnimationsEnabledPreference(true);
  });

  it("renders the ConversionNotice collapse + collapsed toggles on the canonical axes", () => {
    const host = mount(<ConversionNotice notice={CONVERSION_NOTICE} />);
    const collapse = host.querySelector(".conversion-notice-collapse");
    expect(cls(collapse)).toContain("btn");
    expect(cls(collapse)).toContain("btn-ghost");
    expect(cls(collapse)).toContain("btn-disclosure");
    expect(cls(collapse)).toContain("btn-compact");
    expect(collapse?.getAttribute("aria-label")).toBe("Collapse conversion notice");
    click(collapse);
    const collapsed = host.querySelector("[data-conversion-icon]");
    expect(cls(collapsed)).toContain("btn-secondary");
    expect(cls(collapsed)).toContain("btn-disclosure");
    expect(cls(collapsed)).toContain("btn-compact");
    expect(collapsed?.getAttribute("aria-label")).toBe("Show conversion notice");
  });

  it("renders the Pdf3dNotice and ProtectionNotice disclosure controls on the canonical axes", () => {
    const pdf3d = mount(<Pdf3dNotice entries={PDF3D_ENTRIES} />);
    const pdf3dCollapse = pdf3d.querySelector(".pdf3d-notice-collapse");
    expect(cls(pdf3dCollapse)).toContain("btn-ghost");
    expect(cls(pdf3dCollapse)).toContain("btn-disclosure");
    expect(cls(pdf3dCollapse)).toContain("btn-compact");

    const protection = mount(<ProtectionNotice protection={PROTECTION} />);
    const protectionCollapse = protection.querySelector(".protection-notice-collapse");
    expect(cls(protectionCollapse)).toContain("btn-ghost");
    expect(cls(protectionCollapse)).toContain("btn-disclosure");
    expect(cls(protectionCollapse)).toContain("btn-compact");
    click(protectionCollapse);
    const protectionIcon = protection.querySelector("[data-protection-icon]");
    expect(cls(protectionIcon)).toContain("btn-secondary");
    expect(cls(protectionIcon)).toContain("btn-compact");
  });

  it("renders Toast and ValidationNotice dismiss controls as tertiary compact icon buttons", () => {
    const toasts = mount(<Toasts items={[{ id: 1, kind: "info", text: "hi" }]} onDismiss={NOOP} />);
    const toastClose = toasts.querySelector(".toast-close");
    expect(cls(toastClose)).toContain("btn-ghost");
    expect(cls(toastClose)).toContain("btn-compact");
    expect(cls(toastClose)).toContain("btn-icon");
    expect(toastClose?.getAttribute("aria-label")).toBe("Dismiss");

    const validation = mount(
      <ValidationNotice notice={{ report: VALIDATION_REPORT, variant: "report" }} onDismiss={NOOP} />,
    );
    const dismiss = validation.querySelector(".validation-notice-dismiss");
    expect(cls(dismiss)).toContain("btn-ghost");
    expect(cls(dismiss)).toContain("btn-compact");
    expect(cls(dismiss)).toContain("btn-icon");
    expect(dismiss?.getAttribute("aria-label")).toBe("Dismiss validation report");
  });
});

describe("Phase 113 — wave F2 empty state and overlay controls", () => {
  it("renders the MultiPane empty-state rows as canonical secondary actions", () => {
    const host = mount(
      <MultiPaneEmpty
        pane="A"
        options={[{ id: "t1", title: "Report.pdf", pageCount: 3 }]}
        onPick={NOOP}
        onOpen={NOOP}
      />,
    );
    const pick = host.querySelector("[data-pane-pick]");
    expect(cls(pick)).toContain("btn-secondary");
    expect(pick?.getAttribute("data-pane-pick")).toBe("t1");
    const open = host.querySelector("[data-pane-open]");
    expect(cls(open)).toContain("btn-secondary");
    expect(cls(open)).toContain("btn");
  });

  it("renders the Welcome remove badge as the canonical destructive compact control", () => {
    const host = mount(
      <Welcome
        recentFiles={[]}
        onOpenRecent={NOOP}
        onRemoveRecent={NOOP}
        onOpenFile={NOOP}
        onSampleClick={NOOP}
        onMergeClick={NOOP}
        onCreateFromImages={NOOP}
        samplesResolver={() => Promise.resolve([])}
        onSetHomeMotionPaused={NOOP}
        onRunHomeTool={NOOP}
        onSetHomeTools={NOOP}
      />,
    );
    click(host.querySelector("[data-home-edit-toggle]"));
    const minus = host.querySelector("[data-home-minus]");
    expect(cls(minus)).toContain("btn");
    expect(cls(minus)).toContain("btn-danger");
    expect(cls(minus)).toContain("btn-compact");
    expect(minus?.getAttribute("data-home-tool")).toBeNull();
    expect(host.querySelector(`[data-home-tool="${HOME_FIXED_TOOL_ID}"]`)).not.toBeNull();
  });
});

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  if (g.IntersectionObserver === undefined) {
    class NoopIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = NoopIntersectionObserver;
  }
  if (g.ResizeObserver === undefined) {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
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

describe("Phase 113 — wave F2 viewing overlays", () => {
  it("renders the BookView layout + navigation controls on the canonical axes", async () => {
    stubObservers();
    const host = mount(
      <BookView
        doc={makeDocStub(3)}
        pageCount={3}
        title="Novel.pdf"
        defaultLayout="single"
        annotations={[]}
        onCreateAnnotation={NOOP}
        onClose={NOOP}
      />,
    );
    await flush();
    const layout = host.querySelector("[data-book-single]");
    expect(cls(layout)).toContain("btn-secondary");
    expect(cls(layout)).toContain("btn-segmented-item");
    expect(cls(layout)).toContain("btn-compact");
    expect(layout?.getAttribute("aria-pressed")).toBe("true");
    const close = host.querySelector("[data-book-close]");
    expect(cls(close)).toContain("btn-icon");
    const nav = host.querySelector("[data-book-prev]");
    expect(cls(nav)).toContain("btn-prominent");
    expect(cls(nav)).toContain("btn-secondary");
  });

  it("renders the ReadingView comic toggles and navigation on the canonical axes", async () => {
    stubObservers();
    const host = mount(
      <ReadingView
        open
        mode="comic"
        title="A Comic"
        sourcePath="/books/a.cbz"
        defaults={DEFAULT_READING_DEFAULTS}
        onNotice={NOOP}
        onClose={NOOP}
        comicPageCount={2}
        renderComicPage={(): ReactElement => <div data-comic-render />}
      />,
    );
    await flush();
    const single = host.querySelector("[data-comic-single]");
    expect(cls(single)).toContain("btn-secondary");
    expect(cls(single)).toContain("btn-segmented-item");
    expect(cls(single)).toContain("btn-compact");
    expect(single?.getAttribute("aria-pressed")).toBe("true");
    const rtl = host.querySelector("[data-comic-rtl]");
    expect(cls(rtl)).toContain("btn-toggle");
    expect(cls(rtl)).toContain("btn-compact");
    const nav = host.querySelector("[data-reading-next]");
    expect(cls(nav)).toContain("btn-prominent");
    const close = host.querySelector("[data-reading-close]");
    expect(cls(close)).toContain("btn-icon");
  });
});

describe("Phase 113 — wave F2 annotation and form overlays", () => {
  it("renders a stamp-type chip and cancel on the canonical axes", () => {
    const host = document.body.appendChild(document.createElement("div"));
    host.style.width = "900px";
    host.style.height = "700px";
    host.getBoundingClientRect = (): DOMRect => ({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700,
      toJSON: () => ({}),
    });
    Element.prototype.setPointerCapture = function (): void { /* no-op */ };
    Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
    const root = createRoot(host);
    act((): void => {
      root.render(
        <StampAnnotations
          cssScale={2}
          items={[{
            id: "p-1",
            stampId: "APPROVED",
            page: 1,
            rect: { x: 50, y: 60, width: 200, height: 80 },
            pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
            pngWidth: 200,
            pngHeight: 80,
          }]}
          pageWidthPt={612}
          pageHeightPt={792}
          onMove={NOOP}
          onDelete={NOOP}
          onRetype={NOOP}
        />,
      );
    });
    try {
      click(host.querySelector(".stamp-annotation"));
      click(host.querySelector("[data-content-action='stamp-edit']"));
      const chip = host.querySelector("[data-stamp-type-btn='APPROVED']");
      expect(cls(chip)).toContain("btn-secondary");
      expect(cls(chip)).toContain("btn-segmented-item");
      expect(cls(chip)).toContain("btn-compact");
      expect(chip?.getAttribute("aria-pressed")).toBe("true");
      const cancel = host.querySelector("[data-stamp-type-cancel]");
      expect(cls(cancel)).toContain("btn-secondary");
      expect(cls(cancel)).toContain("btn-compact");
      expect(cancel?.getAttribute("aria-label")).toBe("Cancel stamp edit");
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("renders a form checkbox toggle and a radio exclusive-selection item on the canonical axes", () => {
    const checkbox: FormField = {
      id: "c1",
      name: "agree",
      page: 1,
      kind: "checkbox",
      rect: { x: 0, y: 0, width: 14, height: 14 },
      value: "",
    };
    const radio: FormField = {
      id: "r1",
      name: "choice",
      page: 1,
      kind: "radio",
      rect: { x: 0, y: 0, width: 120, height: 20 },
      value: "",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    const host = mount(
      <FormsOverlay
        page={1}
        cssScale={1}
        fields={[checkbox, radio]}
        onValueChange={NOOP}
        onToggleListbox={NOOP}
      />,
    );
    const box = host.querySelector('[data-form-kind="checkbox"]');
    expect(cls(box)).toContain("btn-toggle");
    expect(cls(box)).toContain("btn-compact");
    expect(box?.getAttribute("aria-pressed")).toBe("false");
    const option = host.querySelector('[data-form-option="a"]');
    expect(cls(option)).toContain("btn-secondary");
    expect(cls(option)).toContain("btn-segmented-item");
    expect(cls(option)).toContain("btn-compact");
  });
});

