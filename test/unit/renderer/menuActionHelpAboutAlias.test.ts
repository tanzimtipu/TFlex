// @vitest-environment jsdom
//
// DEF-074 — Help menu entry must open the About sheet.
//
// The defect: the renderer's `dispatchMenuAction` only recognised
// the `'about'` action. The native menu's Help -> About item sends
// the same wire string in production (and may send `'help.about'`
// in some wire shapes the renderer must accept), so the dispatcher
// must route both names to `ctx.about()` without requiring the host
// to maintain two listeners.
//
// The fix: add `case 'help.about':` as a fall-through alias for
// `case 'about':` in `dispatchMenuAction`. `menuActionRequiresActiveDoc`
// already covers `about` and must also cover the alias so the
// active-doc gate treats them identically.
//
// These tests pin the contract:
//   1. dispatchMenuAction('about', ctx) -> ctx.about() invoked.
//   2. dispatchMenuAction('help.about', ctx) -> ctx.about() invoked
//      (alias routes to the same handler — no second host listener
//      required).
//   3. menuActionRequiresActiveDoc('help.about') === false (the
//      alias inherits the same active-doc requirement as 'about').
//   4. Calling both names together fires about twice (no caching
//      regression — both names re-enter the handler).
//   5. Unknown names still return false (alias list is closed).

import { describe, expect, it, vi } from "vitest";
import {
  dispatchMenuAction,
  menuActionRequiresActiveDoc,
  type MenuActionContext,
} from "../../../src/renderer/state/menuActions";

interface Spies {
  about: ReturnType<typeof vi.fn>;
  preferences: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

function buildCtx(): { ctx: MenuActionContext; spies: Spies } {
  const about = vi.fn();
  const preferences = vi.fn();
  const open = vi.fn();
  const save = vi.fn();
  const ctx: MenuActionContext = {
    open: (): void => open(),
    merge: (): void => undefined,
    save: (): void => save(),
    saveAs: (): void => undefined,
    closeTab: (): void => undefined,
    undo: (): void => undefined,
    redo: (): void => undefined,
    toggleTheme: (): void => undefined,
    showToolsPalette: (): void => undefined,
    about: (): void => about(),
    preferences: (): void => preferences(),
    optimize: (): void => undefined,
    auditSpace: (): void => undefined,
    createFromImages: (): void => undefined,
    exportPages: (): void => undefined,
    exportText: (): void => undefined,
    exportDocx: (): void => undefined,
    insertPages: (): void => undefined,
    recognizeText: (): void => undefined,
  };
  return { ctx, spies: { about, preferences, open, save } };
}

describe("dispatchMenuAction — DEF-074 Help menu entry opens About", () => {
  it("Help -> About (action='about') routes to ctx.about()", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("about", ctx)).toBe(true);
    expect(spies.about).toHaveBeenCalledTimes(1);
    expect(spies.preferences).not.toHaveBeenCalled();
  });

  it("Help -> About (action='help.about') routes to ctx.about() — alias to the same handler", () => {
    // The native menu's Help -> About entry is the user's entry
    // point. If the wire string is 'help.about' (some backend
    // builds namespace menu actions by their parent menu), the
    // dispatcher must accept it without a second host listener.
    // The previous dispatcher returned false on 'help.about', the
    // menu IPC layer silently dropped the click, and the About
    // sheet never opened. Pin the alias routing.
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("help.about", ctx)).toBe(true);
    expect(spies.about).toHaveBeenCalledTimes(1);
    expect(spies.preferences).not.toHaveBeenCalled();
    expect(spies.open).not.toHaveBeenCalled();
    expect(spies.save).not.toHaveBeenCalled();
  });

  it("Help -> About (alias 'help.about') does NOT require an active doc — same contract as 'about'", () => {
    // The active-doc gate is the same for both names: the About
    // sheet is reachable from the welcome screen with no doc open.
    expect(menuActionRequiresActiveDoc("about")).toBe(false);
    expect(menuActionRequiresActiveDoc("help.about")).toBe(false);
  });

  it("repeated About dispatches (both names) re-enter ctx.about() without caching", () => {
    // A regression that cached the first fire would skip the
    // second — both the canonical and the alias must re-enter.
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("about", ctx)).toBe(true);
    expect(dispatchMenuAction("about", ctx)).toBe(true);
    expect(dispatchMenuAction("help.about", ctx)).toBe(true);
    expect(dispatchMenuAction("help.about", ctx)).toBe(true);
    expect(spies.about).toHaveBeenCalledTimes(4);
  });

  it("about and help.about are the only two Help -> About wire strings — unknown aliases return false", () => {
    // Future-proof: a typo'd action name (e.g. 'help.About' or
    // 'help_about') must NOT silently route to ctx.about(). The
    // dispatcher is closed: only the canonical name and the
    // documented alias resolve.
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("help.About", ctx)).toBe(false);
    expect(dispatchMenuAction("help_about", ctx)).toBe(false);
    expect(spies.about).not.toHaveBeenCalled();
  });

  it("Help -> About (alias) does not cross-fire into Edit -> Preferences (DEF-038 isolation regression)", () => {
    // DEF-038 regression guard: a future refactor that wires the
    // alias to `ctx.preferences()` would silently route Help ->
    // About to the Preferences sheet. Pin the contract: the alias
    // routes ONLY to ctx.about().
    const { ctx, spies } = buildCtx();
    dispatchMenuAction("help.about", ctx);
    expect(spies.about).toHaveBeenCalledTimes(1);
    expect(spies.preferences).not.toHaveBeenCalled();
  });
});