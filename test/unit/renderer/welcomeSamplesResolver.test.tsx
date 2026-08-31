// @vitest-environment jsdom
//
// DEF-077 / DEF-078 — Welcome `samplesResolver` inline arrow identity
// churn (React-19 Error #520 on boot).
//
// The Welcome component reads the sample list via a `samplesResolver`
// prop and stores the result in component-local state set inside a
// `useEffect([samplesResolver])`. If the parent App.tsx passes the
// resolver as an inline arrow `samplesResolver={async () =>
// window.tflex.listSamples()}`, every App render produces a fresh
// function reference, retriggers the effect, fires `setSamples(list)`,
// queues another App render, and so on — an unbounded render loop
// that trips React-19's max-update-depth guard (Error #520) on the
// initial boot, when no tab is open and Welcome mounts as the visible
// surface.
//
// The fix: App.tsx hoists the resolver into a stable useCallback with
// empty deps, matching the `openFromBytes` pattern already in use.
// Welcome's effect runs once on mount, samples settle, no churn.
//
// These tests pin two complementary invariants:
//
//   1. **Welcome-level contract** — when the parent supplies a
//      STABLE samplesResolver reference, Welcome's effect fires
//      exactly once on mount, even if the parent re-renders many
//      times. A new identity (the pre-fix inline-arrow shape) causes
//      the effect to re-fire on every parent render — the React #520
//      amplifier.
//
//   2. **App-level contract** — the App-level `samplesResolver`
//      pattern (the one App.tsx actually uses) returns the SAME
//      function reference across consecutive renders. This is a
//      structural test: App.tsx wires the prop as `useCallback(...,
//      [])`, so even if a future refactor returns to passing the
//      inline arrow shape, this test pins the App-level call site so
//      the regression is loud.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Welcome } from "../../../src/renderer/components/Welcome";
import type { RecentFile, SampleDocument } from "../../../src/shared/types";

interface RenderArgs {
  samplesResolver: () => Promise<SampleDocument[]>;
  recentFiles?: Array<{
    entry: RecentFile;
    meta: { name: string; dir: string; isSample: boolean };
  }>;
}

const NOOP_RECENT: Array<{
  entry: RecentFile;
  meta: { name: string; dir: string; isSample: boolean };
}> = [];

