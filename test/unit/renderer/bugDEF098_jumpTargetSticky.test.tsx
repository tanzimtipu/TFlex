// @vitest-environment jsdom
//
// DEF-098 — a thumbnail jump must be STICKY: once the user clicks
// thumb N, `currentPage` is optimistically set to N, the DEF-058 jump
// lock holds it there while the smooth scroll is in flight, and NO
// restore/sync effect may overwrite it with a mid-scroll recompute or
// a persisted round-trip. The old code had three ways to break the
// target:
//
//   1. The mount-sync effect (`jumpTargetRef.current ?? currentPage`)
//      re-ran on EVERY `currentPage` change and INSTANT-scrolled the
//      scroller to whatever page it held, snapping the view back to
//      the page the fallback timer had just recomputed mid-flight.
//   2. The 1200ms fallback timer force-recomputed `currentPage` from
//      the mid-smooth-scroll `scrollTop`, dragging the target to the
//      page the view was passing (8/9 in the repro) — and #1 then
//      snapped the scroller back to it.
//   3. The initial-page-restore effect re-fired on every App persist
//      round-trip and on every `jumpToPage` identity change,
//      re-arming the lock and re-issuing a competing jump.
//
// This test mounts the REAL DocumentView (jsdom + a fake scrollable),
// clicks the real thumbnail, and drives the real jumpToPage ->
// scrollTo -> onScroll -> lock -> currentPage chain:
//
//   - clicking thumb 10 sets currentPage=10 immediately (optimistic);
//   - while the smooth scroll advances through intermediate pages,
//     currentPage STAYS 10 (lock holds; no `scrollTo(instant)` kill);
//   - a stalled animation (the fallback window elapsing mid-flight)
//     does NOT overwrite currentPage (the target stays sticky);
//   - when the animation settles at the target, currentPage === 10;
//   - the App persist round-trip does not re-fire a competing jump;
//   - after the jump lands, a genuine user scroll resumes the
//     heuristic and the mount-sync effect must NOT re-snap the
//     scroller.
//
// jsdom has no scrollTo/scrollTop/clientHeight, so the harness
// installs a faithful fake on HTMLElement.prototype: `behavior:
// "smooth"` parks the target (the test advances the animation with
// `advanceSmooth`), `behavior: "instant"` (or missing) snaps and
// cancels the animation, and setting scrollTop fires a `scroll`
// event — matching the browser's observable contract for the pieces
// DocumentView relies on. scrollTo calls are spied so the test can
// assert the mount-sync effect never issues an instant re-scroll
// after the click.
//
// DEF-261 — the whole file runs on VIRTUAL time (`vi.useFakeTimers`).
// The frame simulation, the component's `requestAnimationFrame`
// scroll handling and its real-time `JUMP_LOCK_FALLBACK_MS` window
// all advance on the fake clock the test controls, so the simulated
// scroll can never outrun the fallback window because the host
// machine is busy. Previously the simulation burned a real 25ms per
// frame (18 frames per `animate` call, three calls) and a contended
// `verify:full` run stretched that past the product's real 1200ms
// fallback, releasing the DEF-058 lock mid-flight; the next scroll
// event then recomputed `currentPage` from the passing page (7) and
// the test failed `expected 7 to be 10`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import type { DocDiagnostics } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";
import { slotOffsetTop, CONTENT_PADDING_PX } from "../../../src/renderer/components/pageGeometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    readonly root: unknown = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}

// ---------------------------------------------------------------------------
// fake scrollable — installed once per test file
// ---------------------------------------------------------------------------
const scrollState = new WeakMap<Element, { top: number }>();
const smoothTargets = new WeakMap<Element, number>();
// (element, behavior) -> scrollTo calls, for the "no instant re-scroll"
// assertion.
const scrollCalls: Array<{ el: Element; top: number; behavior: ScrollBehavior | "instant" }> = [];

