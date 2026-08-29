// @vitest-environment jsdom
import { describe, expect, it, vi, type Mock } from "vitest";
import { dispatchMenuAction, type MenuActionContext } from "../../../src/renderer/state/menuActions";

/**
 * Phase 7 / DEF-038 — the renderer used to listen for a DOM
 * CustomEvent named 'menu:action' that the preload bridge never
 * dispatches. Every menu item (Help -> About, File -> Save, ...)
 * silently failed. The fix is to wire App.tsx to
 * `window.tflex.menu.onAction(...)` and route each action through
 * the pure dispatcher tested here. The dispatcher maps every name
 * in `MenuAction` to exactly one handler in `MenuActionContext`;
 * unknown names return `false` and do nothing.
 */

// vitest's Mock type is also constructable, which makes it
// structurally incompatible with the `() => void` signatures in
// `MenuActionContext` (TypeScript's strict function-type check
// rejects `Mock` because Mock is callable AND constructable,
// while `() => void` is purely callable). We split the context
// (the shape the dispatcher wants) from the spy map (what the
// assertions need). The dispatcher only sees the context.

interface Spies {
  open: Mock;
  merge: Mock;
  save: Mock;
  saveAs: Mock;
  closeTab: Mock;
  undo: Mock;
  redo: Mock;
  toggleTheme: Mock;
  showToolsPalette: Mock;
  about: Mock;
  preferences: Mock;
  optimize: Mock;
  auditSpace: Mock;
}

function buildCtx(): { ctx: MenuActionContext; spies: Spies } {
  const open = vi.fn();
  const merge = vi.fn();
  const save = vi.fn();
  const saveAs = vi.fn();
  const closeTab = vi.fn();
  const undo = vi.fn();
  const redo = vi.fn();
  const toggleTheme = vi.fn();
  const showToolsPalette = vi.fn();
  const about = vi.fn();
  const preferences = vi.fn();
  const optimize = vi.fn();
  const auditSpace = vi.fn();
  const ctx: MenuActionContext = {
    open: () => open(),
    merge: () => merge(),
    save: () => save(),
    saveAs: () => saveAs(),
    closeTab: () => closeTab(),
    undo: () => undo(),
    redo: () => redo(),
    toggleTheme: () => toggleTheme(),
    showToolsPalette: () => showToolsPalette(),
    about: () => about(),
    preferences: () => preferences(),
    optimize: () => optimize(),
    auditSpace: () => auditSpace(),
  };
  return {
    ctx,
    spies: {
      open, merge, save, saveAs, closeTab, undo, redo, toggleTheme,
      showToolsPalette, about, preferences, optimize, auditSpace,
    },
  };
}

describe("dispatchMenuAction — every menu action routes to exactly one handler", () => {
  it("Help -> About opens the About dialog", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("about", ctx)).toBe(true);
    expect(spies.about).toHaveBeenCalledTimes(1);
    expect(spies.preferences).not.toHaveBeenCalled();
  });

  it("Edit -> Preferences opens the Preferences sheet", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("preferences", ctx)).toBe(true);
    expect(spies.preferences).toHaveBeenCalledTimes(1);
  });

  it("File -> Open triggers the file-picker handler", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("open", ctx)).toBe(true);
    expect(spies.open).toHaveBeenCalledTimes(1);
  });

  it("File -> Merge opens the Merge dialog", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("merge", ctx)).toBe(true);
    expect(spies.merge).toHaveBeenCalledTimes(1);
  });

  it("File -> Save / Save As route to the save handlers", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("save", ctx)).toBe(true);
    expect(spies.save).toHaveBeenCalledTimes(1);
    expect(dispatchMenuAction("saveAs", ctx)).toBe(true);
    expect(spies.saveAs).toHaveBeenCalledTimes(1);
  });

  it("File -> Close Tab routes to the closeTab handler", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("closeTab", ctx)).toBe(true);
    expect(spies.closeTab).toHaveBeenCalledTimes(1);
  });

  it("Edit -> Undo / Redo route to the engine undo/redo handlers", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("undo", ctx)).toBe(true);
    expect(spies.undo).toHaveBeenCalledTimes(1);
    expect(dispatchMenuAction("redo", ctx)).toBe(true);
    expect(spies.redo).toHaveBeenCalledTimes(1);
  });

  it("View -> Toggle Theme flips the theme handler", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("toggleTheme", ctx)).toBe(true);
    expect(spies.toggleTheme).toHaveBeenCalledTimes(1);
  });

  it("Tools -> Show Tools Palette toggles the palette", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("showToolsPalette", ctx)).toBe(true);
    expect(spies.showToolsPalette).toHaveBeenCalledTimes(1);
  });

  it("Tools -> Optimize opens the Optimize dialog", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("optimize", ctx)).toBe(true);
    expect(spies.optimize).toHaveBeenCalledTimes(1);
    expect(spies.auditSpace).not.toHaveBeenCalled();
  });

  it("Tools -> Audit Space opens the Audit Space dialog", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("auditSpace", ctx)).toBe(true);
    expect(spies.auditSpace).toHaveBeenCalledTimes(1);
    expect(spies.optimize).not.toHaveBeenCalled();
  });
});

