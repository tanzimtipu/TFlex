// @vitest-environment jsdom
//
// Phase 49 (feature B) — the JOVREL in-app branding.
//
// The product is JOVREL (the project stays TFlex). These tests pin:
//   1. BrandMark renders the EXACT Phase 69 "Halo" geometry: the amber ->
//      pink -> violet gradient stops, the near-black rx=115 tile, the
//      gradient arc path and the white r=20.4 leading dot in the 512
//      viewBox (a rendered assertion, not a string match on the asset file).
//   2. Every mounted mark mints a UNIQUE gradient id, so two marks never
//      fight over one global SVG id.
//   3. BrandWordmark shows "Jovrel".
//   4. Each branded surface renders the wordmark "Jovrel" and no longer
//      contains the literal "TFlex" in its source.
//   5. The print-window title mirrors main's "Print - Jovrel".
//   6. The sweep: the update prompt, the OS drop toasts, the OAuth info
//      message, the tools registry labels and the account sheet copy all
//      read Jovrel.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

import { BrandMark } from "../../../src/renderer/components/BrandMark";
import { BrandWordmark } from "../../../src/renderer/components/BrandWordmark";
import { TitleBar } from "../../../src/renderer/components/TitleBar";
import { Welcome } from "../../../src/renderer/components/Welcome";
import { AboutDialog } from "../../../src/renderer/components/AboutDialog";
import { AccountsDialog } from "../../../src/renderer/components/AccountsDialog";
import { PrintWindowApp } from "../../../src/renderer/print-window/PrintWindowApp";
import {
  PRINT_WINDOW_TITLE,
  rendererEntryTitle,
} from "../../../src/renderer/print-window/context";
import type { AccountsAuthAdapter } from "../../../src/renderer/accounts/adapter";
import type { SampleDocument } from "../../../src/shared/types";

const RENDERER = resolve(process.cwd(), "src/renderer");

const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  delete (window as unknown as { tflex?: unknown }).tflex;
});

function render(node: ReactNode): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, root };
}

function must(container: HTMLElement, selector: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  return el;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));
  });
}

const SOURCE_SURFACES = [
  "components/AppHeader.tsx",
  "components/Welcome.tsx",
  "components/AboutDialog.tsx",
  "components/AccountsDialog.tsx",
  "print-window/PrintWindowApp.tsx",
] as const;

describe("Phase 49 — BrandMark geometry", () => {
  it("renders the exact Phase 69 gradient stops from the shipped asset", () => {
    const { container } = render(<BrandMark size={18} />);
    const svg = must(container, "svg[data-brand-mark]");
    const stops = svg.querySelectorAll("linearGradient stop");
    expect(stops.length).toBe(3);
    expect(stops[0].getAttribute("offset")).toBe("0");
    expect(stops[0].getAttribute("stop-color")).toBe("rgb(251, 191, 36)");
    expect(stops[1].getAttribute("offset")).toBe("0.5");
    expect(stops[1].getAttribute("stop-color")).toBe("rgb(236, 72, 153)");
    expect(stops[2].getAttribute("offset")).toBe("1");
    expect(stops[2].getAttribute("stop-color")).toBe("rgb(139, 92, 246)");
    const grad = svg.querySelector("linearGradient");
    expect(grad?.getAttribute("x1")).toBe("0");
    expect(grad?.getAttribute("y1")).toBe("0");
    expect(grad?.getAttribute("x2")).toBe("1");
    expect(grad?.getAttribute("y2")).toBe("1");
  });

  it("renders the rx=115 tile with the gradient arc wired to its own gradient", () => {
    const { container } = render(<BrandMark size={18} />);
    const svg = must(container, "svg[data-brand-mark]");
    expect(svg.getAttribute("viewBox")).toBe("0 0 512 512");
    const rect = svg.querySelector("rect");
    expect(rect?.getAttribute("width")).toBe("512");
    expect(rect?.getAttribute("height")).toBe("512");
    expect(rect?.getAttribute("rx")).toBe("115");
    expect(rect?.getAttribute("fill")).toBe("rgb(15, 10, 20)");
    const id = svg.querySelector("linearGradient")?.getAttribute("id") ?? "";
    expect(id).not.toBe("");
    const arc = svg.querySelector("path");
    expect(arc?.getAttribute("stroke")).toBe(`url(#${id})`);
  });

  it("renders the round-capped gradient arc and the white r=20.4 dot verbatim", () => {
    const { container } = render(<BrandMark size={18} />);
    const svg = must(container, "svg[data-brand-mark]");
    const arc = svg.querySelector("path");
    expect(arc?.getAttribute("fill")).toBe("none");
    expect(arc?.getAttribute("stroke-width")).toBe("27");
    expect(arc?.getAttribute("stroke-linecap")).toBe("round");
    expect(arc?.getAttribute("d")).toBe(
      "M 324.8 167.7 A 120.0 120.0 0 1 1 215.0 153.2",
    );
    const dot = svg.querySelector("circle");
    expect(dot?.getAttribute("cx")).toBe("272.7");
    expect(dot?.getAttribute("cy")).toBe("147.2");
    expect(dot?.getAttribute("r")).toBe("20.4");
    expect(dot?.getAttribute("fill")).toBe("#fff");
  });

  it("mints a unique gradient id per instance so marks never fight", () => {
    const { container } = render(
      <div>
        <span id="a"><BrandMark size={18} /></span>
        <span id="b"><BrandMark size={40} /></span>
      </div>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.getAttribute("id"));
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
    const arcStrokes = [...container.querySelectorAll("path")].map((p) => p.getAttribute("stroke"));
    expect(arcStrokes[0]).toBe(`url(#${ids[0]})`);
    expect(arcStrokes[1]).toBe(`url(#${ids[1]})`);
  });

  it("sizes via the size prop and stays square (crisp at small sizes)", () => {
    const { container } = render(<BrandMark size={18} />);
    const svg = must(container, "svg[data-brand-mark]");
    expect(svg.getAttribute("width")).toBe("18");
    expect(svg.getAttribute("height")).toBe("18");
    expect(svg.getAttribute("viewBox")).toBe("0 0 512 512");
  });

  it("is decorative by default and labelled when a title is given", () => {
    const { container } = render(<BrandMark size={18} />);
    expect(must(container, "svg[data-brand-mark]").getAttribute("aria-hidden")).toBe("true");
    const labelled = render(<BrandMark size={18} title="Jovrel" />);
    const svg = must(labelled.container, "svg[data-brand-mark]");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Jovrel");
  });
});

