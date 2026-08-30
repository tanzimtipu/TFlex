// @vitest-environment jsdom
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  dispatchMenuAction,
  gateOnActiveDoc,
  menuActionRequiresActiveDoc,
  snapshotMenuEnabled,
  type MenuActionContext,
} from "../../../src/renderer/state/menuActions";

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
  createFromImages: Mock;
  exportPages: Mock;
  exportText: Mock;
  exportDocx: Mock;
  insertPages: Mock;
  recognizeText: Mock;
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
  const createFromImages = vi.fn();
  const exportPages = vi.fn();
  const exportText = vi.fn();
  const exportDocx = vi.fn();
  const insertPages = vi.fn();
  const recognizeText = vi.fn();
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
    createFromImages: () => createFromImages(),
    exportPages: () => exportPages(),
    exportText: () => exportText(),
    exportDocx: () => exportDocx(),
    insertPages: () => insertPages(),
    recognizeText: () => recognizeText(),
  };
  return {
    ctx,
    spies: {
      open, merge, save, saveAs, closeTab, undo, redo, toggleTheme,
      showToolsPalette, about, preferences, optimize, auditSpace,
      createFromImages, exportPages, exportText, exportDocx, insertPages,
      recognizeText,
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

  it("Tools -> Create from Images opens the Create dialog", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("createFromImages", ctx)).toBe(true);
    expect(spies.createFromImages).toHaveBeenCalledTimes(1);
    expect(spies.exportPages).not.toHaveBeenCalled();
  });

  it("Tools -> Export Pages opens the Export dialog", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("exportPages", ctx)).toBe(true);
    expect(spies.exportPages).toHaveBeenCalledTimes(1);
    expect(spies.createFromImages).not.toHaveBeenCalled();
  });

  it("Tools -> Export Text opens the Text Export dialog", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("exportText", ctx)).toBe(true);
    expect(spies.exportText).toHaveBeenCalledTimes(1);
    expect(spies.exportDocx).not.toHaveBeenCalled();
    expect(spies.insertPages).not.toHaveBeenCalled();
  });

  it("Tools -> Export to Word opens the DOCX dialog", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("exportDocx", ctx)).toBe(true);
    expect(spies.exportDocx).toHaveBeenCalledTimes(1);
    expect(spies.exportText).not.toHaveBeenCalled();
  });

  it("Tools -> Insert Pages opens the Insert dialog", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("insertPages", ctx)).toBe(true);
    expect(spies.insertPages).toHaveBeenCalledTimes(1);
  });

  it("Tools -> Recognize Text opens the OCR dialog", () => {
    const { ctx, spies } = buildCtx();
    expect(dispatchMenuAction("recognizeText", ctx)).toBe(true);
    expect(spies.recognizeText).toHaveBeenCalledTimes(1);
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
      "createFromImages",
      "exportPages",
      "exportText",
      "exportDocx",
      "insertPages",
      "recognizeText",
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
    expect(spies.createFromImages).toHaveBeenCalledTimes(1);
    expect(spies.exportPages).toHaveBeenCalledTimes(1);
    expect(spies.exportText).toHaveBeenCalledTimes(1);
    expect(spies.exportDocx).toHaveBeenCalledTimes(1);
    expect(spies.insertPages).toHaveBeenCalledTimes(1);
    expect(spies.recognizeText).toHaveBeenCalledTimes(1);
  });
});

