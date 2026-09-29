// @vitest-environment jsdom
//
// Phase 54 (feature A) — the DPI-aware multi-image import ROUTING.
//
// The Create-from-images flow must reach `convert.toDocumentMany` when every
// picked input is a real on-disk file (each page sized from the image's own
// DPI metadata). Clipboard images / virtual files have no path and must keep
// the legacy `engine.createFromImages` path byte-for-byte.
//
// The routing is the pure `createFromImagesRoute` seam so it is testable
// without booting the App; the bind-sensitive `getDocumentBytes` shape mirrors
// the Phase 53 / DEF-374 test.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createFromImagesRoute,
  convertManyWarningToast,
  noticeFromManyResult,
  type CreateFromImagesRouteDeps,
} from "../../../src/renderer/state/convert";
import type {
  ConvertManyResult,
  ConvertWarning,
} from "../../../src/shared/convert";
import type { TFlexApiConvert } from "../../../src/shared/ipc";
import type { Result } from "../../../src/shared/result";

const MANY: ConvertManyResult = {
  docId: "doc-1",
  pageCount: 3,
  sourceFormats: ["png", "jpeg", "png"],
  fidelity: "native",
  warnings: [],
  title: "Images",
};

/** A minimal TFlexApiConvert fake: only the named members are real. */
function fakeApi(parts: Partial<TFlexApiConvert>): TFlexApiConvert {
  return {
    sourceInfo: parts.sourceInfo ?? (async () => ({
      ok: false as const,
      error: { code: "unsupported-format", message: "not used" },
    })),
    toDocument: parts.toDocument ?? (async () => ({
      ok: false as const,
      error: { code: "unsupported-format", message: "not used" },
    })),
    toDocumentMany: parts.toDocumentMany,
    csvToDocumentFields: parts.csvToDocumentFields ?? (async () => ({
      ok: false as const,
      error: { code: "unsupported-format", message: "not used" },
    })),
    cancel: parts.cancel ?? ((): void => undefined),
    onProgress: parts.onProgress ?? ((): (() => void) => () => undefined),
  };
}

/** A File with a working `arrayBuffer()` (jsdom's may not implement it). */
function fakeFile(name: string, bytes = new Uint8Array([1, 2, 3])): File {
  const file = new File([bytes], name, { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async (): Promise<ArrayBuffer> => bytes.slice().buffer,
  });
  return file;
}

/**
 * Bind-sensitive stand-in for `RealEngineAdapter` (DEF-374). Its
 * `getDocumentBytes` is a PROTOTYPE-STYLE method reading `this.inner`:
 * extract it into a local and call it unbound and `this` is undefined.
 */
interface FakeEngine {
  inner: { read: (id: string) => Promise<Result<ArrayBuffer, string>> };
  getDocumentBytes(id: string): Promise<Result<ArrayBuffer, string>>;
}

function fakeEngine(length = 8): FakeEngine {
  return {
    inner: { read: async () => ({ ok: true as const, value: new ArrayBuffer(length) }) },
    async getDocumentBytes(id: string) {
      return this.inner.read(id);
    },
  };
}

function deps(overrides: Partial<CreateFromImagesRouteDeps>): CreateFromImagesRouteDeps {
  return {
    files: [fakeFile("a.png")],
    quality: 0.85,
    getPathForFile: (f) => `C:/imgs/${f.name}`,
    convert: fakeApi({}),
    createFromImages: async () => ({ ok: true as const, value: new ArrayBuffer(4) }),
    getDocumentBytes: async () => ({ ok: true as const, value: new ArrayBuffer(8) }),
    pushToast: (): void => undefined,
    mintDocId: () => "doc-1",
    ...overrides,
  };
}

function expectSuccess(result: unknown): { bytes: ArrayBuffer; size: number; name: string } {
  expect(result).not.toHaveProperty("error");
  return result as { bytes: ArrayBuffer; size: number; name: string };
}

