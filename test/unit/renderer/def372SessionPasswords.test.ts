// @vitest-environment jsdom
//
// DEF-372 — re-opening the same encrypted file in a session must not re-prompt.
//
// qa's diagnosis: the main-side cache is keyed by the transient engine doc id,
// and the renderer mints a fresh id per open, so a UI re-open never matches it.
// The fix makes the password follow the FILE via a renderer session store
// keyed by the platform-aware path comparison key. These tests pin the store's
// session semantics (re-open no prompt, different file still prompts, restart
// prompts, nothing persisted / never serialised) and a structural guard that
// App wires the recall/remember calls. Mounting the full App is impractical
// (it boots pdf.js + persistence + IPC), so the wiring is pinned by reading
// the source, mirroring the B11 guard test pattern.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { SessionPasswordStore } from "../../../src/renderer/security/sessionPasswords";

const SENTINEL = "def372-canary-not-in-any-output";
const FILE_A = "C:\\Docs\\Protected.PDF";
const FILE_A_VARIANT = "c:/docs/protected.pdf";
const FILE_B = "C:\\Docs\\Other.pdf";

describe("DEF-372 — session password store follows the file", () => {
  it("re-open path: a remembered password is recalled for the same file, regardless of spelling", () => {
    const store = new SessionPasswordStore();
    store.remember(FILE_A, SENTINEL);
    // Close-and-reopen in one session: the store is untouched by tab close.
    expect(store.recall(FILE_A)).toBe(SENTINEL);
    // Any spelling of the same path (separator- or case-variant) matches.
    expect(store.recall(FILE_A_VARIANT)).toBe(SENTINEL);
    expect(store.size).toBe(1);
  });

  it("different file still prompts: a different path has no entry", () => {
    const store = new SessionPasswordStore();
    store.remember(FILE_A, SENTINEL);
    expect(store.recall(FILE_B)).toBeUndefined();
    // A fresh store (the restart case) has nothing either.
    expect(new SessionPasswordStore().recall(FILE_A)).toBeUndefined();
  });

  it("restart prompts again: a fresh store is empty and nothing is persisted", () => {
    const store = new SessionPasswordStore();
    store.remember(FILE_A, SENTINEL);
    expect(store.size).toBe(1);
    // A new instance (what an app restart produces) recalls nothing.
    const afterRestart = new SessionPasswordStore();
    expect(afterRestart.recall(FILE_A)).toBeUndefined();
    expect(afterRestart.size).toBe(0);
    // No web-storage API was touched by the store.
    const dump = JSON.stringify({
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
    });
    expect(dump).not.toContain(SENTINEL);
  });

  it("does not cache a bytes-only open (no stable on-disk identity)", () => {
    const store = new SessionPasswordStore();
    store.remember(null, SENTINEL);
    store.remember("", SENTINEL);
    store.remember("   ", SENTINEL);
    expect(store.size).toBe(0);
    expect(store.recall(null)).toBeUndefined();
  });

  it("does not store an empty password and forget/clear drop entries", () => {
    const store = new SessionPasswordStore();
    store.remember(FILE_A, "");
    expect(store.size).toBe(0);
    store.remember(FILE_A, SENTINEL);
    store.remember(FILE_B, "second");
    expect(store.size).toBe(2);
    store.forget(FILE_A);
    expect(store.recall(FILE_A)).toBeUndefined();
    expect(store.recall(FILE_B)).toBe("second");
    store.clear();
    expect(store.size).toBe(0);
  });

  it("no password reaches any serialised form of the store", () => {
    const store = new SessionPasswordStore();
    store.remember(FILE_A, SENTINEL);
    // JS-private field: not enumerable, so neither the value nor the key leaks.
    expect(JSON.stringify(store)).toBe("{}");
    expect(String(store)).not.toContain(SENTINEL);
    expect(JSON.stringify(Object.getOwnPropertyNames(store))).not.toContain(SENTINEL);
    expect(JSON.stringify(Object.values(store))).not.toContain(SENTINEL);
    expect(store.size).toBe(1);
  });
});

describe("DEF-372 — App wiring consults the session store", () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx"),
    "utf8",
  );

  it("recalls a session password before a path open and remembers a successful one", () => {
    expect(appSource).toMatch(/import\s*\{\s*SessionPasswordStore\s*\}\s*from\s*["']\.\/security\/sessionPasswords["']/);
    expect(appSource).toMatch(/sessionPasswords\.recall\(path\)/);
    expect(appSource).toMatch(/sessionPasswords\.remember\(source\.onDiskPath/);
    expect(appSource).toMatch(/new\s+SessionPasswordStore\(\)/);
  });

  it("never clears the file-keyed cache on tab close (acceptance survives close)", () => {
    // `closeDocument` drops main's per-id password; the renderer file-keyed
    // store must NOT be cleared there, or a re-open would prompt again.
    const closeTabSlice = appSource.slice(appSource.indexOf("const closeTab = useCallback"));
    const upToClose = closeTabSlice.slice(0, closeTabSlice.indexOf("dispatchTabs({ type: \"close\""));
    expect(upToClose).not.toMatch(/sessionPasswords\.(clear|forget)\(/);
  });
});
