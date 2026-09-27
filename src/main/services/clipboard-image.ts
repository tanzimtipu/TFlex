// Phase 45 — main-side clipboard image reader for "Create from clipboard".
//
// The renderer's async clipboard API (`navigator.clipboard.read()`) sees an
// image copied from a web page, but NOT an image FILE copied in Explorer:
// Electron 44 exposes that as the `text/uri-list` flavour (CF_HDROP in older
// Electron) and the renderer has no `fs` to open the path. This module
// resolves the best available clipboard image in the MAIN process, where `fs`
// and Electron's async `clipboard` both live, and hands the renderer raw bytes
// via the `clipboard:readImage` IPC channel.
//
// It is read-only. It never writes to disk, never trusts a path without
// confirming it is an existing regular file, caps the read at
// CLIPBOARD_IMAGE_MAX_BYTES, and sniffs the magic bytes rather than trusting
// the file extension. Every failure is a typed `ClipboardImageResult`; it
// never throws.

import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClipboardImageMime, ClipboardImageResult } from "../../shared/ipc";

/** 20 MB. A clipboard image larger than this is almost certainly a mistake
 *  (or a decompression bomb); the renderer would only bloat the new PDF
 *  with it. The cap applies to both the native PNG and a copied file. */
export const CLIPBOARD_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** Extensions we will even consider opening. The MIME the renderer can
 *  consume is limited to PNG/JPEG, so only those extensions are candidates;
 *  a `.gif`/`.webp` copied file is `no-image`, not a silently-wrong mime. */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

/** True when the path ends in a known consumable image extension. Case-
 *  insensitive; only the basename extension is examined. */
export function hasImageExtension(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/** Sniff the image type from the leading magic bytes: PNG signature
 *  `89 50 4E 47 0D 0A 1A 0A`, or JPEG SOI `FF D8 FF`. Returns null when the
 *  bytes are neither (the caller then reports `unreadable`). */
export function sniffImageMime(bytes: Uint8Array): ClipboardImageMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

/** Size-cap decision, defaulting to the 20 MB cap. Kept as a helper so the
 *  cap value is asserted by tests in one place. */
export function isWithinSizeCap(
  byteLength: number,
  cap: number = CLIPBOARD_IMAGE_MAX_BYTES,
): boolean {
  return byteLength <= cap;
}

/**
 * Parse a `text/uri-list` clipboard string into local file paths. Lines are
 * CRLF/LF separated; blank lines and `#` comments are ignored, and only
 * `file:` URIs are converted (a web URL or a plain-text line is not a file).
 * A malformed URI is skipped rather than throwing.
 */
export function parseUriList(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (!line.toLowerCase().startsWith("file:")) continue;
    try {
      out.push(fileURLToPath(line));
    } catch {
      // Not a convertible file URI (e.g. a host other than localhost).
    }
  }
  return out;
}

/** An item as Electron 44's async `clipboard.read()` exposes it: a `types`
 *  list plus `getType(type)` resolving a Blob (the web ClipboardItem shape).
 *  `getType` is typed loosely so tests may hand back raw bytes as well. */
export interface ClipboardItemLike {
  types?: string[];
  getType(type: string): Promise<unknown> | unknown;
}

/** The subset of Electron's ASYNC `clipboard` this module uses. Electron 44
 *  removed the synchronous API (`readImage`/`readBuffer`/`availableFormats`
 *  are undefined at runtime), so reads go through `read()`/`readText()`,
 *  which return Promises. Structurally satisfied by the real module; tests
 *  pass a hand-rolled mock. */
export interface ClipboardLike {
  read(): Promise<ClipboardItemLike[]> | ClipboardItemLike[];
  readText?(): Promise<string> | string;
}

/** The `fs` operations the handler needs, injected so tests do not touch the
 *  disk. `stat` must throw for a missing path, like `fs.statSync`. */
export interface ClipboardImageFs {
  stat(path: string): { isFile(): boolean; size: number };
  read(path: string): Uint8Array;
}

const defaultFs: ClipboardImageFs = {
  stat: (path) => statSync(path),
  read: (path) => readFileSync(path),
};

/** Clipboard image flavours, best first. */
const IMAGE_ITEM_TYPES = ["image/png", "image/jpeg"] as const;

/** Coerce a `getType` result into bytes. Electron resolves a Blob; a test may
 *  hand back a Uint8Array/ArrayBuffer directly. Null when unreadable. */
