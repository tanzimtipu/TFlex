import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SamplesService } from "../../../src/main/services/samples";

let dir: string;
let svc: SamplesService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tflex-samples-"));
  svc = new SamplesService(dir);
  await writeFile(join(dir, "report.pdf"), "%PDF-1.7\nstartxref\n%%EOF");
  await writeFile(join(dir, "form.pdf"), "%PDF-1.7\nstartxref\n%%EOF");
  await writeFile(join(dir, "notes.txt"), "not a pdf");
  await mkdir(join(dir, "nested.pdf")); // a directory ending in .pdf must not be listed
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("SamplesService.list", () => {
  it("lists only .pdf files with path samples/<name>", async () => {
    const list = await svc.list();
    expect(list).toEqual([
      { name: "form.pdf", path: "samples/form.pdf" },
      { name: "report.pdf", path: "samples/report.pdf" },
    ]);
  });

  it("returns empty when the directory does not exist", async () => {
    const svc2 = new SamplesService(join(dir, "does-not-exist"));
    expect(await svc2.list()).toEqual([]);
  });
});

describe("SamplesService.load", () => {
  it("loads an existing sample metadata", async () => {
    const result = await svc.load("report.pdf");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "report.pdf", path: "samples/report.pdf" });
    }
  });

  it("returns not-found for an unknown sample", async () => {
    const result = await svc.load("missing.pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not-found");
    }
  });

  it("rejects traversal attempts", async () => {
    const attempts = ["../secret.pdf", "..\\secret.pdf", "a/b.pdf", "a\\b.pdf", ""];
    for (const attempt of attempts) {
      const result = await svc.load(attempt);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("not-found");
      }
    }
  });

  it("rejects traversal even when the target file exists", async () => {
    await writeFile(join(dir, "..", "outside.pdf"), "%PDF-1.7\nstartxref\n%%EOF");
    const result = await svc.load("../outside.pdf");
    expect(result.ok).toBe(false);
  });
});

describe("SamplesService.read", () => {
  it("reads bytes of an existing sample", async () => {
    const result = await svc.read("report.pdf");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeInstanceOf(ArrayBuffer);
      const decoder = new TextDecoder();
      expect(decoder.decode(result.value)).toBe("%PDF-1.7\nstartxref\n%%EOF");
    }
  });

  it("reads correct bytes for a different sample", async () => {
    await writeFile(join(dir, "hello.pdf"), "world");
    const result = await svc.read("hello.pdf");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const decoder = new TextDecoder();
      expect(decoder.decode(result.value)).toBe("world");
    }
  });

  it("returns not-found for an unknown sample", async () => {
    const result = await svc.read("missing.pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not-found");
    }
  });

  it("rejects traversal attempts", async () => {
    const attempts = ["../secret.pdf", "..\\secret.pdf", "a/b.pdf", "a\\b.pdf", ""];
    for (const attempt of attempts) {
      const result = await svc.read(attempt);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("not-found");
      }
    }
  });

  it("rejects traversal even when the target file exists", async () => {
    await writeFile(join(dir, "..", "outside.pdf"), "%PDF-1.7\nstartxref\n%%EOF");
    const result = await svc.read("../outside.pdf");
    expect(result.ok).toBe(false);
  });
});