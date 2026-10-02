// @vitest-environment jsdom
//
// Phase 82 — the spell-check toggle in the Text group. Pins the flipped
// setEnabled call and the aria-pressed mirror.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { act, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { TextPropertiesPanel } from "../../../src/renderer/edit/TextPropertiesPanel";
import { defaultTextStyleValues } from "../../../src/renderer/edit/textStyle";
import type { SpellCheckState } from "../../../src/renderer/spell/useSpellCheck";

let calls: boolean[] = [];

function Host(): ReactElement {
  const [enabled, setEnabled] = useState(true);
  const spellCheck: SpellCheckState = {
    enabled,
    status: "ready",
    dictionary: new Set(["the", "world"]),
    error: null,
    setEnabled: (next): void => {
      calls.push(next);
      setEnabled(next);
    },
  };
  return (
    <TextPropertiesPanel
      open
      values={defaultTextStyleValues("Helvetica")}
      defaults={defaultTextStyleValues("Helvetica")}
      onPatch={(): void => undefined}
      mode="text"
      text="teh"
      onTextChange={(): void => undefined}
      onTextCommit={(): void => undefined}
      focusToken={0}
      spellCheck={spellCheck}
    />
  );
}

describe("TextPropertiesPanel spell-check toggle", () => {
  it("calls setEnabled with the flipped value and mirrors aria-pressed", () => {
    calls = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(<Host />);
    });
    try {
      const btn = host.querySelector<HTMLButtonElement>("[data-txt-spellcheck]");
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("aria-pressed")).toBe("true");
      act((): void => {
        btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(calls).toEqual([false]);
      expect(btn?.getAttribute("aria-pressed")).toBe("false");
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});