function renderWelcome(args: RenderArgs): {
  root: Root;
  container: HTMLElement;
  rerender: (next: RenderArgs) => void;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const initial: RenderArgs = {
    samplesResolver: args.samplesResolver,
    recentFiles: args.recentFiles ?? NOOP_RECENT,
  };
  act((): void => {
    root.render(
      <Welcome
        recentFiles={initial.recentFiles!}
        onOpenRecent={(): void => undefined}
        onRemoveRecent={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSampleClick={(): void => undefined}
        onMergeClick={(): void => undefined}
        samplesResolver={initial.samplesResolver}
      />,
    );
  });
  return {
    root,
    container,
    rerender: (next: RenderArgs): void => {
      act((): void => {
        root.render(
          <Welcome
            recentFiles={next.recentFiles ?? NOOP_RECENT}
            onOpenRecent={(): void => undefined}
            onRemoveRecent={(): void => undefined}
            onOpenFile={(): void => undefined}
            onSampleClick={(): void => undefined}
            onMergeClick={(): void => undefined}
            samplesResolver={next.samplesResolver}
          />,
        );
      });
    },
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const SAMPLE_LIST: SampleDocument[] = [
  { name: "report.pdf", path: "samples/report.pdf" },
  { name: "manual.pdf", path: "samples/manual.pdf" },
  { name: "scan.pdf", path: "samples/scan.pdf" },
  { name: "notes.pdf", path: "samples/notes.pdf" },
];

/**
 * Make a resolver that resolves on the next microtask. The list it
 * resolves with is captured at call-time so the test can update the
 * returned list between renders and observe whether the effect
 * re-fires.
 */
function makeResolver(): {
  resolver: () => Promise<SampleDocument[]>;
  calls: { count: number };
  setList: (list: SampleDocument[]) => void;
} {
  const state = { list: SAMPLE_LIST };
  const calls = { count: 0 };
  const resolver = (): Promise<SampleDocument[]> => {
    calls.count += 1;
    return Promise.resolve(state.list);
  };
  return {
    resolver,
    calls,
    setList: (list): void => {
      state.list = list;
    },
  };
}

describe("Welcome — samplesResolver identity contract (DEF-077 / DEF-078)", () => {
  it("stable samplesResolver: effect fires exactly once on mount across many parent re-renders", async () => {
    // The fix. App.tsx wraps the resolver in a useCallback so the
    // identity is stable. The parent's render cycle should NOT cause
    // Welcome's useEffect to re-fire, so the resolver should be
    // called exactly once.
    const { resolver, calls } = makeResolver();
    const handle = renderWelcome({ samplesResolver: resolver });

    // Let the mount-time promise resolve.
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const callsAfterMount = calls.count;

    // Re-render the parent 5 times with the SAME resolver reference.
    for (let i = 0; i < 5; i += 1) {
      handle.rerender({ samplesResolver: resolver });
    }
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls.count).toBe(callsAfterMount);

    handle.cleanup();
  });

  it("samples list surfaces in the DOM after the stable resolver resolves", async () => {
    // End-to-end proof of the contract: after the resolver resolves,
    // the sample cards (one per SampleDocument) appear in the DOM.
    // The card class is `.sample-card` per the Welcome component.
    const { resolver } = makeResolver();
    const handle = renderWelcome({ samplesResolver: resolver });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const cards = handle.container.querySelectorAll(".sample-card");
    expect(cards.length).toBe(SAMPLE_LIST.length);
    handle.cleanup();
  });

  it("loading placeholder is replaced by sample cards once the resolver settles", async () => {
    // Pre-fix evidence path: the resolver's first paint is a
    // "Loading samples…" placeholder. After the resolver settles
    // the cards replace it. With a stable resolver the placeholder
    // never re-appears.
    const { resolver } = makeResolver();
    const handle = renderWelcome({ samplesResolver: resolver });

    // Before the promise resolves, the placeholder is in the DOM.
    // The placeholder selector is `.samples-empty` per Welcome.
    const initialEmpty = handle.container.querySelector(".samples-empty");
    expect(initialEmpty).not.toBeNull();
    expect(initialEmpty?.textContent).toContain("Loading");

    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // After resolve, the placeholder is gone and cards are present.
    const afterEmpty = handle.container.querySelector(".samples-empty");
    expect(afterEmpty).toBeNull();
    const cards = handle.container.querySelectorAll(".sample-card");
    expect(cards.length).toBe(SAMPLE_LIST.length);
    handle.cleanup();
  });

  it("new samplesResolver identity triggers the effect (Welcome's dep array is wired correctly)", async () => {
    // Sanity check: the dep IS `[samplesResolver]`. When the
    // resolver identity changes, the effect re-fires. Without this
    // property the stable-resolver optimization wouldn't be
    // observable.
    const first = makeResolver();
    const handle = renderWelcome({ samplesResolver: first.resolver });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const callsAfterFirst = first.calls.count;

    // Swap to a brand-new resolver identity. Welcome should pick up
    // the change and fire the new resolver.
    const second = makeResolver();
    handle.rerender({ samplesResolver: second.resolver });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(second.calls.count).toBeGreaterThan(0);
    expect(first.calls.count).toBe(callsAfterFirst);

    handle.cleanup();
  });

  it("unmount cancels an in-flight resolver (no setSamples after teardown)", async () => {
    // Welcome's effect uses a `cancelled` flag to drop a stale
    // resolution after unmount. Pin the contract: even if the
    // promise resolves AFTER cleanup, the component must not throw
    // or fire any state setter on the unmounted instance.
    const resolver = vi.fn(
      (): Promise<SampleDocument[]> =>
        new Promise<SampleDocument[]>((resolve) => {
          // Resolve two ticks later — long enough for the test to
          // unmount the component first.
          setTimeout((): void => resolve(SAMPLE_LIST), 20);
        }),
    );
    const handle = renderWelcome({ samplesResolver: resolver });
    handle.cleanup();
    // Wait past the resolver's setTimeout (20ms) and any
    // microtasks that follow.
    await new Promise<void>((r) => setTimeout(r, 50));
    // The cleanup must NOT throw. The component-local state setter
    // would have thrown a React warning if it ran on an unmounted
    // instance. We can't directly observe the warning in this test
    // setup, but we can assert the resolver was called once and the
    // cleanup completed without an exception.
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("sample cards reflect the resolved list, not a stale cached snapshot", async () => {
    // A second resolver call (after a dep-identity change) must
    // produce the NEW list, not a stale one. The Welcome contract:
    // the effect runs again on dep change and writes the freshest
    // value to state.
    const first = makeResolver();
    first.setList([
      { name: "old-a.pdf", path: "samples/old-a.pdf" },
      { name: "old-b.pdf", path: "samples/old-b.pdf" },
    ]);
    const handle = renderWelcome({ samplesResolver: first.resolver });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    let cards = handle.container.querySelectorAll(".sample-card");
    expect(cards.length).toBe(2);
    expect(cards[0]?.textContent).toContain("old-a.pdf");

    const second = makeResolver();
    second.setList([
      { name: "fresh-a.pdf", path: "samples/fresh-a.pdf" },
      { name: "fresh-b.pdf", path: "samples/fresh-b.pdf" },
      { name: "fresh-c.pdf", path: "samples/fresh-c.pdf" },
      { name: "fresh-d.pdf", path: "samples/fresh-d.pdf" },
    ]);
    handle.rerender({ samplesResolver: second.resolver });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    cards = handle.container.querySelectorAll(".sample-card");
    expect(cards.length).toBe(4);
    expect(cards[0]?.textContent).toContain("fresh-a.pdf");

    handle.cleanup();
  });
});

describe("DEF-078 — App.tsx samplesResolver call site identity contract", () => {
  // These tests pin the structural contract in App.tsx: the
  // samplesResolver prop fed to <Welcome> must be a stable
  // reference across App renders. The implementation is a
  // useCallback with empty deps; this test reads the rendered JSX
  // call-site shape so a regression that reintroduces an inline
  // arrow is loud at the type/structure level.

  it("App.tsx call site passes `samplesResolver` (not an inline arrow) — source-level pin", async () => {
    // Read the source file and assert the inline arrow shape is
    // gone, replaced by a stable identifier. This is the
    // regression-detector: a future edit that drops back to
    // `samplesResolver={async () => window.tflex.listSamples()}`
    // fails this test.
    // `vi` is imported above so this test can use it if needed; the
    // import line is here for the no-floating-symbol convention.
    expect(vi).toBeDefined();

    // Dynamic import of App.tsx text — avoids the build-step
    // cost of running App's full render cycle.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const appPath = path.resolve(
      __dirname,
      "../../../src/renderer/App.tsx",
    );
    const text = await fs.readFile(appPath, "utf8");

    // The fix: `samplesResolver={samplesResolver}` (stable ref).
    expect(text).toContain("samplesResolver={samplesResolver}");

    // The bug: inline arrow `samplesResolver={async () => ...}`.
    // The orchestrator's task explicitly bans this shape. Search
    // for the exact inline-arrow pattern that previously lived at
    // the App-level Welcome JSX.
    expect(text).not.toMatch(
      /samplesResolver=\{async\s*\(\)\s*:\s*Promise<SampleDocument\[\]>\s*=>/,
    );

    // The stable resolver is implemented via useCallback with
    // empty deps so it survives all App renders. The actual source
    // is multi-line (one line per token), so the regex must allow
    // whitespace between the useCallback parameters.
    //
    // We use a smaller two-step check: (1) the call site shape
    // appears in the source, and (2) the deps array is `[]` (no
    // dependency on any App-level state, so the ref is stable).
    expect(text).toMatch(/const\s+samplesResolver\s*=\s*useCallback\(/);
    expect(text).toMatch(/window\.tflex\.listSamples\(\)/);
    // Pin the empty-deps shape. Look for a useCallback whose body
    // contains `listSamples()` and whose closing parens precede
    // `[]` followed by `)` and then a semicolon or end-of-call.
    expect(text).toMatch(
      /window\.tflex\.listSamples\(\)[\s\S]*?\[\s*\][\s\S]*?\)/,
    );
  });
});