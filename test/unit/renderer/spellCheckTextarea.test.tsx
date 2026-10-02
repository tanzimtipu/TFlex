// @vitest-environment jsdom
//
// Phase 82 — the reusable spell-check text surface. Pins the underline
// mirror, the context-menu suggestion popover + correction, and the honest
// off / error states.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { SpellCheckTextarea } from "../../../src/renderer/spell/SpellCheckTextarea";
import type { SpellCheckState } from "../../../src/renderer/spell/useSpellCheck";

type SpellProps = Omit<SpellCheckState, "setEnabled">;

interface HarnessProps {
  initial: string;
  spellCheck: SpellProps;
  onChange: (text: string) => void;
}

function Harness({ initial, spellCheck, onChange }: HarnessProps): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <SpellCheckTextarea
      value={value}
      spellCheck={spellCheck}
      ariaLabel="Editor"
      onChange={(next): void => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function mount(
  initial: string,
  spellCheck: SpellProps,
  onChange: (text: string) => void,
): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(<Harness initial={initial} spellCheck={spellCheck} onChange={onChange} />);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const READY: SpellProps = {
  enabled: true,
  status: "ready",
  dictionary: new Set(["the", "world"]),
  error: null,
};

describe("SpellCheckTextarea", () => {
  it("underlines exactly the misspelled token when ready", () => {
    const m = mount("teh world", READY, () => undefined);
    try {
      const marks = m.host.querySelectorAll("[data-spell-misspelled]");
      expect(marks.length).toBe(1);
      expect(marks[0]?.textContent).toBe("teh");
    } finally {
      m.unmount();
    }
  });

  it("opens a suggestion popover on contextmenu and applies the correction", () => {
    const onChange = vi.fn();
    const m = mount("teh world", READY, onChange);
    try {
      const ta = m.host.querySelector<HTMLTextAreaElement>("textarea");
      if (ta === null) throw new Error("textarea missing");
      act((): void => {
        ta.selectionStart = 0;
        ta.selectionEnd = 0;
      });
      act((): void => {
        ta.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 0,
            clientY: 0,
          }),
        );
      });
      expect(m.host.querySelector("[data-spell-suggest]")).not.toBeNull();
      const suggestion = m.host.querySelector<HTMLButtonElement>("[data-spell-suggestion]");
      expect(suggestion?.textContent).toBe("the");
      act((): void => {
        suggestion?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onChange).toHaveBeenCalledWith("the world");
    } finally {
      m.unmount();
    }
  });

  it("does not open an empty suggestion popover when there are no candidates", () => {
    const m = mount("q".repeat(46), READY, () => undefined);
    try {
      const ta = m.host.querySelector<HTMLTextAreaElement>("textarea");
      if (ta === null) throw new Error("textarea missing");
      act((): void => {
        ta.selectionStart = 0;
        ta.selectionEnd = 0;
      });
      act((): void => {
        ta.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 0,
            clientY: 0,
          }),
        );
      });
      // Misspelled but zero candidates: the handler must bail out (letting
      // the native context menu show) instead of rendering an empty listbox.
      expect(m.host.querySelectorAll("[data-spell-misspelled]").length).toBe(1);
      expect(m.host.querySelector("[data-spell-suggest]")).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("renders a readable off status and no squiggles", () => {
    const m = mount(
      "teh world",
      { enabled: false, status: "off", dictionary: null, error: null },
      () => undefined,
    );
    try {
      expect(m.host.querySelectorAll("[data-spell-misspelled]").length).toBe(0);
      const status = m.host.querySelector("[data-spell-status]");
      expect(status?.textContent?.trim()).toBe("Spell check off");
    } finally {
      m.unmount();
    }
  });

  it("renders a readable error status and no squiggles", () => {
    const m = mount(
      "teh world",
      { enabled: true, status: "error", dictionary: null, error: "read-failed" },
      () => undefined,
    );
    try {
      expect(m.host.querySelectorAll("[data-spell-misspelled]").length).toBe(0);
      const status = m.host.querySelector("[data-spell-status]");
      expect((status?.textContent ?? "").trim().length).toBeGreaterThan(0);
    } finally {
      m.unmount();
    }
  });
});