// @vitest-environment jsdom
//
// Phase 28 (chunk 3) - the annotation COMMENT BOX and the comment ICON.
//
// Coverage:
//   (a) the badge renders ONLY for annotations that have a thread, and it
//       appears the moment the first comment lands;
//   (b) the comment box mounts when an annotation is SELECTED and lists
//       the thread oldest-first (original distinct from replies);
//   (c) submitting a comment / reply calls `addComment` with the right
//       args and the list refreshes;
//   (d) the empty state ("Add a comment") renders for a thread-less
//       annotation;
//   (e) the badge does not intercept the annotation's selection gesture;
//   plus the placement math (clear of the annotation and the action bar,
//   clamped to the page view) and the time formatter.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useState } from "react";
import type { ReactElement } from "react";
import {
  AnnotationOverlay,
  type AnnotationOverlayProps,
} from "../../../src/renderer/annotations/AnnotationOverlay";
import {
  COMMENT_BOX_MIN_BELOW,
  COMMENT_BOX_WIDTH,
  commentBoxPlacement,
  formatCommentTime,
} from "../../../src/renderer/annotations/AnnotationCommentBox";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";
import type { CommentThread } from "../../../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

const RECT_ANN: Annotation = {
  id: "rect-1",
  kind: "rect",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 150, height: 80 },
};

const RECT_ANN_2: Annotation = {
  id: "rect-2",
  kind: "rect",
  page: 1,
  color: "red",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 320, y: 300, width: 120, height: 60 },
};

const THREAD_ONE: CommentThread = {
  annotationId: "rect-1",
  entries: [
    { id: "cmt-1", author: "You", text: "First thought", createdAt: Date.now() - 60_000 },
  ],
};

const THREAD_TWO: CommentThread = {
  annotationId: "rect-1",
  entries: [
    { id: "cmt-1", author: "You", text: "First thought", createdAt: Date.now() - 60_000 },
    { id: "cmt-2", author: "Dana", text: "A reply", createdAt: Date.now() - 5_000 },
  ],
};

/** Stateful host mirroring App: it owns the thread list and re-renders the
 *  overlay with the refreshed `comments` after `addComment` (exactly what
 *  the engine echo + `noteOpApplied` do in production). */
function CommentsHost(props: {
  annotations: Annotation[];
  initialComments: CommentThread[];
  onAddComment: (annotationId: string, text: string) => void;
}): ReactElement {
  const [comments, setComments] = useState<CommentThread[]>(props.initialComments);
  const add = (annotationId: string, text: string): void => {
    props.onAddComment(annotationId, text);
    setComments((prev) => {
      const next = prev.map((t) => ({ ...t, entries: t.entries.slice() }));
      const entry = {
        id: `cmt-${next.length}-${text}`,
        author: "You",
        text,
        createdAt: Date.now(),
      };
      const thread = next.find((t) => t.annotationId === annotationId);
      if (thread !== undefined) thread.entries.push(entry);
      else next.push({ annotationId, entries: [entry] });
      return next;
    });
  };
  const overlayProps: AnnotationOverlayProps = {
    page: 1,
    widthPt: 612,
    heightPt: 792,
    cssScale: 1,
    annotations: props.annotations,
    tool: SELECT_TOOL,
    flashId: null,
    getTextItems: (): never[] => [],
    onCreate: (): void => undefined,
    comments,
    onAddComment: add,
  };
  return <AnnotationOverlay {...overlayProps} />;
}

const liveRoots: ReturnType<typeof createRoot>[] = [];

interface Harness {
  host: HTMLElement;
  onAddComment: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

function mountComments(args: {
  annotations: Annotation[];
  initialComments?: CommentThread[];
}): Harness {
  while (liveRoots.length > 0) {
    const prev = liveRoots.pop();
    if (prev === undefined) continue;
    act((): void => {
      prev.unmount();
    });
  }
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  Element.prototype.setPointerCapture = function (): void { /* no-op */ };
  Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
  const root = createRoot(host);
  liveRoots.push(root);
  const onAddComment = vi.fn();
  act((): void => {
    root.render(
      <CommentsHost
        annotations={args.annotations}
        initialComments={args.initialComments ?? []}
        onAddComment={onAddComment}
      />,
    );
  });
  return {
    host,
    onAddComment,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickEl(el: Element | null): void {
  act((): void => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function pointerDown(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId: 1,
      }),
    );
  });
}