async function toBytes(value: unknown): Promise<Uint8Array | null> {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  const maybe = value as { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof maybe.arrayBuffer === "function") {
    try {
      const buffer = await maybe.arrayBuffer();
      return buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Decode a text clipboard flavour (UTF-8; a leading BOM is stripped). */
async function toText(value: unknown): Promise<string | null> {
  const bytes = await toBytes(value);
  if (bytes === null) return null;
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}

/** Read one item type, swallowing any failure. */
async function readItemType(item: ClipboardItemLike, type: string): Promise<unknown> {
  try {
    if (typeof item.getType !== "function") return null;
    return await item.getType(type);
  } catch {
    return null;
  }
}

/** Resolve a declared image flavour on one item, or null when the item
 *  declares no image type at all. */
async function readItemImage(item: ClipboardItemLike): Promise<ClipboardImageResult | null> {
  const types = Array.isArray(item.types) ? item.types : [];
  const declared = IMAGE_ITEM_TYPES.filter((type) => types.includes(type));
  if (declared.length === 0) return null;
  for (const type of declared) {
    const bytes = await toBytes(await readItemType(item, type));
    if (bytes === null || bytes.length === 0) continue;
    if (!isWithinSizeCap(bytes.length)) return { ok: false, reason: "too-large" };
    const mime = sniffImageMime(bytes);
    if (mime !== null) return { ok: true, bytes, mime };
  }
  return { ok: false, reason: "unreadable" };
}

/** True for an absolute filesystem path we are willing to stat: a Windows
 *  drive path, a UNC share, or a POSIX absolute path. */
export function looksLikeAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/");
}

/** Parse a `text/plain` clipboard string into candidate local paths: `file:`
 *  URIs plus bare absolute paths, one per line; blanks/comments ignored and
 *  prose/relative lines skipped. */
export function parseTextPaths(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (line.toLowerCase().startsWith("file:")) {
      try {
        out.push(fileURLToPath(line));
      } catch {
        // Not a convertible file URI (e.g. a non-local host).
      }
      continue;
    }
    if (looksLikeAbsolutePath(line)) out.push(line);
  }
  return out;
}

/** Gather candidate file paths from every item's file-path flavours: the
 *  Explorer copy flavour is `text/uri-list`; `text/plain` may also carry a
 *  bare path. */
async function collectCandidatePaths(items: ClipboardItemLike[]): Promise<string[]> {
  const paths: string[] = [];
  for (const item of items) {
    const types = Array.isArray(item.types) ? item.types : [];
    if (types.includes("text/uri-list")) {
      const text = await toText(await readItemType(item, "text/uri-list"));
      if (text !== null) paths.push(...parseUriList(text));
    }
    if (types.includes("text/plain")) {
      const text = await toText(await readItemType(item, "text/plain"));
      if (text !== null) paths.push(...parseTextPaths(text));
    }
  }
  return paths;
}

/** Read `clipboard.readText()` when present, swallowing failures. */
async function readClipboardText(clipboard: ClipboardLike): Promise<string> {
  try {
    if (typeof clipboard.readText !== "function") return "";
    const text = await clipboard.readText();
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

/**
 * Resolve the best available clipboard image on Electron 44's ASYNC clipboard
 * API. Order: an item's native/in-page image flavour first (`image/png`, then
 * `image/jpeg`), then a copied image FILE resolved from `text/uri-list` /
 * `text/plain`. Always resolves a typed result; never rejects. Read-only.
 */
export async function readClipboardImage(
  clipboard: ClipboardLike,
  fs: ClipboardImageFs = defaultFs,
): Promise<ClipboardImageResult> {
  let items: ClipboardItemLike[];
  try {
    const read = await clipboard.read();
    items = Array.isArray(read) ? read : [];
  } catch {
    return { ok: false, reason: "empty" };
  }

  // Windows' async clipboard always returns at least one item (an OLE
  // DataObject) even for a cleared clipboard, so `empty` cannot be decided by
  // item count: an item that declares only Electron-internal formats carries
  // no user content.
  const clipText = await readClipboardText(clipboard);
  const hasUserContent = items.some((item) => {
    const types = Array.isArray(item.types) ? item.types : [];
    return types.some(
      (type) => typeof type === "string" && !type.startsWith("electron application/"),
    );
  });
  if (!hasUserContent && clipText.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }

  // 1. Native clipboard image (an in-page copied image, `image/png`).
  for (const item of items) {
    const image = await readItemImage(item);
    if (image !== null) return image;
  }

  // 2. Copied file (CF_HDROP is gone in Electron 44; Explorer's copy
  //    flavour is text/uri-list, and text/plain may carry a bare path).
  const paths = await collectCandidatePaths(items);
  if (paths.length === 0) return { ok: false, reason: "no-image" };
  const imagePaths = paths.filter(hasImageExtension);
  if (imagePaths.length === 0) return { ok: false, reason: "no-image" };

  let sawTooLarge = false;
  let sawUnreadable = false;
  for (const path of imagePaths) {
    let size: number;
    try {
      const stat = fs.stat(path);
      if (!stat.isFile()) continue;
      size = stat.size;
    } catch {
      sawUnreadable = true;
      continue;
    }
    if (!isWithinSizeCap(size)) {
      sawTooLarge = true;
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = fs.read(path);
    } catch {
      sawUnreadable = true;
      continue;
    }
    const mime = sniffImageMime(bytes);
    if (mime === null) {
      sawUnreadable = true;
      continue;
    }
    return { ok: true, bytes, mime };
  }
  if (sawTooLarge) return { ok: false, reason: "too-large" };
  if (sawUnreadable) return { ok: false, reason: "unreadable" };
  return { ok: false, reason: "no-image" };
}