describe("DEF-065 — active-doc menu gating (renderer-side safety)", () => {
  it("menuActionRequiresActiveDoc flags only document-bound actions", () => {
    // The visual enable state of the menu is owned by the main
    // process, but the renderer can only guarantee safe behaviour
    // (no crash, no silent error) by gating its own context
    // handlers. The list of "needs a doc" actions is the
    // single source of truth for that gating.
    expect(menuActionRequiresActiveDoc("save")).toBe(true);
    expect(menuActionRequiresActiveDoc("saveAs")).toBe(true);
    expect(menuActionRequiresActiveDoc("closeTab")).toBe(true);
    expect(menuActionRequiresActiveDoc("undo")).toBe(true);
    expect(menuActionRequiresActiveDoc("redo")).toBe(true);
    // Document-agnostic actions.
    expect(menuActionRequiresActiveDoc("open")).toBe(false);
    expect(menuActionRequiresActiveDoc("merge")).toBe(false);
    expect(menuActionRequiresActiveDoc("toggleTheme")).toBe(false);
    expect(menuActionRequiresActiveDoc("about")).toBe(false);
    expect(menuActionRequiresActiveDoc("preferences")).toBe(false);
    expect(menuActionRequiresActiveDoc("zoomIn")).toBe(false);
    expect(menuActionRequiresActiveDoc("fitWidth")).toBe(false);
    expect(menuActionRequiresActiveDoc("showToolsPalette")).toBe(false);
    // Defensive: future / unknown actions should NOT be flagged as
    // doc-required — the renderer doesn't know what they do, so
    // the safest default is to let main decide.
    expect(menuActionRequiresActiveDoc("futurePhase99Action")).toBe(false);
    expect(menuActionRequiresActiveDoc("")).toBe(false);
  });

  it("gateOnActiveDoc invokes the handler when hasActiveDoc is true", () => {
    // Happy path: doc open -> handler runs.
    const handler = vi.fn();
    const wrapped = gateOnActiveDoc(() => true, handler);
    wrapped();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("gateOnActiveDoc is a no-op when hasActiveDoc is false (no crash, no error)", () => {
    // DEF-065: clicking "Save" with no doc open must be a clean
    // no-op, not a "silent error in the background". The renderer's
    // wrapper silently drops the call. The predicate is read on
    // every invocation so a tab opened between two clicks is
    // picked up immediately.
    const handler = vi.fn();
    const hasActiveDoc = vi.fn(() => false);
    const wrapped = gateOnActiveDoc(hasActiveDoc, handler);
    wrapped();
    wrapped();
    wrapped();
    expect(handler).not.toHaveBeenCalled();
    expect(hasActiveDoc).toHaveBeenCalledTimes(3);
  });

  it("gateOnActiveDoc re-reads the predicate on every call (state is fresh)", () => {
    // The predicate is a closure, not a snapshot. The App's
    // `tabsRef.current.activeId` is read at the moment the click
    // arrives, so opening a tab between two menu clicks is
    // reflected in the second call. This pins the contract: the
    // wrapper does NOT capture state at wrap-time.
    const handler = vi.fn();
    let active = false;
    const wrapped = gateOnActiveDoc(() => active, handler);
    wrapped();
    expect(handler).toHaveBeenCalledTimes(0);
    active = true;
    wrapped();
    expect(handler).toHaveBeenCalledTimes(1);
    active = false;
    wrapped();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("snapshotMenuEnabled reports false for every active-doc action when no doc is open", () => {
    // The shape main will consume once the orchestrator amends the
    // IPC contract. The renderer computes the snapshot on every
    // active-id change and ships it to main, which then toggles
    // `MenuItem.enabled` for each matching id. The keys use the
    // canonical `'menu.save'` / `'menu.saveAs'` ids from the
    // shared `MenuItemId` union so the result hands straight to
    // `window.tflex.menu.setEnabled(...)` without a re-map
    // (DEF-065).
    const snap = snapshotMenuEnabled(false);
    expect(snap["menu.save"]).toBe(false);
    expect(snap["menu.saveAs"]).toBe(false);
    expect(snap["menu.closeTab"]).toBe(false);
    expect(snap["menu.undo"]).toBe(false);
    expect(snap["menu.redo"]).toBe(false);
  });

  it("snapshotMenuEnabled reports true for every active-doc action when a doc is open", () => {
    const snap = snapshotMenuEnabled(true);
    expect(snap["menu.save"]).toBe(true);
    expect(snap["menu.saveAs"]).toBe(true);
    expect(snap["menu.closeTab"]).toBe(true);
    expect(snap["menu.undo"]).toBe(true);
    expect(snap["menu.redo"]).toBe(true);
  });

  // DEF-065 — the snapshot's keys must match the shared MenuItemId
  // union in src/shared/types.ts. main looks each id up via
  // `Menu.getApplicationMenu()?.getMenuItemById(id)`; if the renderer
  // ships a different key shape, main's lookup silently fails and
  // the menu items stay enabled. Pin the contract: every shared id
  // appears in the snapshot.
  it("snapshotMenuEnabled keys match the shared MenuItemId union (DEF-065)", () => {
    const snap = snapshotMenuEnabled(true);
    const expectedKeys = [
      "menu.save",
      "menu.saveAs",
      "menu.closeTab",
      "menu.undo",
      "menu.redo",
    ];
    for (const key of expectedKeys) {
      expect(snap).toHaveProperty(key);
    }
    // And the snapshot only carries those keys — anything else
    // would be a stray main-side menu id the renderer doesn't know
    // about, which main would treat as "no change".
    expect(Object.keys(snap).sort()).toEqual(expectedKeys.sort());
  });
});