describe("Phase 49 — BrandWordmark", () => {
  it("shows 'Jovrel'", () => {
    const { container } = render(<BrandWordmark />);
    expect(must(container, ".brand-wordmark").textContent).toBe("Jovrel");
  });

  it("merges caller classes", () => {
    const { container } = render(<BrandWordmark className="about-name" />);
    const el = must(container, ".brand-wordmark");
    expect(el.classList.contains("about-name")).toBe(true);
  });
});

describe("Phase 49 � branded surfaces", () => {
  it("title bar (TitleBar) shows the mark + Jovrel and no old name", () => {
    const { container } = render(<TitleBar />);
    expect(container.querySelector(".brand svg[data-brand-mark]")).not.toBeNull();
    expect(must(container, ".brand .brand-wordmark").textContent).toBe("Jovrel");
    expect(container.querySelector(".brand")?.textContent ?? "").not.toContain("TFlex");
  });

  it("Welcome shows the mark + Jovrel and no old name in its copy", async () => {
    const { container } = render(
      <Welcome
        recentFiles={[]}
        onOpenRecent={(): void => undefined}
        onRemoveRecent={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSampleClick={(): void => undefined}
        onMergeClick={(): void => undefined}
        samplesResolver={async (): Promise<SampleDocument[]> => []}
      />,
    );
    await flush();
    expect(container.querySelector(".welcome-brand svg[data-brand-mark]")).not.toBeNull();
    expect(must(container, ".welcome-brand .brand-wordmark").textContent).toBe("Jovrel");
    expect(container.textContent ?? "").not.toContain("TFlex");
    expect(container.textContent ?? "").toContain("see Jovrel");
  });

  it("About dialog shows the mark + Jovrel and no old name", async () => {
    (window as unknown as { tflex?: unknown }).tflex = {
      app: {
        getInfo: async (): Promise<never> => {
          throw new Error("no backend in this test");
        },
      },
    };
    const { container } = render(<AboutDialog open onClose={(): void => undefined} />);
    await flush();
    expect(container.querySelector(".about-mark[data-brand-mark]")).not.toBeNull();
    expect(must(container, ".about-name .brand-wordmark").textContent).toBe("Jovrel");
    expect(must(container, "#about-title").textContent).toBe("About Jovrel");
    // The bundled What's New HISTORY is intentionally untouched (history is
    // history), so scope the "no old name" check to the brand lockup itself.
    const headerAndName =
      (must(container, ".sheet-header").textContent ?? "") +
      (must(container, ".about-name").textContent ?? "");
    expect(headerAndName).not.toContain("TFlex");
  });

  it("account sheet header shows the mark + Jovrel and no old name", async () => {
    const adapter = {
      signInEmail: vi.fn(async () => ({ ok: false, code: "invalid-credentials", message: "x" })),
      signUpEmail: vi.fn(async () => ({ ok: false, code: "unknown", message: "x" })),
      sendOtp: vi.fn(async () => ({ ok: false, code: "unknown", message: "x" })),
      verifyOtp: vi.fn(async () => ({ ok: false, code: "unknown", message: "x" })),
      signInGoogle: vi.fn(async () => ({ ok: false, code: "unknown", message: "x" })),
      requestPasswordReset: vi.fn(async () => ({ ok: false, code: "unknown", message: "x" })),
      resetPassword: vi.fn(async () => ({ ok: false, code: "unknown", message: "x" })),
      signOut: vi.fn(async () => undefined),
    } as unknown as AccountsAuthAdapter;
    (window as unknown as { tflex?: unknown }).tflex = {
      accounts: {
        getConfig: vi.fn(async () => ({ configured: false })),
        getStatus: vi.fn(async () => ({ status: "signed-out", email: null, name: null })),
        setSession: vi.fn(async () => undefined),
        clearSession: vi.fn(async () => undefined),
        syncNow: vi.fn(async () => ({ phase: "synced" })),
        onSyncReport: vi.fn(() => () => undefined),
        startOAuthCallback: vi.fn(async () => ({ callbackUrl: "http://127.0.0.1/x" })),
        stopOAuthCallback: vi.fn(async () => undefined),
        onOAuthCallback: vi.fn(() => () => undefined),
      },
    };
    const { container } = render(
      <AccountsDialog
        open
        onClose={(): void => undefined}
        createAdapter={(): AccountsAuthAdapter => adapter}
      />,
    );
    await flush();
    expect(container.querySelector(".accounts-brand-mark[data-brand-mark]")).not.toBeNull();
    expect(must(container, ".accounts-brand-name").textContent).toBe("Jovrel");
    expect(container.textContent ?? "").not.toContain("TFlex");
    expect(container.textContent ?? "").toContain("Everything else in Jovrel works");
  });

  it("print window shows the mark + Jovrel and no old name", async () => {
    const { container } = render(
      <PrintWindowApp
        entry={{
          kind: "print",
          context: {
            docId: "doc-1",
            documentName: "report.pdf",
            pageCount: 3,
            settings: {},
          },
        }}
        deps={{
          listPrinters: async () => [],
          printJob: async () => ({ ok: false, reason: "unused" }) as never,
          onDocumentGone: () => () => undefined,
          loadDocument: () => new Promise<never>(() => undefined),
          closeWindow: (): void => undefined,
        }}
      />,
    );
    await flush();
    expect(container.querySelector(".print-window-brand svg[data-brand-mark]")).not.toBeNull();
    expect(must(container, ".print-window-brand .brand-wordmark").textContent).toBe("Jovrel");
    expect(container.textContent ?? "").not.toContain("TFlex");
  });
});

describe("Phase 49 � print window title + source guard", () => {
  it("mirrors main's 'Print - Jovrel' title", () => {
    expect(PRINT_WINDOW_TITLE).toBe("Print - Jovrel");
    expect(
      rendererEntryTitle({
        kind: "print",
        context: { docId: "d", documentName: "x.pdf", pageCount: 1, settings: {} },
      }),
    ).toBe("Print - Jovrel");
  });

  it("branded surfaces carry no user-visible 'TFlex' literal", () => {
    for (const rel of SOURCE_SURFACES) {
      const src = readFileSync(resolve(RENDERER, rel), "utf8");
      expect(src.includes("TFlex"), `${rel} still contains TFlex`).toBe(false);
    }
  });

  it("index.html title is Jovrel (it overrides the BrowserWindow title)", () => {
    const html = readFileSync(resolve(RENDERER, "index.html"), "utf8");
    expect(html).toContain("<title>Jovrel</title>");
    expect(html).not.toContain("<title>TFlex</title>");
  });

  it("the sweep rewrote the user-visible strings", () => {
    const check = (rel: string, needle: string, present: boolean): void => {
      const src = readFileSync(resolve(RENDERER, rel), "utf8");
      expect(src.includes(needle), `${rel} ${present ? "missing" : "still has"} ${needle}`).toBe(present);
    };
    // Present (Jovrel) ...
    check("hooks/useOsIntegration.ts", "Jovrel could not read the dropped file.", true);
    check("hooks/useOsIntegration.ts", "Jovrel received an invalid file path from Windows.", true);
    check("accounts/oauthLoopback.ts", "Jovrel could not open your browser for Google sign-in.", true);
    check("App.tsx", "not available in this build of Jovrel", true);
    check("App.tsx", 'label: "About Jovrel"', true);
    check("components/UpdatePromptDialog.tsx", "Restart Jovrel to install", true);
    check("components/UpdatePromptDialog.tsx", "latest version of Jovrel", true);
    check("components/UpdatePromptDialog.tsx", "This build of Jovrel doesn't support", true);
    check("state/toolsRegistry.ts", "whether a newer Jovrel exists", true);
    check("state/toolsRegistry.ts", "Install the downloaded update and relaunch Jovrel.", true);
    check("state/toolsRegistry.ts", "label: 'About Jovrel'", true);
    check("state/toolsRegistry.ts", "Minimize the Jovrel window.", true);
    check("state/toolsRegistry.ts", "Maximize or restore the Jovrel window.", true);
    check("state/toolsRegistry.ts", "Close the Jovrel window.", true);
    // ... and no stale user-visible TFlex in the swept files that are not
    // identifier-bearing (App.tsx keeps the TFlexApi type by contract).
    check("hooks/useOsIntegration.ts", "TFlex", false);
    check("accounts/oauthLoopback.ts", "TFlex", false);
    check("components/UpdatePromptDialog.tsx", "TFlex", false);
    check("state/toolsRegistry.ts", "TFlex", false);
  });
});
