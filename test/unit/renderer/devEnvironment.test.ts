// TFL-1150 (TFL-1144 C2) — isDevelopmentBuild() runtime-signal contract.
//
// The Home sample fixtures are gated by isDevelopmentBuild(). The gate must
// prefer the RUNTIME packaged signal from the preload bridge
// (`window.tflex.app.isPackaged`, exposed on globalThis in the renderer) over
// the Vite bundle mode, because the standard e2e suite runs an UNPACKAGED app
// from a production-built `dist/renderer` bundle. When the bridge is absent
// (jsdom/unit tests, older builds) the existing Vite env fallback applies.

import { afterEach, describe, expect, it } from "vitest";
import { isDevelopmentBuild } from "../../../src/renderer/utils/devEnvironment";

type TflexGlobal = { tflex?: { app?: { isPackaged?: boolean } } };

function setBridge(value: { app?: { isPackaged?: boolean } } | undefined): void {
  if (value === undefined) {
    delete (globalThis as TflexGlobal).tflex;
    return;
  }
  (globalThis as TflexGlobal).tflex = value;
}

afterEach((): void => {
  delete (globalThis as TflexGlobal).tflex;
});

describe("isDevelopmentBuild() — TFL-1150 runtime packaged signal", () => {
  it("returns false when the bridge reports a packaged app", () => {
    setBridge({ app: { isPackaged: true } });
    expect(isDevelopmentBuild()).toBe(false);
  });

  it("returns true when the bridge reports an unpackaged app", () => {
    setBridge({ app: { isPackaged: false } });
    expect(isDevelopmentBuild()).toBe(true);
  });

  it("falls back to the Vite env when the bridge is absent (test env is non-PROD)", () => {
    // In vitest, import.meta.env.PROD is false, so the fallback returns true.
    setBridge(undefined);
    expect(isDevelopmentBuild()).toBe(true);
  });

  it("ignores an incomplete bridge (app present, isPackaged not a boolean)", () => {
    setBridge({ app: {} });
    expect(isDevelopmentBuild()).toBe(true);
  });
});
