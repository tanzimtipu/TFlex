// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { prefersReducedMotion } from "motion-dom";
import { AnimatedDialog } from "../../../src/renderer/components/AnimatedDialog";
import { AnimatedPanel } from "../../../src/renderer/components/AnimatedPanel";
import { AnimatedTab } from "../../../src/renderer/components/AnimatedTab";
import { AppHeader } from "../../../src/renderer/components/AppHeader";

interface TabHarness {
  activated: string[];
  closed: string[];
}

interface HeaderTab {
  id: string;
  title: string;
  modified: boolean;
}

/** Fire a mousedown with an explicit button (React listens at the root;
 *  a bubbling native mousedown reaches the handlers exactly like a real
 *  browser dispatch — same helper pattern as appHeader.test.tsx). */
function mouseDown(el: Element, button: 0 | 1 | 2 = 0): void {
  act((): void => {
    const evt = new MouseEvent("mousedown", { bubbles: true, button });
    el.dispatchEvent(evt);
  });
}

function click(el: Element): void {
  act((): void => {
    const evt = new MouseEvent("click", { bubbles: true, button: 0 });
    el.dispatchEvent(evt);
  });
}

let roots: Root[] = [];
let containers: HTMLElement[] = [];

function mount(ui: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act((): void => {
    root.render(ui);
  });
  roots.push(root);
  containers.push(container);
  return container;
}

/** Flush the presence machinery (skipAnimations completes exits on the
 *  next frame, and jsdom's pretendToBeVisual frame ticks every ~16ms,
 *  so the wait must cover a full frame). */
async function flushExit(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 40));
  });
}

beforeEach((): void => {
  roots = [];
  containers = [];
  prefersReducedMotion.current = false;
});

afterEach((): void => {
  const rs = roots;
  const cs = containers;
  roots = [];
  containers = [];
  for (const root of rs) {
    act((): void => {
      root.unmount();
    });
  }
  for (const c of cs) c.remove();
  document.documentElement.classList.remove("tf-theme-transitioning");
});

describe("AnimatedDialog", () => {
  it("renders the backdrop + dialog pair and closes through AnimatePresence", async () => {
    let closeCalls = 0;
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const render = (o: boolean): void => {
      act((): void => {
        root.render(
          <AnimatedDialog
            open={o}
            onClose={(): void => {
              closeCalls += 1;
            }}
            className="sheet sheet-test"
            labelledBy="dlg-title"
          >
            <h2 id="dlg-title">Test dialog</h2>
          </AnimatedDialog>,
        );
      });
    };
    render(true);
    roots.push(root);
    containers.push(container);

    expect(container.querySelector(".sheet-backdrop")).not.toBeNull();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("dlg-title");
    expect(container.querySelector(".sheet-test")).not.toBeNull();

    // Close -> bloom out plays -> the pair unmounts.
    render(false);
    await flushExit();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(closeCalls).toBe(0);
  });

  it("outside mousedown+click on the backdrop closes; a drag ending on it does not", () => {
    let closes = 0;
    const container = mount(
      <AnimatedDialog
        open
        onClose={(): void => {
          closes += 1;
        }}
        className="sheet"
      >
        <p>body</p>
      </AnimatedDialog>,
    );
    const backdrop = container.querySelector(".sheet-backdrop") as HTMLElement;
    expect(backdrop).not.toBeNull();

    // A drag that STARTS in the dialog body and releases over the
    // backdrop must NOT close (useBackdropClose contract).
    mouseDown(container.querySelector('[role="dialog"]') as Element);
    click(backdrop);
    expect(closes).toBe(0);

    // A genuine outside press+release on the backdrop closes.
    mouseDown(backdrop);
    click(backdrop);
    expect(closes).toBe(1);
  });

  it("blocked backdrop close closes nothing", () => {
    let closes = 0;
    const container = mount(
      <AnimatedDialog
        open
        onClose={(): void => {
          closes += 1;
        }}
        blockBackdropClose
      >
        <p>busy</p>
      </AnimatedDialog>,
    );
    const backdrop = container.querySelector(".sheet-backdrop") as HTMLElement;
    mouseDown(backdrop);
    click(backdrop);
    expect(closes).toBe(0);
  });

  it("dialog without onClose completes backdrop clicks harmlessly", () => {
    const container = mount(
      <AnimatedDialog open>
        <p>must be answered</p>
      </AnimatedDialog>,
    );
    const backdrop = container.querySelector(".sheet-backdrop") as HTMLElement;
    mouseDown(backdrop);
    expect((): void => click(backdrop)).not.toThrow();
  });
});

describe("AnimatedPanel", () => {
  it("mounts a left docked rail with side data and unmounts on close", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const render = (o: boolean): void => {
      act((): void => {
        root.render(
          <AnimatedPanel open={o} side="left" className="side-rail" testId="pages-rail">
            <p>thumbs</p>
          </AnimatedPanel>,
        );
      });
    };
    render(true);
    roots.push(root);
    containers.push(container);
    const panel = container.querySelector("aside.side-rail");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("data-animated-panel")).toBe("pages-rail");
    expect(panel?.getAttribute("data-panel-side")).toBe("left");
    render(false);
    await flushExit();
    expect(container.querySelector("aside.side-rail")).toBeNull();
  });

  it("overlay mode renders a div drawer on the requested side", () => {
    const container = mount(
      <AnimatedPanel open side="right" mode="overlay" className="drawer" testId="inspector">
        <p>tools</p>
      </AnimatedPanel>,
    );
    const drawer = container.querySelector("div.drawer");
    expect(drawer).not.toBeNull();
    expect(drawer?.getAttribute("data-panel-side")).toBe("right");
  });
});