function installScrollFakes(): void {
  const p = window.HTMLElement.prototype as unknown as {
    scrollTop?: number;
    scrollLeft?: number;
    clientHeight?: number;
    clientWidth?: number;
    scrollTo?: (o: { top: number; behavior?: ScrollBehavior }) => void;
  };
  Object.defineProperty(p, "scrollTop", {
    configurable: true,
    get(this: Element): number {
      return scrollState.get(this)?.top ?? 0;
    },
    set(this: Element, v: number) {
      const st = scrollState.get(this) ?? { top: 0 };
      const next = Math.max(0, v);
      if (Math.abs(next - st.top) < 0.001) return;
      st.top = next;
      scrollState.set(this, st);
      this.dispatchEvent(new Event("scroll"));
    },
  });
  Object.defineProperty(p, "scrollLeft", {
    configurable: true,
    get(): number {
      return 0;
    },
    set(): void {},
  });
  Object.defineProperty(p, "clientHeight", {
    configurable: true,
    get(): number {
      return 800;
    },
  });
  Object.defineProperty(p, "clientWidth", {
    configurable: true,
    get(): number {
      return 1200;
    },
  });
  if (typeof p.scrollTo !== "function") {
    p.scrollTo = function (this: Element, o: { top: number; behavior?: ScrollBehavior }): void {
      const behavior = o.behavior ?? "instant";
      scrollCalls.push({ el: this, top: Math.round(o.top), behavior });
      if (behavior === "smooth") {
        smoothTargets.set(this, Math.max(0, o.top));
      } else {
        smoothTargets.delete(this);
        (this as unknown as { scrollTop: number }).scrollTop = Math.max(0, o.top);
      }
    };
  }
}

function currentTop(el: Element): number {
  return scrollState.get(el)?.top ?? 0;
}

function parkedSmoothTop(el: Element): number | undefined {
  return smoothTargets.get(el);
}

/** Move `el` toward its parked smooth target by `dt` px (or land). */
function advanceSmooth(el: Element, dt: number): void {
  const target = smoothTargets.get(el);
  if (target === undefined) return;
  const cur = currentTop(el);
  const next = cur < target ? Math.min(target, cur + dt) : Math.max(target, cur - dt);
  (el as unknown as { scrollTop: number }).scrollTop = next;
  if (next === target) smoothTargets.delete(el);
}

/** One virtual animation frame. The component schedules its scroll
 *  handling on `requestAnimationFrame`; with the fake clock installed
 *  (DEF-261) that callback — and any timer due within the frame —
 *  fires on `advanceTimersByTime`, and NO wall-clock time passes, so
 *  the product's 1200ms fallback window can only elapse when a test
 *  advances to it deliberately. */
const FRAME_MS = 25;
async function flushRaf(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

/** Advance the main scroller through `steps` animation frames. */
async function animate(scroller: HTMLElement, steps: number, pxPerStep: number): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    advanceSmooth(scroller, pxPerStep);
    await flushRaf();
  }
}

// ---------------------------------------------------------------------------
// stubs
// ---------------------------------------------------------------------------
function makeDocStub(numPages: number, opts?: { delayGetPage?: () => Promise<void> }): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      if (opts?.delayGetPage !== undefined) {
        await opts.delayGetPage();
      }
      void n;
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
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

const INITIAL_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

interface MountOpts {
  pageCount?: number;
  initial?: PersistedViewer;
  delayGetPage?: () => Promise<void>;
}

interface Harness {
  host: HTMLElement;
  scroller: HTMLElement;
  rail: HTMLElement;
  currentPage: () => number;
  clickThumb: (page: number) => void;
  persistRoundTrip: () => void;
  renderWithInitial: (v: PersistedViewer) => void;
  unmount: () => void;
}

