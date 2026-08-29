// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { toArrayBuffer } from "../../../src/renderer/utils/toArrayBuffer";

describe("toArrayBuffer", () => {
  it("returns ArrayBuffer inputs unchanged", () => {
    const buf = new ArrayBuffer(4);
    expect(toArrayBuffer(buf)).toBe(buf);
  });

  it("copies Uint8Array inputs into a fresh ArrayBuffer", () => {
    const u8 = new Uint8Array([1, 2, 3, 4]);
    const out = toArrayBuffer(u8);
    expect(out).toBeInstanceOf(ArrayBuffer);
    expect(out.byteLength).toBe(4);
    expect(new Uint8Array(out)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("returns a copy that is independent of the source Uint8Array", () => {
    const u8 = new Uint8Array([9, 8, 7]);
    const out = toArrayBuffer(u8);
    const outU8 = new Uint8Array(out);
    u8[0] = 0;
    expect(outU8[0]).toBe(9);
  });
});