// Normalizes bytes coming back over IPC. The preload's typed signatures declare
// `ArrayBuffer`, but Electron's structured-clone layer may surface the same
// payload as a `Uint8Array` view depending on the channel. PDF.js accepts either,
// but downstream code here expects `ArrayBuffer`, so coerce defensively.
export function toArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }
  // Uint8Array path: copy into a fresh ArrayBuffer so the caller can transfer
  // it safely (PDF.js sometimes detaches the buffer).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}