async function mountView(opts: MountOpts = {}): Promise<Harness> {
  installScrollFakes();
  scrollCalls.length = 0;
  const pageCount = opts.pageCount ?? 60;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const engineState = makeEngineState(pageCount);
  const persBox: { v: PersistedViewer | null } = { v: null };
  const nodes = {
    doc: makeDocStub(pageCount, { delayGetPage: opts.delayGetPage }),
    initial: opts.initial ?? INITIAL_VIEWER,
  };

  const render = (): void => {
    act((): void => {
      root.render(
        <DocumentView
          doc={nodes.doc}
          pageCount={pageCount}
          outline={null}
          initial={nodes.initial}
          onPersist={(v): void => {
            persBox.v = v;
          }}
          onDiagnostics={(_d: DocDiagnostics): void => undefined}
          engineState={engineState}
          modified={false}
          canUndo={false}
          saveInPlaceEnabled={false}
          annotations={[]}
          formFields={[]}
          signatures={[]}
          savedSignatures={[]}
          stampAnnotations={[]}
        />,
      );
    });
  };

  render();
  // Settle firstPageSize (the stub's getPage(1) resolves asynchronously
  // unless `delayGetPage` gates it).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  const scroller = host.querySelector<HTMLElement>(".document-scroller");
  const rail = host.querySelector<HTMLElement>(".thumb-scroller-inner");
  if (scroller === null || rail === null) {
    throw new Error("workspace not mounted");
  }

  return {
    host,
    scroller,
    rail,
    currentPage: (): number => persBox.v?.currentPage ?? 1,
    clickThumb: (page: number): void => {
      const item = host.querySelector<HTMLElement>(`.thumb-item[data-page="${page}"]`);
      if (item === null) {
        throw new Error(`thumb ${page} not mounted; scroll the rail first`);
      }
      act((): void => {
        item.click();
      });
    },
    persistRoundTrip: (): void => {
      // Simulate the App round-trip: `initial` becomes the object
      // DocumentView itself persisted (a new object identity, same page).
      if (persBox.v !== null) {
        nodes.initial = { ...persBox.v };
        render();
      }
    },
    renderWithInitial: (v: PersistedViewer): void => {
      nodes.initial = v;
      render();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Position of a page's top inside the scroller (same math jumpToPage uses).
 *  The fake viewport is 1200px wide, so fit-width scale =
 *  (clientWidth - 2*CONTENT_PADDING_PX) / 612pt. */
const FIT_SCALE = (1200 - CONTENT_PADDING_PX * 2) / 612;
function pageTop(page: number): number {
  return slotOffsetTop(page, 792, FIT_SCALE) - CONTENT_PADDING_PX;
}

describe("DEF-098 — thumbnail jump target is sticky", () => {
  // DEF-261 — determinism: the simulation, the component's rAF scroll
  // handling and its JUMP_LOCK_FALLBACK_MS window all run on this
  // virtual clock, so the test's outcome cannot depend on how loaded
  // the host machine is. `Date`/intervals stay real — the component
  // uses neither.
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("click thumb 10 -> currentPage=10 immediately; stays 10 through the smooth scroll; settles at 10", async () => {
    const h = await mountView();
    try {
      // Make thumb 10 reachable (the e2e scrolls the rail first).
      act((): void => {
        h.rail.scrollTop = 2200;
      });
      expect(h.host.querySelector(`.thumb-item[data-page="10"]`)).not.toBeNull();

      const scrollCallsBefore = scrollCalls.length;
      h.clickThumb(10);

      // Optimistic set: the click lands currentPage=10 before the
      // scroller moves.
      expect(h.currentPage()).toBe(10);
      // The click's own smooth scroll was issued (parked), and the
      // mount-sync effect must NOT have re-issued an instant scroll.
      expect(scrollCalls.length).toBe(scrollCallsBefore + 1);
      expect(scrollCalls[scrollCalls.length - 1]).toMatchObject({ behavior: "smooth" });
      expect(parkedSmoothTop(h.scroller)).not.toBeUndefined();

      // Advance the smooth scroll through many intermediate frames.
      // Each frame fires scroll events — the DEF-058 lock must keep
      // currentPage pinned to the target the whole way.
      await animate(h.scroller, 6, 900);
      expect(h.currentPage()).toBe(10);
      // More frames, past the halfway point.
      await animate(h.scroller, 6, 900);
      expect(h.currentPage()).toBe(10);
      // Land.
      await animate(h.scroller, 6, 900);
      expect(h.currentPage()).toBe(10);
      expect(parkedSmoothTop(h.scroller)).toBeUndefined();
      expect(currentTop(h.scroller)).toBeCloseTo(pageTop(10), 0);
    } finally {
      h.unmount();
    }
  });

  it("a stalled animation (fallback window elapsing mid-flight) does NOT overwrite currentPage; target stays sticky", async () => {
    const h = await mountView();
    try {
      act((): void => {
        h.rail.scrollTop = 2200;
      });
      h.clickThumb(10);
      expect(h.currentPage()).toBe(10);

      // Advance partway (the view passes pages 2-5), then STOP
      // emitting scroll events — modelling the main thread stalling
      // mid-smooth-scroll on a busy long.pdf render.
      await animate(h.scroller, 6, 900);
      expect(h.currentPage()).toBe(10);

      // The fallback window elapses with NO scroll events. Old code
      // force-recomputed currentPage from the mid-flight scrollTop
      // here (dragging it to the page the view was passing) and the
      // mount-sync effect then snapped the scroller back to it — the
      // "briefly 8/9, then snaps back" failure. The target must hold.
      // DEF-261 — elapse the window on the virtual clock (the product
      // armed it with the faked `setTimeout`), so this is a real
      // expiry of the fallback, not a wall-clock sleep.
      await act(async () => {
        vi.advanceTimersByTime(1400);
      });
      expect(h.currentPage()).toBe(10);

      // Resume the animation; it settles on the target.
      await animate(h.scroller, 20, 900);
      expect(h.currentPage()).toBe(10);
      expect(currentTop(h.scroller)).toBeCloseTo(pageTop(10), 0);
    } finally {
      h.unmount();
    }
  });

  it("a persist round-trip does not re-fire a competing jump (no new scrollTo)", async () => {
    const h = await mountView();
    try {
      act((): void => {
        h.rail.scrollTop = 2200;
      });
      h.clickThumb(10);
      expect(h.currentPage()).toBe(10);
      const afterClick = scrollCalls.length;

      // App persist round-trip: `initial` becomes a NEW object with
      // currentPage=10. The restore effect must not re-issue a jump
      // (the old deps re-ran it on every round-trip).
      h.persistRoundTrip();
      expect(scrollCalls.length).toBe(afterClick);
      expect(h.currentPage()).toBe(10);

      // Another round-trip with a different persisted shape (zoom
      // changed) — still no re-jump.
      h.renderWithInitial({ ...INITIAL_VIEWER, manualScale: 1.5, currentPage: 10 });
      expect(scrollCalls.length).toBe(afterClick);
      expect(h.currentPage()).toBe(10);
    } finally {
      h.unmount();
    }
  });

  it("after the jump lands, a genuine user scroll resumes the heuristic and the scroller is not re-snapped", async () => {
    const h = await mountView();
    try {
      act((): void => {
        h.rail.scrollTop = 2200;
      });
      h.clickThumb(10);
      await animate(h.scroller, 18, 900);
      expect(h.currentPage()).toBe(10);
      expect(currentTop(h.scroller)).toBeCloseTo(pageTop(10), 0);

      // User scrolls back to page 3 and stops.
      const top3 = pageTop(3);
      const callsBefore = scrollCalls.length;
      act((): void => {
        h.scroller.scrollTop = top3;
      });
      await flushRaf();
      expect(h.currentPage()).toBe(3);
      // The mount-sync effect must not have issued any scrollTo (no
      // re-snap back toward the old jump target).
      expect(scrollCalls.length).toBe(callsBefore);
      expect(currentTop(h.scroller)).toBeCloseTo(top3, 0);
    } finally {
      h.unmount();
    }
  });

  it("a jump queued before firstPageSize resolves lands on the target when the geometry arrives", async () => {
    let releaseGeometry: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGeometry = resolve;
    });
    const h = await mountView({ delayGetPage: async () => gate });
    try {
      // Thumb is rendered even before geometry (fixed rail width).
      act((): void => {
        h.rail.scrollTop = 2200;
      });
      h.clickThumb(10);
      // Optimistic currentPage; no scroll possible yet (no geometry).
      expect(h.currentPage()).toBe(10);
      expect(currentTop(h.scroller)).toBe(0);

      // Geometry arrives; the mount-sync effect must land the queued
      // jump.
      await act(async () => {
        releaseGeometry();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(h.currentPage()).toBe(10);
      expect(currentTop(h.scroller)).toBeCloseTo(pageTop(10), 0);
    } finally {
      h.unmount();
    }
  });
});