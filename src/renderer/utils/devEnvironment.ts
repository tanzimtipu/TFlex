// TFL-1143 (TFL-1116 C7b, R09) — the ONE renderer-side development-build flag.
// TFL-1150 (TFL-1144 C2) — the runtime preload signal now WINS over the bundle
// mode.
//
// The Home surface ships bundle-internal DEVELOPMENT FIXTURES (the bundled
// sample PDFs and the "Explore Jovrel" grid). They must NEVER appear in a
// PRODUCTION renderer. The authoritative signal is the PACKAGED state of the
// running app, exposed by the preload bridge as `window.tflex.app.isPackaged`:
// true in a packaged production app, false in an unpackaged dev/e2e run. The
// standard e2e suite runs an UNPACKAGED app from a production-built
// `dist/renderer` bundle, so keying on the bundle mode alone wrongly reported
// production and hid the fixtures.
//
// When the bridge value is absent (jsdom/unit tests, older builds), fall back
// to Vite's statically-replaced environment: a production `vite build` sets
// `import.meta.env.PROD` to true and the fixtures are hidden; the dev server
// and the test runner leave it false and the fixtures stay visible.
//
// Pure and framework-free so it is trivially unit-testable and can be consumed
// by both App and Welcome without a context.

interface RendererEnv {
  readonly DEV?: boolean;
  readonly PROD?: boolean;
}

/** True when this renderer bundle is a development build (or a test run).
 *  False in a packaged production app, where the sample fixtures are hidden. */
export function isDevelopmentBuild(): boolean {
  const bridge = (globalThis as unknown as {
    tflex?: { app?: { isPackaged?: boolean } };
  }).tflex?.app;
  if (bridge && typeof bridge.isPackaged === "boolean") {
    return bridge.isPackaged === false;
  }
  const env = (import.meta as ImportMeta & { env?: RendererEnv }).env;
  if (env === undefined) return true;
  if (env.PROD === true) return false;
  if (env.DEV === false) return false;
  return true;
}
