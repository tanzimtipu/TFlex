/**
 * Phase 54 — minimal ambient typings for the untyped `utif` package (v3.1.0).
 *
 * `utif` ships only `UTIF.js` (CommonJS) with no `.d.ts`. Only the surface the
 * TIFF adapter and `image-meta.ts` use is declared: the decode chain and the
 * resolution/frame tags the adapter reads off each IFD. An IFD is a plain
 * object whose tags are keyed `t<tagNumber>` (`t256` width, `t257` height,
 * `t282`/`t283` resolution, `t296` resolution unit). Rational values arrive as
 * plain numbers (numerator / denominator).
 */
declare module 'utif' {
  export interface UtifIfd {
    [tag: string]: unknown;
    width?: number;
    height?: number;
    data?: Uint8Array;
    subIFD?: UtifIfd[];
  }

  export function decode(buffer: ArrayBuffer | Uint8Array): UtifIfd[];
  export function decodeImage(
    buffer: ArrayBuffer | Uint8Array,
    image: UtifIfd,
    ifds: UtifIfd[],
  ): void;
  export function toRGBA8(image: UtifIfd): Uint8Array;
  export function encodeImage(
    rgba: Uint8Array,
    width: number,
    height: number,
    metadata?: unknown,
  ): ArrayBuffer;
  export function encode(ifds: UtifIfd[]): ArrayBuffer;

  const UTIF: {
    decode: typeof decode;
    decodeImage: typeof decodeImage;
    toRGBA8: typeof toRGBA8;
    encodeImage: typeof encodeImage;
    encode: typeof encode;
  };
  export default UTIF;
}