describe("phase 54 — create-from-images routing", () => {
  it("all files resolvable: toDocumentMany runs and createFromImages does not", async () => {
    const engine = fakeEngine(8);
    const toDocumentMany = vi.fn(async (_docId: string, _paths: string[]) => ({
      ok: true as const,
      value: MANY,
    }));
    const createFromImages = vi.fn(async () => ({
      ok: true as const,
      value: new ArrayBuffer(4),
    }));
    const out = expectSuccess(
      await createFromImagesRoute(
        deps({
          files: [fakeFile("a.png"), fakeFile("b.jpg")],
          convert: fakeApi({ toDocumentMany }),
          createFromImages,
          getDocumentBytes: (id) => engine.getDocumentBytes(id),
        }),
      ),
    );
    expect(toDocumentMany).toHaveBeenCalledTimes(1);
    expect(toDocumentMany).toHaveBeenCalledWith("doc-1", ["C:/imgs/a.png", "C:/imgs/b.jpg"]);
    expect(createFromImages).not.toHaveBeenCalled();
    // The bytes come from getDocumentBytes (the engine's DPI-sized document).
    expect(out.size).toBe(8);
    expect(out.name).toBe("a.png");
  });

  it("a file lacking a path keeps the legacy createFromImages path", async () => {
    const toDocumentMany = vi.fn(async () => ({ ok: true as const, value: MANY }));
    const createFromImages = vi.fn(async () => ({
      ok: true as const,
      value: new ArrayBuffer(4),
    }));
    const out = expectSuccess(
      await createFromImagesRoute(
        deps({
          files: [fakeFile("a.png"), fakeFile("clip.png")],
          getPathForFile: (f) => (f.name === "clip.png" ? "" : `C:/imgs/${f.name}`),
          convert: fakeApi({ toDocumentMany }),
          createFromImages,
        }),
      ),
    );
    expect(createFromImages).toHaveBeenCalledTimes(1);
    expect(toDocumentMany).not.toHaveBeenCalled();
    expect(out.size).toBe(4);
  });

  it("an absent convert bridge falls back and never throws", async () => {
    const createFromImages = vi.fn(async () => ({
      ok: true as const,
      value: new ArrayBuffer(4),
    }));
    const out = expectSuccess(
      await createFromImagesRoute(deps({ convert: undefined, createFromImages })),
    );
    expect(createFromImages).toHaveBeenCalledTimes(1);
    expect(out.size).toBe(4);
  });

  it("a toDocumentMany failure returns a readable error and reads no bytes", async () => {
    const getDocumentBytes = vi.fn(async () => ({
      ok: true as const,
      value: new ArrayBuffer(8),
    }));
    const createFromImages = vi.fn(async () => ({
      ok: true as const,
      value: new ArrayBuffer(4),
    }));
    const out = await createFromImagesRoute(
      deps({
        convert: fakeApi({
          toDocumentMany: async () => ({
            ok: false as const,
            error: { code: "decode-failed", message: "bad frame" },
          }),
        }),
        createFromImages,
        getDocumentBytes,
      }),
    );
    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toContain("could not be decoded");
    expect(getDocumentBytes).not.toHaveBeenCalled();
    expect(createFromImages).not.toHaveBeenCalled();
  });

  it("the docId minted for toDocumentMany is the SAME one passed to getDocumentBytes", async () => {
    const engine = fakeEngine();
    const seen: string[] = [];
    const toDocumentMany = vi.fn(async (docId: string) => {
      seen.push(docId);
      return { ok: true as const, value: MANY };
    });
    const out = expectSuccess(
      await createFromImagesRoute(
        deps({
          convert: fakeApi({ toDocumentMany }),
          getDocumentBytes: (id) => {
            seen.push(id);
            return engine.getDocumentBytes(id);
          },
        }),
      ),
    );
    expect(toDocumentMany).toHaveBeenCalledTimes(1);
    // Exactly two ids seen, and they are identical: one mint, no phantom.
    expect(seen.length).toBe(2);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe("doc-1");
    expect(out.size).toBe(8);
  });

  it("DEF-374: bound engine bytes work, an extracted unbound local throws", async () => {
    const engine = fakeEngine();
    await expect(engine.getDocumentBytes("doc-1")).resolves.toMatchObject({ ok: true });
    const unbound = engine.getDocumentBytes;
    await expect(unbound("doc-1")).rejects.toThrow(/inner/);
  });

  it("an empty selection is rejected before any engine call", async () => {
    const toDocumentMany = vi.fn(async () => ({ ok: true as const, value: MANY }));
    const createFromImages = vi.fn(async () => ({
      ok: true as const,
      value: new ArrayBuffer(4),
    }));
    const out = await createFromImagesRoute(
      deps({ files: [], convert: fakeApi({ toDocumentMany }), createFromImages }),
    );
    expect(out).toEqual({ error: "No images selected." });
    expect(toDocumentMany).not.toHaveBeenCalled();
    expect(createFromImages).not.toHaveBeenCalled();
  });
});