describe("AnimatedTab", () => {
  function renderTab(active = false): { el: HTMLElement; h: TabHarness } {
    const h: TabHarness = { activated: [], closed: [] };
    const container = mount(
      <AnimatedTab
        id="t1"
        title="Doc One"
        active={active}
        modified={false}
        onActivate={(id): void => {
          h.activated.push(id);
        }}
        onClose={(id): void => {
          h.closed.push(id);
        }}
      />,
    );
    const el = container.querySelector('[data-tab-id="t1"]') as HTMLElement;
    expect(el).not.toBeNull();
    return { el, h };
  }

  it("renders the tab surface with role + title + close affordance", () => {
    const { el } = renderTab();
    expect(el.getAttribute("role")).toBe("tab");
    expect(el.querySelector(".tab-title")?.textContent).toContain("Doc One");
    expect(el.querySelector(".tab-close")).not.toBeNull();
    // AnimatedTab carries the presence hook for e2e.
    expect(el.closest("[data-animated-tab]")).not.toBeNull();
  });

  it("activates on mousedown anywhere in the tab body (DEF-034)", () => {
    const { el, h } = renderTab();
    mouseDown(el.querySelector(".tab-title") as Element);
    expect(h.activated).toEqual(["t1"]);
    mouseDown(el); // container padding hit
    expect(h.activated).toEqual(["t1", "t1"]);
  });

  it("closes via the close button click and never via the button's mousedown", () => {
    const { el, h } = renderTab();
    mouseDown(el.querySelector(".tab-close") as Element);
    expect(h.closed).toEqual([]);
    expect(h.activated).toEqual([]);
    click(el.querySelector(".tab-close") as Element);
    expect(h.closed).toEqual(["t1"]);
  });

  it("ignores non-left-button mousedowns (no accidental activation)", () => {
    const { el, h } = renderTab();
    mouseDown(el, 1);
    mouseDown(el, 2);
    expect(h.activated).toEqual([]);
    expect(h.closed).toEqual([]);
  });

  it("mousedowns resolving to the already-active tab are no-ops", () => {
    const { el, h } = renderTab(true);
    mouseDown(el);
    expect(h.activated).toEqual([]);
  });
});

describe("AppHeader tab strip integration", () => {
  function renderHeader(
    list: HeaderTab[],
    activeId: string | null,
    h: TabHarness,
    onCloseOverride?: (id: string) => void,
  ): HTMLElement {
    return mount(
      <AppHeader
        activeId={activeId}
        tabs={list}
        onActivate={(id): void => {
          h.activated.push(id);
        }}
        onClose={
          onCloseOverride ??
          ((id): void => {
            h.closed.push(id);
          })
        }
        theme="frosted"
        onThemeChange={(): void => undefined}
        onNewEmptyTab={(): void => undefined}
        onOpenPreferences={(): void => undefined}
      />,
    );
  }

  it("renders every tab as an animated li and keeps activation working", () => {
    const h: TabHarness = { activated: [], closed: [] };
    const container = renderHeader(
      [
        { id: "a", title: "Alpha.pdf", modified: false },
        { id: "b", title: "Beta.pdf", modified: false },
      ],
      "a",
      h,
    );
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
    // Mousedown on the second tab's title still activates it through
    // the AnimatedTab resolver.
    mouseDown(tabs[1].querySelector(".tab-title") as Element);
    expect(h.activated).toEqual(["b"]);
    // The close button still closes without activating.
    click(tabs[0].querySelector(".tab-close") as Element);
    expect(h.closed).toEqual(["a"]);
    expect(h.activated).toEqual(["b"]);
  });

  it("keeps the '+ tab' affordance and its no-activation guarantee", () => {
    const h: TabHarness = { activated: [], closed: [] };
    const container = renderHeader(
      [{ id: "a", title: "Alpha.pdf", modified: false }],
      "a",
      h,
    );
    const newTab = container.querySelector("[data-new-tab]");
    expect(newTab).not.toBeNull();
    // A mousedown on "+ tab" must not activate any tab (the resolver
    // only classifies .tab hits; the button stops propagation too).
    mouseDown(newTab as Element);
    expect(h.activated).toEqual([]);
    // A plain click completes harmlessly (host wiring is a no-op here).
    expect((): void => click(newTab as Element)).not.toThrow();
    expect(h.activated).toEqual([]);
  });

  it("dissolves a closed tab: the li leaves the strip after the exit", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    let list: HeaderTab[] = [
      { id: "a", title: "Alpha.pdf", modified: false },
      { id: "b", title: "Beta.pdf", modified: false },
    ];
    const render = (): void => {
      act((): void => {
        root.render(
          <AppHeader
            activeId="a"
            tabs={list}
            onActivate={(): void => undefined}
            onClose={(id): void => {
              list = list.filter((t) => t.id !== id);
              render();
            }}
            theme="frosted"
            onThemeChange={(): void => undefined}
            onNewEmptyTab={(): void => undefined}
            onOpenPreferences={(): void => undefined}
          />,
        );
      });
    };
    render();
    roots.push(root);
    containers.push(container);
    expect(container.querySelectorAll('[role="tab"]').length).toBe(2);
    click(container.querySelector('[data-tab-id="b"] .tab-close') as Element);
    await flushExit();
    expect(list.length).toBe(1);
    expect(container.querySelectorAll('[role="tab"]').length).toBe(1);
  });
});