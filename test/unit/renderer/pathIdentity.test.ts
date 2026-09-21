// DEF-279 — the canonical path comparison key.
//
// The open dedupe and the same-file pane guard both need "is this the same
// file?" answered by something other than raw string equality, because a
// case-variant path on Windows (or a different separator spelling) names
// the same on-disk file. These tests pin the helper's whole rule: case
// folding (filename, directory and drive letter), separator normalisation,
// trailing separator, whitespace and the extended-length prefix — plus the
// negative side: two genuinely different paths must never collide.

import { describe, expect, it } from "vitest";
import {
  isSamePath,
  pathComparisonKey,
} from "../../../src/renderer/state/pathIdentity";

describe("pathComparisonKey — same file, variant spellings", () => {
  it("folds case in the filename", () => {
    expect(pathComparisonKey("C:\\Docs\\Report.PDF")).toBe(
      pathComparisonKey("C:\\Docs\\report.pdf"),
    );
  });

  it("folds case in the directory", () => {
    expect(pathComparisonKey("C:\\Docs\\A.PDF")).toBe(
      pathComparisonKey("c:\\docs\\a.pdf"),
    );
  });

  it("folds case in the drive letter", () => {
    expect(pathComparisonKey("D:\\x.pdf")).toBe(pathComparisonKey("d:/x.pdf"));
  });

  it("treats back and forward slashes identically", () => {
    expect(pathComparisonKey("C:\\Docs\\a.pdf")).toBe(
      pathComparisonKey("C:/Docs/a.pdf"),
    );
    expect(pathComparisonKey("C:\\Docs\\a.pdf")).toBe(
      pathComparisonKey("C:/Docs\\a.pdf"),
    );
  });

  it("strips a trailing separator", () => {
    expect(pathComparisonKey("C:\\Docs\\Report.pdf\\")).toBe(
      pathComparisonKey("C:\\Docs\\Report.pdf"),
    );
    expect(pathComparisonKey("C:/Docs/Report.pdf//")).toBe(
      pathComparisonKey("C:/Docs/Report.pdf"),
    );
  });

  it("trims surrounding whitespace", () => {
    expect(pathComparisonKey("  C:\\Docs\\a.pdf \t")).toBe(
      pathComparisonKey("C:\\Docs\\a.pdf"),
    );
  });

  it("compares a UNC path case-insensitively across separator styles", () => {
    expect(pathComparisonKey("\\\\Server\\Share\\File.PDF")).toBe(
      pathComparisonKey("//server/share/file.pdf"),
    );
  });

  it("strips a trailing separator on a UNC share", () => {
    expect(pathComparisonKey("\\\\server\\share\\x\\")).toBe(
      pathComparisonKey("\\\\SERVER\\SHARE\\X"),
    );
  });

  it("drops a Windows extended-length prefix", () => {
    expect(pathComparisonKey("\\\\?\\C:\\Docs\\Report.pdf")).toBe(
      pathComparisonKey("C:\\Docs\\Report.pdf"),
    );
  });

  it("folds an extended-length UNC prefix back to the UNC form", () => {
    expect(pathComparisonKey("\\\\?\\UNC\\server\\share\\x.pdf")).toBe(
      pathComparisonKey("\\\\server\\share\\x.pdf"),
    );
  });

  it("isSamePath mirrors the key", () => {
    expect(isSamePath("C:\\A\\B.PDF", "c:/a/b.pdf")).toBe(true);
    expect(isSamePath("C:\\A\\B.pdf", "C:\\A\\C.pdf")).toBe(false);
  });

  it("keeps a root slash and an empty path as-is", () => {
    expect(pathComparisonKey("/")).toBe("/");
    expect(pathComparisonKey("")).toBe("");
    expect(pathComparisonKey("   ")).toBe("");
  });
});

describe("pathComparisonKey — genuinely different paths do not collide", () => {
  it("different filenames", () => {
    expect(isSamePath("C:\\Docs\\one.pdf", "C:\\Docs\\two.pdf")).toBe(false);
  });

  it("different directories that only differ past a separator", () => {
    expect(isSamePath("C:\\dir\\a.pdf", "C:\\dir2\\a.pdf")).toBe(false);
  });

  it("same leaf on different drives", () => {
    expect(isSamePath("C:\\a.pdf", "D:\\a.pdf")).toBe(false);
  });

  it("same leaf on different UNC servers", () => {
    expect(isSamePath("\\\\srv1\\share\\a.pdf", "\\\\srv2\\share\\a.pdf")).toBe(
      false,
    );
  });

  it("a relative path is not equal to an absolute one", () => {
    expect(isSamePath("Docs\\a.pdf", "C:\\Docs\\a.pdf")).toBe(false);
  });
});