describe("phase 54 — warnings are never dropped", () => {
  const WARNINGS: ConvertWarning[] = [
    { code: "dpi-assumed", message: "DPI assumed at 96 for a.jpg." },
    { code: "frame-decode-failed", message: "Frame 2 was skipped." },
  ];

  it("a warned conversion pushes one visible toast naming count + first message", async () => {
    const pushToast = vi.fn();
    const out = expectSuccess(
      await createFromImagesRoute(
        deps({
          convert: fakeApi({
            toDocumentMany: async () => ({
              ok: true as const,
              value: { ...MANY, warnings: WARNINGS },
            }),
          }),
          pushToast,
        }),
      ),
    );
    expect(pushToast).toHaveBeenCalledTimes(1);
    const [kind, text] = pushToast.mock.calls[0] as [string, string];
    expect(kind).toBe("warning");
    expect(text).toContain("2 warnings");
    expect(text).toContain("DPI assumed at 96 for a.jpg.");
    // The full set still rides the result for the per-tab conversion card.
    expect(out.name).toBe("a.png");
  });

  it("an empty warning list produces no warning toast", async () => {
    const pushToast = vi.fn();
    await createFromImagesRoute(deps({ convert: fakeApi({ toDocumentMany: async () => ({ ok: true as const, value: MANY }) }), pushToast }));
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("convertManyWarningToast names the count and the first message", () => {
    expect(convertManyWarningToast({ ...MANY, warnings: WARNINGS })).toBe(
      "Imported with 2 warnings: DPI assumed at 96 for a.jpg.",
    );
    expect(convertManyWarningToast({ ...MANY, warnings: [WARNINGS[0]!] })).toBe(
      "Imported with 1 warning: DPI assumed at 96 for a.jpg.",
    );
    expect(convertManyWarningToast(MANY)).toBeNull();
  });

  it("noticeFromManyResult carries every warning for the conversion card", () => {
    const notice = noticeFromManyResult({ ...MANY, warnings: WARNINGS });
    expect(notice.warnings).toEqual(WARNINGS);
    expect(notice.fidelity).toBe("native");
    expect(notice.sourceLabel).toBe("Images");
    expect(notice.sourceFormat).toBe("png");
  });
});

describe("phase 54 — the App call site keeps the DEF-374-safe shape", () => {
  const appSource = fs.readFileSync(
    path.join(process.cwd(), "src/renderer/App.tsx"),
    "utf8",
  );

  it("the create-from-images flow routes through createFromImagesRoute", () => {
    expect(appSource).toContain("createFromImagesRoute({");
    expect(appSource).toContain("convert: window.tflex.convert");
  });

  it("getDocumentBytes is called ON the engine, never an extracted alias", () => {
    expect(appSource).toContain("engineRef.current.getDocumentBytes(id)");
    // No `const x = engineRef.current.getDocumentBytes` extraction, which
    // loses `this` on the real adapter (DEF-374).
    expect(appSource).not.toMatch(
      /(?:const|let|var)\s+\w+\s*=\s*engineRef\.current\.getDocumentBytes\b/,
    );
  });
});