function typeInto(el: HTMLTextAreaElement | null, value: string): void {
  if (el === null) throw new Error("comment input not found");
  act((): void => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function badge(host: HTMLElement, id: string): Element | null {
  return host.querySelector(`[data-ann-comment-icon='${id}']`);
}

function box(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>("[data-ann-comment-box]");
}

function selectRect(host: HTMLElement, id = "rect-1"): void {
  clickEl(host.querySelector(`.ann-shape[data-annotation-id='${id}']`));
}

describe("Phase 28 (a) - the badge renders only for annotations WITH a thread", () => {
  it("draws NO badge when no annotation has a thread", () => {
    const { host, cleanup } = mountComments({ annotations: [RECT_ANN, RECT_ANN_2] });
    try {
      expect(host.querySelector("[data-ann-comment-icon]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("draws the badge only on the annotated element that has a thread", () => {
    const { host, cleanup } = mountComments({
      annotations: [RECT_ANN, RECT_ANN_2],
      initialComments: [THREAD_ONE],
    });
    try {
      expect(badge(host, "rect-1"), "commented element has the badge").not.toBeNull();
      expect(badge(host, "rect-2"), "uncommented element has none").toBeNull();
    } finally {
      cleanup();
    }
  });

  it("shows the entry count when the thread has replies", () => {
    const { host, cleanup } = mountComments({
      annotations: [RECT_ANN],
      initialComments: [THREAD_TWO],
    });
    try {
      const el = badge(host, "rect-1");
      expect(el).not.toBeNull();
      expect(el?.querySelector(".ann-comment-icon-count")?.textContent).toBe("2");
    } finally {
      cleanup();
    }
  });

  it("appears IMMEDIATELY after the first comment is added", () => {
    const { host, cleanup } = mountComments({ annotations: [RECT_ANN] });
    try {
      expect(badge(host, "rect-1")).toBeNull();
      selectRect(host);
      typeInto(host.querySelector<HTMLTextAreaElement>("[data-comment-input]"), "look here");
      clickEl(host.querySelector("[data-comment-submit]"));
      expect(badge(host, "rect-1"), "badge flips on with the first comment").not.toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("Phase 28 (b) - the comment box appears on SELECTION and lists the thread", () => {
  it("is absent until the annotation is selected, then mounts", () => {
    const { host, cleanup } = mountComments({
      annotations: [RECT_ANN],
      initialComments: [THREAD_ONE],
    });
    try {
      expect(box(host), "no box before selection").toBeNull();
      selectRect(host);
      expect(box(host), "box mounts on selection").not.toBeNull();
      expect(box(host)?.getAttribute("data-ann-comment-box")).toBe("rect-1");
    } finally {
      cleanup();
    }
  });

  it("lists the entries oldest-first with the original visually distinct", () => {
    const { host, cleanup } = mountComments({
      annotations: [RECT_ANN],
      initialComments: [THREAD_TWO],
    });
    try {
      selectRect(host);
      const entries = Array.from(host.querySelectorAll("[data-comment-entry]"));
      expect(entries.length).toBe(2);
      expect(entries[0]?.getAttribute("data-comment-role")).toBe("original");
      expect(entries[1]?.getAttribute("data-comment-role")).toBe("reply");
      expect(entries[0]?.textContent).toContain("First thought");
      expect(entries[1]?.textContent).toContain("A reply");
      expect(entries[0]?.classList.contains("ann-comment-entry-original")).toBe(true);
      expect(entries[1]?.classList.contains("ann-comment-entry-original")).toBe(false);
      // Author + time are both shown on the entry.
      expect(entries[0]?.querySelector(".ann-comment-author")?.textContent).toBe("You");
      expect(entries[1]?.querySelector(".ann-comment-author")?.textContent).toBe("Dana");
      expect(entries[0]?.querySelector("time")?.textContent).not.toBe("");
    } finally {
      cleanup();
    }
  });

  it("switches the box to the newly selected annotation", () => {
    const { host, cleanup } = mountComments({
      annotations: [RECT_ANN, RECT_ANN_2],
      initialComments: [THREAD_ONE],
    });
    try {
      selectRect(host, "rect-2");
      expect(box(host)?.getAttribute("data-ann-comment-box")).toBe("rect-2");
      // rect-2 has no thread -> the empty state, not rect-1's entry.
      expect(host.querySelector("[data-comment-empty]")).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("Phase 28 (c) - submitting a comment / reply", () => {
  it("calls addComment with the annotation id + trimmed text and refreshes the list", () => {
    const { host, onAddComment, cleanup } = mountComments({ annotations: [RECT_ANN] });
    try {
      selectRect(host);
      typeInto(host.querySelector<HTMLTextAreaElement>("[data-comment-input]"), "  needs a fix  ");
      clickEl(host.querySelector("[data-comment-submit]"));
      expect(onAddComment).toHaveBeenCalledTimes(1);
      expect(onAddComment.mock.calls[0]).toEqual(["rect-1", "needs a fix"]);
      const entries = Array.from(host.querySelectorAll("[data-comment-entry]"));
      expect(entries.length).toBe(1);
      expect(entries[0]?.textContent).toContain("needs a fix");
      // The empty state is gone and the input was cleared.
      expect(host.querySelector("[data-comment-empty]")).toBeNull();
      expect(host.querySelector<HTMLTextAreaElement>("[data-comment-input]")?.value).toBe("");
    } finally {
      cleanup();
    }
  });

  it("appends a reply as a second entry and keeps the original first", () => {
    const { host, onAddComment, cleanup } = mountComments({
      annotations: [RECT_ANN],
      initialComments: [THREAD_ONE],
    });
    try {
      selectRect(host);
      typeInto(host.querySelector<HTMLTextAreaElement>("[data-comment-input]"), "I agree");
      clickEl(host.querySelector("[data-comment-submit]"));
      expect(onAddComment).toHaveBeenCalledWith("rect-1", "I agree");
      const entries = Array.from(host.querySelectorAll("[data-comment-entry]"));
      expect(entries.length).toBe(2);
      expect(entries[0]?.getAttribute("data-comment-role")).toBe("original");
      expect(entries[1]?.getAttribute("data-comment-role")).toBe("reply");
      expect(entries[1]?.textContent).toContain("I agree");
      // The submit label follows the thread state (Reply once one exists).
      expect(host.querySelector("[data-comment-submit]")?.textContent).toContain("Reply");
    } finally {
      cleanup();
    }
  });

  it("disables submit for empty / whitespace-only text (no engine call)", () => {
    const { host, onAddComment, cleanup } = mountComments({ annotations: [RECT_ANN] });
    try {
      selectRect(host);
      const submit = host.querySelector<HTMLButtonElement>("[data-comment-submit]");
      expect(submit?.disabled).toBe(true);
      typeInto(host.querySelector<HTMLTextAreaElement>("[data-comment-input]"), "   ");
      expect(host.querySelector<HTMLButtonElement>("[data-comment-submit]")?.disabled).toBe(true);
      clickEl(host.querySelector("[data-comment-submit]"));
      expect(onAddComment).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

describe("Phase 28 (d) - the empty state", () => {
  it("renders 'Add a comment' for a selected annotation with no thread", () => {
    const { host, cleanup } = mountComments({ annotations: [RECT_ANN] });
    try {
      selectRect(host);
      const empty = host.querySelector("[data-comment-empty]");
      expect(empty, "empty state present").not.toBeNull();
      expect(empty?.textContent).toBe("Add a comment");
      expect(host.querySelector("[data-comment-entry]")).toBeNull();
      expect(host.querySelector("[data-comment-submit]")?.textContent).toContain("Comment");
    } finally {
      cleanup();
    }
  });
});

describe("Phase 28 (e) - the badge does not intercept the annotation's gestures", () => {
  it("is an indicator: pointer-events none in the stylesheet and inline, no handler", () => {
    // jsdom does not hit-test (elementFromPoint returns null), so the
    // "the browser delivers the press to the annotation, not the badge"
    // contract is pinned the way the chunk-1 test pins the arrow
    // geometry: by reading the shipped CSS, plus the inline style the
    // component always sets.
    const css = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8");
    const rule = css.slice(css.indexOf(".ann-comment-icon {"));
    expect(rule.length, "the badge rule ships").toBeGreaterThan(0);
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/pointer-events:\s*none/);

    const { host, cleanup } = mountComments({
      annotations: [RECT_ANN],
      initialComments: [THREAD_ONE],
    });
    try {
      const icon = badge(host, "rect-1");
      expect(icon).not.toBeNull();
      if (icon === null) return;
      expect((icon as HTMLElement).style.pointerEvents).toBe("none");
      // No click target / handler inside the badge.
      expect(icon.querySelector("button")).toBeNull();
      expect(icon.getAttribute("onclick")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("a press on the annotated element still selects it while the badge is shown", () => {
    const { host, cleanup } = mountComments({
      annotations: [RECT_ANN],
      initialComments: [THREAD_ONE],
    });
    try {
      const shape = host.querySelector<Element>(".ann-shape[data-annotation-id='rect-1']");
      if (shape === null) throw new Error("shape not found");
      pointerDown(shape, 250, 100);
      clickEl(shape);
      expect(host.querySelector("[data-content-action-bar='ann-rect']")).not.toBeNull();
      expect(box(host), "comment box opens with the selection").not.toBeNull();
      expect(badge(host, "rect-1"), "badge still an indicator only").not.toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("Phase 28 - comment box placement + time formatting", () => {
  it("sits clear below the annotation and its action bar on a mid-page element", () => {
    const style = commentBoxPlacement({ x: 100, y: 100, width: 150, height: 80 }, 1, 612, 792);
    expect(style.width).toBe(COMMENT_BOX_WIDTH);
    // DEF-366 - the card sits just below the action bar's REAL box
    // (32px bar + an 8px gap), not the old 36px fixed clearance.
    expect(style.top).toBe(100 + 80 + 4 + 32 + 8);
    // Below the ring's bottom edge, so the annotation's own surface and
    // the action bar (4px under the ring) are never covered.
    expect(Number(style.top)).toBeGreaterThan(180 + 4);
    expect(style.bottom).toBeUndefined();
    expect(style.left).toBe(100);
  });

  it("flips above the annotation when there is no usable room below", () => {
    const style = commentBoxPlacement({ x: 100, y: 640, width: 150, height: 80 }, 1, 612, 792);
    // ring.bottom = 720; below-space = 792 - 760 = 32 < min -> flip up.
    expect(792 - (640 + 80 + 4 + 36)).toBeLessThan(COMMENT_BOX_MIN_BELOW);
    expect(style.top).toBeUndefined();
    expect(style.bottom).toBe(792 - 640 + 8);
  });

  it("clamps the card inside the page view's right edge", () => {
    const style = commentBoxPlacement({ x: 560, y: 100, width: 40, height: 40 }, 1, 612, 792);
    expect(Number(style.left)).toBe(612 - COMMENT_BOX_WIDTH - 8);
  });

  it("formats recent entries relative and old ones as a date", () => {
    const now = Date.UTC(2026, 0, 20, 12, 0, 0);
    expect(formatCommentTime(now - 10_000, now)).toBe("just now");
    expect(formatCommentTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatCommentTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatCommentTime(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(formatCommentTime(Date.UTC(2026, 0, 1, 9, 0, 0), now)).toBe("2026-01-01");
    expect(formatCommentTime(Number.NaN, now)).toBe("");
  });
});

// TFL-1018 (chunk C12) — documented native exception. The card keeps its own
// chassis: role="dialog" + data-ann-comment-box on the positioned root, its
// own click stopPropagation (the layer's pointerdown AND click must not reach
// it) and the bespoke commentBoxPlacement (DEF-326/DEF-366) that emits
// bottom-anchored styles (`bottom`) when it flips above the action bar.
// ContextToolbox only emits left/top, hardcodes role="toolbar" and has no
// bottom-anchor capability, so the bespoke avoid-overlap placement cannot be
// preserved through the primitive. This pins the surface as unchanged (never
// rendered through ContextToolbox).
describe("TFL-1018 (C12) - the comment card stays a native exception", () => {
  it("keeps role=dialog and is never wrapped in a ContextToolbox", () => {
    const { host, cleanup } = mountComments({
      annotations: [RECT_ANN],
      initialComments: [THREAD_ONE],
    });
    try {
      selectRect(host);
      const card = box(host);
      expect(card).not.toBeNull();
      expect(card?.getAttribute("role")).toBe("dialog");
      expect(card?.getAttribute("aria-label")).toBe("Annotation comments");
      expect(card?.closest("[data-context-toolbox]")).toBeNull();
      expect(host.querySelector("[data-context-toolbox]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("keeps the bottom-anchored flip when the bar is above the annotation", () => {
    // The flip that ContextToolbox cannot express: the card is anchored with
    // `bottom`, not `top` (DEF-366).
    const style = commentBoxPlacement({ x: 100, y: 640, width: 150, height: 80 }, 1, 612, 792);
    expect(style.top).toBeUndefined();
    expect(typeof style.bottom).toBe("number");
  });
});