describe("dispatchMenuAction — zoom / fit actions are claimed (DocumentView handles them)", () => {
  it.each(["zoomIn", "zoomOut", "fitWidth", "fitPage"])(
    "claims %s without invoking a context handler",
    (action) => {
      const { ctx, spies } = buildCtx();
      expect(dispatchMenuAction(action, ctx)).toBe(true);
      // DocumentView owns the keyboard listener for these actions;
      // the dispatcher still reports them as handled so the IPC
      // layer can log/ignore them as recognised.
      for (const fn of Object.values(spies)) {
        expect(fn).not.toHaveBeenCalled();
      }
    },
  );
});

describe("dispatchMenuAction — unknown actions are silently ignored", () => {
  it("returns false for a future menu item the renderer doesn't know about", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("futureActionFromPhase99", ctx)).toBe(false);
    for (const fn of Object.values(spies)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("returns false for the empty string (defensive — main should never send this)", () => {
    const { ctx } = buildCtx();
    expect(dispatchMenuAction("", ctx)).toBe(false);
  });
});

describe("dispatchMenuAction — handler isolation (DEF-038 regression)", () => {
  it("clicking About does not also open Preferences (no cross-fire)", () => {
    const { ctx, spies } = buildCtx();
    dispatchMenuAction("about", ctx);
    expect(spies.about).toHaveBeenCalledTimes(1);
    expect(spies.preferences).not.toHaveBeenCalled();
    expect(spies.open).not.toHaveBeenCalled();
    expect(spies.save).not.toHaveBeenCalled();
  });

  it("every dispatched action invokes exactly one handler", () => {
    const { ctx, spies } = buildCtx();
    const actions = [
      "open",
      "merge",
      "save",
      "saveAs",
      "closeTab",
      "undo",
      "redo",
      "toggleTheme",
      "showToolsPalette",
      "about",
      "preferences",
      "optimize",
      "auditSpace",
    ] as const;
    for (const action of actions) {
      dispatchMenuAction(action, ctx);
    }
    expect(spies.open).toHaveBeenCalledTimes(1);
    expect(spies.merge).toHaveBeenCalledTimes(1);
    expect(spies.save).toHaveBeenCalledTimes(1);
    expect(spies.saveAs).toHaveBeenCalledTimes(1);
    expect(spies.closeTab).toHaveBeenCalledTimes(1);
    expect(spies.undo).toHaveBeenCalledTimes(1);
    expect(spies.redo).toHaveBeenCalledTimes(1);
    expect(spies.toggleTheme).toHaveBeenCalledTimes(1);
    expect(spies.showToolsPalette).toHaveBeenCalledTimes(1);
    expect(spies.about).toHaveBeenCalledTimes(1);
    expect(spies.preferences).toHaveBeenCalledTimes(1);
    expect(spies.optimize).toHaveBeenCalledTimes(1);
    expect(spies.auditSpace).toHaveBeenCalledTimes(1);
  });
});
