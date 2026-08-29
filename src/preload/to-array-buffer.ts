/**
 * Normalizes PDF byte data received from the main process through
 * Electron's structured clone. Structured clone may deliver the value
 * as an ArrayBuffer or a Uint8Array; this always produces an ArrayBuffer.
 */
export function normalizeArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}