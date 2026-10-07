// TFL-1116 C4 (R05) — the ONE surface capability evaluator.
//
// Pure-module tests: no React, no electron, no DOM. They pin the surface
// algebra that `App.tsx` and `AppHeader.tsx` consume, so the "Home has no
// document-only commands" contract cannot silently drift.

import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ONLY_MENU_ACTIONS,
  deriveCommandSurface,
  filterEntriesForSurface,
  filterMenuGroupsForSurface,
  isDocumentOnlyMenuAction,
  type CommandSurface,
} from "../../../src/renderer/state/commandCapability";

interface FixtureEntry {
  id: string;
  label: string;
  action?: string;
}
interface FixtureGroup {
  id: string;
  label: string;
  entries: readonly FixtureEntry[];
}

// Shaped like the audited `menuGroups` literal in App.tsx.
function fixtureGroups(): FixtureGroup[] {
  return [
    {
      id: "file",
      label: "File",
      entries: [
        { id: "open", label: "Open...", action: "open" },
        { id: "merge", label: "Merge...", action: "merge" },
        { id: "save", label: "Save", action: "save" },
        { id: "saveAs", label: "Save As...", action: "saveAs" },
        { id: "closeTab", label: "Close Tab", action: "closeTab" },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      entries: [
        { id: "undo", label: "Undo", action: "undo" },
        { id: "redo", label: "Redo", action: "redo" },
        { id: "prefs", label: "Preferences...", action: "preferences" },
      ],
    },
    {
      id: "view",
      label: "View",
      entries: [
        { id: "theme", label: "Toggle Theme", action: "toggleTheme" },
        { id: "tools", label: "Command Palette...", action: "showToolsPalette" },
      ],
    },
    {
      id: "tools",
      label: "Tools",
      entries: [{ id: "ocr", label: "Recognize Text...", action: "recognizeText" }],
    },
    {
      id: "help",
      label: "Help",
      entries: [
        { id: "check", label: "Check for Update...", action: "checkForUpdate" },
        { id: "about", label: "About Jovrel", action: "about" },
      ],
    },
  ];
}

function actionsOf(groups: readonly FixtureGroup[]): string[] {
  return groups.flatMap((g) => g.entries.map((e) => e.action ?? e.id));
}

describe("commandCapability (TFL-1116 C4 / R05)", () => {
  it("deriveCommandSurface maps the document predicate to the surface", () => {
    expect(deriveCommandSurface(true)).toBe<CommandSurface>("document");
    expect(deriveCommandSurface(false)).toBe<CommandSurface>("home");
  });

  it("DOCUMENT_ONLY_MENU_ACTIONS contains exactly the six document-only ids", () => {
    expect([...DOCUMENT_ONLY_MENU_ACTIONS].sort()).toEqual(
      ["closeTab", "recognizeText", "redo", "save", "saveAs", "undo"].sort(),
    );
    expect(DOCUMENT_ONLY_MENU_ACTIONS.size).toBe(6);
  });

  it("isDocumentOnlyMenuAction classifies the ids (and treats undefined as not document-only)", () => {
    for (const id of DOCUMENT_ONLY_MENU_ACTIONS) {
      expect(isDocumentOnlyMenuAction(id)).toBe(true);
    }
    for (const id of ["open", "merge", "preferences", "toggleTheme", "showToolsPalette", "checkForUpdate", "about"]) {
      expect(isDocumentOnlyMenuAction(id)).toBe(false);
    }
    expect(isDocumentOnlyMenuAction(undefined)).toBe(false);
  });

  it("on home: drops document-only rows, keeps home-safe rows, drops the emptied Tools group", () => {
    const filtered = filterMenuGroupsForSurface(fixtureGroups(), "home");
    expect(actionsOf(filtered)).toEqual([
      "open",
      "merge",
      "preferences",
      "toggleTheme",
      "showToolsPalette",
      "checkForUpdate",
      "about",
    ]);
    // The Tools group held only `recognizeText`, so the whole group is gone.
    expect(filtered.map((g) => g.id)).toEqual(["file", "edit", "view", "help"]);
  });

  it("on document: returns the INPUT unchanged (same reference)", () => {
    const groups = fixtureGroups();
    const filtered = filterMenuGroupsForSurface(groups, "document");
    expect(filtered).toBe(groups);
  });

  it("on home: a group with no document-only rows keeps its identity", () => {
    const groups = fixtureGroups();
    const filtered = filterMenuGroupsForSurface(groups, "home");
    const help = filtered.find((g) => g.id === "help");
    expect(help).toBe(groups.find((g) => g.id === "help"));
  });
});

// DEF-626 — the Command Palette corpus is FLAT (registry entries), so it rides
// `filterEntriesForSurface`: the same algebra on the flat shape.
interface FixtureTool {
  id: string;
  action: string;
}

function fixtureTools(): FixtureTool[] {
  return [
    { id: "save", action: "save" },
    { id: "saveAs", action: "saveAs" },
    { id: "tabClose", action: "closeTab" },
    { id: "tabNew", action: "tabNew" },
    { id: "open", action: "open" },
    { id: "undo", action: "undo" },
    { id: "redo", action: "redo" },
    { id: "recognizeText", action: "recognizeText" },
    { id: "preferences", action: "preferences" },
  ];
}

describe("commandCapability (DEF-626 palette corpus)", () => {
  it("on home: drops every document-only palette row, keeps home-safe rows", () => {
    const filtered = filterEntriesForSurface(fixtureTools(), "home");
    expect(filtered.map((t) => t.id)).toEqual([
      "tabNew",
      "open",
      "preferences",
    ]);
    for (const dropped of ["save", "saveAs", "tabClose", "undo", "redo", "recognizeText"]) {
      expect(filtered.some((t) => t.id === dropped)).toBe(false);
    }
  });

  it("on document: returns the INPUT unchanged (same reference)", () => {
    const tools = fixtureTools();
    const filtered = filterEntriesForSurface(tools, "document");
    expect(filtered).toBe(tools);
    expect(filtered.map((t) => t.id)).toContain("save");
    expect(filtered.map((t) => t.id)).toContain("saveAs");
    expect(filtered.map((t) => t.id)).toContain("tabClose");
  });
});