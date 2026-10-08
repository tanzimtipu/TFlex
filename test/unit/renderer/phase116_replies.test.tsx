// @vitest-environment jsdom
//
// Phase 116 (TFL-1228 chunk F) - real comment threads in the Thread Stream
// list + draft retention on a recoverable add failure.
//
// Coverage:
//   (a) AnnotationsPanel derives each row's comment chip from the `comments`
//       prop (3 entries -> "3"; no matching thread -> no chip, no fabrication);
//   (b) AnnotationCommentBox does NOT clear the draft on submit - the text is
//       handed to onAddComment and stays in the textarea until the echo lands;
//   (c) the draft clears only on the real echo (the submitted text appearing
//       in `entries`).
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { AnnotationsPanel } from "../../../src/renderer/annotations/AnnotationsPanel";
import AnnotationCommentBox from "../../../src/renderer/annotations/AnnotationCommentBox";
import type { Annotation } from "../../../src/renderer/annotations/model";
import type { CommentEntry, CommentThread } from "../../../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECT_ANN: Annotation = {
  id: "rect-1",
  kind: "rect",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 150, height: 80 },
};

const ENTRIES: CommentEntry[] = [
  { id: "cmt-1", author: "You", text: "First thought", createdAt: Date.now() - 60_000 },
  { id: "cmt-2", author: "Dana", text: "A reply", createdAt: Date.now() - 5_000 },
  { id: "cmt-3", author: "Sam", text: "Another reply", createdAt: Date.now() - 1_000 },
];

const liveRoots: { root: ReturnType<typeof createRoot>; host: HTMLElement }[] = [];

function freshHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

function mount(node: ReactElement): { root: ReturnType<typeof createRoot>; host: HTMLElement } {
  const host = freshHost();
  const root = createRoot(host);
  liveRoots.push({ root, host });
  act((): void => {
    root.render(node);
  });
  return { root, host };
}

function cleanupAll(): void {
  while (liveRoots.length > 0) {
    const entry = liveRoots.pop();
    if (entry === undefined) continue;
    act((): void => {
      entry.root.unmount();
    });
    entry.host.remove();
  }
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

function clickEl(el: Element | null): void {
  act((): void => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("Phase 116 (F)(a) - the Thread Stream comment chip reflects real threads", () => {
  it("shows the real entry count on the row with a matching thread", () => {
    const comments: CommentThread[] = [{ annotationId: "rect-1", entries: ENTRIES }];
    const { host } = mount(
      <AnnotationsPanel
        annotations={[RECT_ANN]}
        onJumpTo={(): void => undefined}
        onEdit={(): void => undefined}
        onDelete={(): void => undefined}
        comments={comments}
      />,
    );
    try {
      const chip = host.querySelector("[data-ann-comment-count]");
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toBe("3");
    } finally {
      cleanupAll();
    }
  });

  it("draws NO chip (no fabricated count) when no thread matches", () => {
    const comments: CommentThread[] = [{ annotationId: "other", entries: ENTRIES }];
    const { host } = mount(
      <AnnotationsPanel
        annotations={[RECT_ANN]}
        onJumpTo={(): void => undefined}
        onEdit={(): void => undefined}
        onDelete={(): void => undefined}
        comments={comments}
      />,
    );
    try {
      expect(host.querySelector("[data-annotation-row='rect-1']")).not.toBeNull();
      expect(host.querySelector("[data-ann-comment-count]")).toBeNull();
    } finally {
      cleanupAll();
    }
  });
});

describe("Phase 116 (F)(b)/(c) - the reply draft survives a recoverable add failure", () => {
  const box = (entries: readonly CommentEntry[], onAddComment: (text: string) => void): ReactElement => (
    <AnnotationCommentBox
      ann={RECT_ANN}
      entries={entries}
      onAddComment={onAddComment}
      cssScale={1}
      widthPt={612}
      heightPt={792}
    />
  );

  it("keeps the submitted text when no echo lands (add failed)", () => {
    const onAddComment = vi.fn();
    const { host } = mount(box([], onAddComment));
    try {
      typeInto(host.querySelector<HTMLTextAreaElement>("[data-comment-input]"), "  needs a fix  ");
      clickEl(host.querySelector("[data-comment-submit]"));
      expect(onAddComment).toHaveBeenCalledTimes(1);
      expect(onAddComment).toHaveBeenCalledWith("needs a fix");
      const input = host.querySelector<HTMLTextAreaElement>("[data-comment-input]");
      expect(input?.value, "draft is retained for retry").toBe("  needs a fix  ");
    } finally {
      cleanupAll();
    }
  });

  it("clears the draft once the submitted text echoes back in entries", () => {
    const onAddComment = vi.fn();
    const { root, host } = mount(box([], onAddComment));
    try {
      typeInto(host.querySelector<HTMLTextAreaElement>("[data-comment-input]"), "privacy clause");
      clickEl(host.querySelector("[data-comment-submit]"));
      expect(host.querySelector<HTMLTextAreaElement>("[data-comment-input]")?.value).toBe(
        "privacy clause",
      );
      const echo: CommentEntry[] = [
        { id: "cmt-echo", author: "You", text: "privacy clause", createdAt: Date.now() },
      ];
      act((): void => {
        root.render(box(echo, onAddComment));
      });
      expect(host.querySelector<HTMLTextAreaElement>("[data-comment-input]")?.value).toBe("");
    } finally {
      cleanupAll();
    }
  });
});
