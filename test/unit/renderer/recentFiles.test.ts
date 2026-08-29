// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  RECENT_CAP,
  pushRecent,
  removeRecent,
} from "../../../src/renderer/state/recentFiles";
import type { RecentFile } from "../../../src/shared/types";

const makeRecent = (i: number, path = `/file-${i}.pdf`): RecentFile => ({
  path,
  name: `file-${i}.pdf`,
  openedAt: new Date(2026, 0, i + 1).toISOString(),
});

describe("pushRecent", () => {
  it("prepends new entry and dedupes by path", () => {
    const a = makeRecent(1, "/a.pdf");
    const b = makeRecent(2, "/b.pdf");
    const list = pushRecent([], a);
    const list2 = pushRecent(list, b);
    expect(list2.map((f) => f.path)).toEqual(["/b.pdf", "/a.pdf"]);
    const list3 = pushRecent(list2, { ...a, openedAt: "2026-02-02T00:00:00.000Z" });
    expect(list3.map((f) => f.path)).toEqual(["/a.pdf", "/b.pdf"]);
    expect(list3).toHaveLength(2);
  });

  it("caps entries at RECENT_CAP", () => {
    let list: RecentFile[] = [];
    for (let i = 0; i < RECENT_CAP + 4; i += 1) {
      list = pushRecent(list, makeRecent(i, `/p${i}.pdf`));
    }
    expect(list).toHaveLength(RECENT_CAP);
    expect(list[0].path).toBe(`/p${RECENT_CAP + 3}.pdf`);
  });

  it("respects a custom cap", () => {
    let list: RecentFile[] = [];
    for (let i = 0; i < 6; i += 1) {
      list = pushRecent(list, makeRecent(i, `/x${i}.pdf`), 3);
    }
    expect(list).toHaveLength(3);
  });
});

describe("removeRecent", () => {
  it("removes by exact path", () => {
    const list: RecentFile[] = [makeRecent(1, "/a"), makeRecent(2, "/b"), makeRecent(3, "/c")];
    const next = removeRecent(list, "/b");
    expect(next.map((f) => f.path)).toEqual(["/a", "/c"]);
  });

  it("removes nothing when path is not present (content-equality)", () => {
    const list: RecentFile[] = [makeRecent(1, "/a"), makeRecent(2, "/b")];
    const next = removeRecent(list, "/x");
    expect(next).toEqual(list);
    expect(next).not.toBe(list); // always a new array (caller may compare by value)
  });
});