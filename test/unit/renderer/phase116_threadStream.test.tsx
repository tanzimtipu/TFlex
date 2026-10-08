// @vitest-environment jsdom
//
// Phase 116 (TFL-1228 chunk C) - Thread Stream primitives.
//
// Pins the presentational contract of AnnotationFilterBar, ThreadStreamRow and
// AnnotationEmptyState: filter hooks + aria-pressed, the author fallback (no
// invented initials), the comment-count chip, the absence of a colour strip,
// and both empty-state variants.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import {
  AnnotationEmptyState,
  AnnotationFilterBar,
  ThreadStreamRow,
} from "../../../src/renderer/annotations/ThreadStream";
import {
  countByKind,
  type Annotation,
  type AnnotationKind,
  type MarkupAnnotation,
} from "../../../src/renderer/annotations/model";

const NOOP = (): void => undefined;

function mount(element: ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
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

function highlight(overrides: Partial<MarkupAnnotation> = {}): Annotation {
  return {
    id: "ann-1",
    page: 3,
    color: "yellow",
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "highlight",
    rects: [],
    text: "the covered text",
    ...overrides,
  };
}

const ZERO_COUNTS: Record<AnnotationKind, number> = countByKind([]);

describe("Phase 116 - AnnotationFilterBar", () => {
  it("renders All plus only the kinds with a non-zero count, with aria-pressed", () => {
    const m = mount(
      <AnnotationFilterBar
        value="all"
        onChange={NOOP}
        counts={{ ...ZERO_COUNTS, highlight: 2, note: 1 }}
        total={3}
      />,
    );
    try {
      const buttons = m.host.querySelectorAll("[data-ann-filter]");
      // All + highlight + note; no zero-count kinds.
      expect(buttons).toHaveLength(3);
      expect(m.host.querySelector('[data-ann-filter="all"]')?.getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(m.host.querySelector('[data-ann-filter="highlight"]')).not.toBeNull();
      expect(m.host.querySelector('[data-ann-filter="note"]')).not.toBeNull();
      expect(m.host.querySelector('[data-ann-filter="ink"]')).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("moves aria-pressed to the selected kind and reports the click", () => {
    const onChange = vi.fn((_f: unknown): void => undefined);
    const m = mount(
      <AnnotationFilterBar
        value="highlight"
        onChange={onChange}
        counts={{ ...ZERO_COUNTS, highlight: 2 }}
        total={2}
      />,
    );
    try {
      expect(
        m.host.querySelector('[data-ann-filter="highlight"]')?.getAttribute("aria-pressed"),
      ).toBe("true");
      expect(m.host.querySelector('[data-ann-filter="all"]')?.getAttribute("aria-pressed")).toBe(
        "false",
      );
      act((): void => {
        m.host.querySelector<HTMLButtonElement>('[data-ann-filter="all"]')?.click();
      });
      expect(onChange).toHaveBeenCalledWith("all");
    } finally {
      m.unmount();
    }
  });
});

describe("Phase 116 - ThreadStreamRow", () => {
  it("shows the real author when the document provides one", () => {
    const m = mount(
      <ThreadStreamRow
        annotation={highlight({ author: "Ada Example" })}
        commentCount={0}
        selected={false}
        onJumpTo={NOOP}
        onDelete={NOOP}
      />,
    );
    try {
      expect(m.host.querySelector("[data-annotation-row]")?.getAttribute("data-annotation-row")).toBe(
        "ann-1",
      );
      expect(m.host.querySelector("[data-ann-author]")?.textContent).toBe("Ada Example");
    } finally {
      m.unmount();
    }
  });

  it("shows the kind label and NO initials when the author is absent", () => {
    const m = mount(
      <ThreadStreamRow
        annotation={highlight()}
        commentCount={0}
        selected={false}
        onJumpTo={NOOP}
        onDelete={NOOP}
      />,
    );
    try {
      expect(m.host.querySelector("[data-ann-author]")).toBeNull();
      expect(m.host.querySelector("[data-ann-kind]")?.textContent).toBe("Highlight");
      expect(m.host.innerHTML).not.toContain("AE");
      expect(m.host.querySelector(".ann-panel-swatch")).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("renders the comment chip only when commentCount > 0", () => {
    const withCount = mount(
      <ThreadStreamRow
        annotation={highlight()}
        commentCount={4}
        selected={true}
        onJumpTo={NOOP}
        onDelete={NOOP}
      />,
    );
    try {
      const row = withCount.host.querySelector(".thread-stream-row");
      expect(row?.getAttribute("data-ann-selected")).toBe("true");
      expect(withCount.host.querySelector("[data-ann-comment-count]")?.textContent).toBe("4");
    } finally {
      withCount.unmount();
    }
    const without = mount(
      <ThreadStreamRow
        annotation={highlight()}
        commentCount={0}
        selected={false}
        onJumpTo={NOOP}
        onDelete={NOOP}
      />,
    );
    try {
      expect(without.host.querySelector("[data-ann-comment-count]")).toBeNull();
      expect(without.host.querySelector(".ann-panel-swatch")).toBeNull();
    } finally {
      without.unmount();
    }
  });
});

describe("Phase 116 - AnnotationEmptyState", () => {
  it("document variant exposes the tools action", () => {
    const onOpenTools = vi.fn((): void => undefined);
    const m = mount(<AnnotationEmptyState variant="document" onOpenTools={onOpenTools} />);
    try {
      expect(m.host.querySelector("[data-annotation-empty]")).not.toBeNull();
      const action = m.host.querySelector<HTMLElement>("[data-ann-empty-action]");
      expect(action?.textContent).toBe("Open annotation tools");
      act((): void => {
        action?.click();
      });
      expect(onOpenTools).toHaveBeenCalledTimes(1);
    } finally {
      m.unmount();
    }
  });

  it("document variant without a handler renders no tools action", () => {
    const m = mount(<AnnotationEmptyState variant="document" />);
    try {
      expect(m.host.querySelector("[data-annotation-empty]")).not.toBeNull();
      expect(m.host.querySelector("[data-ann-empty-action]")).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("filter variant has its own hook and no tools action", () => {
    const m = mount(<AnnotationEmptyState variant="filter" onOpenTools={NOOP} />);
    try {
      expect(m.host.querySelector("[data-ann-filtered-empty]")).not.toBeNull();
      expect(m.host.querySelector("[data-ann-empty-action]")).toBeNull();
    } finally {
      m.unmount();
    }
  });
});
