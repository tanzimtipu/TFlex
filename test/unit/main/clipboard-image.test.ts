// Phase 45 — clipboard image reader unit tests.
//
// Electron 44 removed the synchronous clipboard API, so the reader is driven
// against the ASYNC shape: `clipboard.read()` resolves an array of items, each
// with a `types` list and `getType(type)` resolving a Blob (or raw bytes in
// tests). An injected fs keeps the disk untouched.
//
// Mock shape: `{ read: async () => ClipboardItemLike[] }` where each item is
// `{ types: string[], getType: async (type) => Blob | Uint8Array }`. The
// Blob-like only needs `arrayBuffer()`, which is what Electron's async
// clipboard actually resolves.

import { describe, expect, it } from 'vitest';
import {
  CLIPBOARD_IMAGE_MAX_BYTES,
  hasImageExtension,
  isWithinSizeCap,
  looksLikeAbsolutePath,
  parseTextPaths,
  parseUriList,
  readClipboardImage,
  sniffImageMime,
  type ClipboardImageFs,
  type ClipboardItemLike,
  type ClipboardLike,
} from '../../../src/main/services/clipboard-image';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** A Blob-like value: `arrayBuffer()` is what Electron's async clipboard
 *  `getType()` resolves. */
function blob(bytes: Uint8Array): { arrayBuffer(): Promise<ArrayBuffer> } {
  const copy = Uint8Array.from(bytes);
  return {
    arrayBuffer: async () =>
      copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
  };
}

/** One async clipboard item; values may be raw bytes or a string (encoded as
 *  UTF-8), both surfaced as a Blob-like just like the real clipboard. */
function item(
  values: Record<string, Uint8Array | string>,
  types: string[] = Object.keys(values),
): ClipboardItemLike {
  return {
    types,
    getType: async (type) => {
      const value = values[type];
      if (value === undefined) throw new Error(`no clipboard type: ${type}`);
      return typeof value === 'string' ? blob(new TextEncoder().encode(value)) : blob(value);
    },
  };
}

/** A clipboard whose read() resolves the given items (and an optional text). */
function makeClipboard(items: ClipboardItemLike[] = [], text = ''): ClipboardLike {
  return {
    read: async () => items,
    readText: async () => text,
  };
}

interface FakeFile {
  size?: number;
  bytes?: Uint8Array;
  isFile?: boolean;
}

/** In-memory fs keyed by path; a missing key makes `stat` throw. */
function makeFs(files: Record<string, FakeFile> = {}): ClipboardImageFs {
  return {
    stat(path: string) {
      const entry = files[path];
      if (entry === undefined) throw new Error(`ENOENT: ${path}`);
      return { isFile: () => entry.isFile ?? true, size: entry.size ?? (entry.bytes?.length ?? 0) };
    },
    read(path: string) {
      const entry = files[path];
      if (entry === undefined || entry.bytes === undefined) {
        throw new Error(`cannot read: ${path}`);
      }
      return entry.bytes;
    },
  };
}

/** Windows path -> `file:` URI, as Explorer's text/uri-list flavour carries. */
function toFileUri(path: string): string {
  return 'file:///' + path.replace(/\\/g, '/');
}

/** A copied-file clipboard: Explorer's copy flavour is text/uri-list. */
function fileClipboard(paths: string[]): ClipboardLike {
  const uriList = paths.map(toFileUri).join('\r\n') + '\r\n';
  return makeClipboard([item({ 'text/uri-list': uriList }, ['text/uri-list'])]);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('hasImageExtension', () => {
  it('accepts png/jpg/jpeg, case-insensitively', () => {
    expect(hasImageExtension('C:\\a\\photo.png')).toBe(true);
    expect(hasImageExtension('C:\\a\\photo.PNG')).toBe(true);
    expect(hasImageExtension('C:\\a\\photo.jpg')).toBe(true);
    expect(hasImageExtension('C:\\a\\photo.JPEG')).toBe(true);
  });

  it('rejects other image types and non-images', () => {
    expect(hasImageExtension('C:\\a\\anim.gif')).toBe(false);
    expect(hasImageExtension('C:\\a\\pic.webp')).toBe(false);
    expect(hasImageExtension('C:\\a\\doc.pdf')).toBe(false);
    expect(hasImageExtension('C:\\a\\notes.txt')).toBe(false);
    expect(hasImageExtension('C:\\a\\noext')).toBe(false);
  });

  it('only considers the basename extension', () => {
    expect(hasImageExtension('C:\\a.png\\not-an-image')).toBe(false);
  });
});

describe('sniffImageMime', () => {
  it('recognises a PNG signature', () => {
    expect(sniffImageMime(PNG_BYTES)).toBe('image/png');
  });

  it('recognises a JPEG SOI', () => {
    expect(sniffImageMime(JPEG_BYTES)).toBe('image/jpeg');
  });

  it('returns null for other bytes', () => {
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(sniffImageMime(new Uint8Array([]))).toBeNull();
  });

  it('returns null for a truncated PNG/JPEG prefix', () => {
    expect(sniffImageMime(PNG_BYTES.subarray(0, 7))).toBeNull();
    expect(sniffImageMime(JPEG_BYTES.subarray(0, 2))).toBeNull();
  });
});

describe('isWithinSizeCap', () => {
  it('uses the 20 MB cap by default', () => {
    expect(CLIPBOARD_IMAGE_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(isWithinSizeCap(CLIPBOARD_IMAGE_MAX_BYTES)).toBe(true);
    expect(isWithinSizeCap(CLIPBOARD_IMAGE_MAX_BYTES + 1)).toBe(false);
  });

  it('honours a custom cap', () => {
    expect(isWithinSizeCap(100, 100)).toBe(true);
    expect(isWithinSizeCap(101, 100)).toBe(false);
  });
});

describe('parseUriList', () => {
  it('converts file: URIs to paths and skips blanks/comments/other schemes', () => {
    const text = [
      'file:///C:/pics/a.png',
      '# a comment',
      '',
      'http://example.com/b.jpg',
      'file:///C:/pics/c.jpeg',
    ].join('\r\n');
    expect(parseUriList(text)).toEqual(['C:\\pics\\a.png', 'C:\\pics\\c.jpeg']);
  });

  it('returns an empty list for text without file: lines', () => {
    expect(parseUriList('just some text\nfile:')).toEqual([]);
  });
});

describe('looksLikeAbsolutePath', () => {
  it('accepts drive, UNC and POSIX absolute paths', () => {
    expect(looksLikeAbsolutePath('C:\\pics\\a.png')).toBe(true);
    expect(looksLikeAbsolutePath('c:/pics/a.png')).toBe(true);
    expect(looksLikeAbsolutePath('\\\\server\\share\\a.png')).toBe(true);
    expect(looksLikeAbsolutePath('/home/u/a.png')).toBe(true);
  });

  it('rejects prose and relative paths', () => {
    expect(looksLikeAbsolutePath('hello world')).toBe(false);
    expect(looksLikeAbsolutePath('pics\\a.png')).toBe(false);
    expect(looksLikeAbsolutePath('.\\a.png')).toBe(false);
  });
});

describe('parseTextPaths', () => {
  it('extracts file: URIs and bare absolute paths, skipping prose', () => {
    const text = ['C:\\pics\\a.png', 'file:///C:/pics/b.jpg', 'hello world', ''].join('\r\n');
    expect(parseTextPaths(text)).toEqual(['C:\\pics\\a.png', 'C:\\pics\\b.jpg']);
  });

  it('returns an empty list for prose-only text', () => {
    expect(parseTextPaths('hello clipboard text only')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Handler wiring (async clipboard + fs mocked)
// ---------------------------------------------------------------------------

describe('readClipboardImage - native clipboard image', () => {
  it('returns an image/png item as PNG bytes', async () => {
    const clipboard = makeClipboard([item({ 'image/png': PNG_BYTES })]);
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: true,
      bytes: PNG_BYTES,
      mime: 'image/png',
    });
  });

  it('returns an image/jpeg item and sniffs image/jpeg', async () => {
    const clipboard = makeClipboard([item({ 'image/jpeg': JPEG_BYTES })]);
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: true,
      bytes: JPEG_BYTES,
      mime: 'image/jpeg',
    });
  });

  it('prefers the native image over a copied file', async () => {
    const clipboard = makeClipboard([
      item({ 'image/png': PNG_BYTES }),
      item({ 'text/uri-list': `file:///C:/pics/file.jpg\r\n` }, ['text/uri-list']),
    ]);
    const fs = makeFs({ 'C:\\pics\\file.jpg': { bytes: JPEG_BYTES } });
    const result = await readClipboardImage(clipboard, fs);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mime).toBe('image/png');
  });

  it('reports too-large when the native image exceeds the cap', async () => {
    const huge = new Uint8Array(CLIPBOARD_IMAGE_MAX_BYTES + 1);
    const clipboard = makeClipboard([item({ 'image/png': huge })]);
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  it('reports unreadable when the image flavour is empty', async () => {
    const clipboard = makeClipboard([item({ 'image/png': new Uint8Array(0) })]);
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('reports unreadable when the image bytes are not PNG/JPEG', async () => {
    const clipboard = makeClipboard([item({ 'image/png': new Uint8Array([0x47, 0x49, 0x46, 0x38]) })]);
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('reports unreadable when getType throws for a declared image type', async () => {
    const clipboard = makeClipboard([
      {
        types: ['image/png'],
        getType: async () => {
          throw new Error('clipboard read failed');
        },
      },
    ]);
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });
});

describe('readClipboardImage - copied image file', () => {
  it('reads a text/uri-list png path and sniffs image/png', async () => {
    const fs = makeFs({ 'C:\\pics\\photo.png': { bytes: PNG_BYTES } });
    await expect(readClipboardImage(fileClipboard(['C:\\pics\\photo.png']), fs)).resolves.toEqual({
      ok: true,
      bytes: PNG_BYTES,
      mime: 'image/png',
    });
  });

  it('sniffs image/jpeg from the magic bytes, not the extension', async () => {
    const fs = makeFs({ 'C:\\pics\\photo.png': { bytes: JPEG_BYTES } });
    await expect(readClipboardImage(fileClipboard(['C:\\pics\\photo.png']), fs)).resolves.toEqual({
      ok: true,
      bytes: JPEG_BYTES,
      mime: 'image/jpeg',
    });
  });

  it('reads a bare path from text/plain', async () => {
    const clipboard = makeClipboard([
      item({ 'text/plain': 'C:\\pics\\a.png' }, ['text/plain']),
    ]);
    const fs = makeFs({ 'C:\\pics\\a.png': { bytes: PNG_BYTES } });
    await expect(readClipboardImage(clipboard, fs)).resolves.toEqual({
      ok: true,
      bytes: PNG_BYTES,
      mime: 'image/png',
    });
  });

  it('reads a file: URI from text/plain', async () => {
    const clipboard = makeClipboard([
      item({ 'text/plain': 'file:///C:/pics/b.jpg' }, ['text/plain']),
    ]);
    const fs = makeFs({ 'C:\\pics\\b.jpg': { bytes: JPEG_BYTES } });
    await expect(readClipboardImage(clipboard, fs)).resolves.toEqual({
      ok: true,
      bytes: JPEG_BYTES,
      mime: 'image/jpeg',
    });
  });

  it('skips an unusable image path and uses the next candidate', async () => {
    const clipboard = fileClipboard(['C:\\pics\\missing.png', 'C:\\pics\\good.jpg']);
    const fs = makeFs({ 'C:\\pics\\good.jpg': { bytes: JPEG_BYTES } });
    await expect(readClipboardImage(clipboard, fs)).resolves.toEqual({
      ok: true,
      bytes: JPEG_BYTES,
      mime: 'image/jpeg',
    });
  });

  it('reports too-large for an oversized copied file', async () => {
    const fs = makeFs({
      'C:\\pics\\huge.png': { size: CLIPBOARD_IMAGE_MAX_BYTES + 1, bytes: PNG_BYTES },
    });
    await expect(readClipboardImage(fileClipboard(['C:\\pics\\huge.png']), fs)).resolves.toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  it('reports unreadable when the path cannot be stat-ed', async () => {
    await expect(readClipboardImage(fileClipboard(['C:\\pics\\gone.png']), makeFs())).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('reports unreadable when the magic bytes are not PNG/JPEG', async () => {
    const fs = makeFs({
      'C:\\pics\\fake.png': { bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]) },
    });
    await expect(readClipboardImage(fileClipboard(['C:\\pics\\fake.png']), fs)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('skips a non-regular file (directory) and reports no-image', async () => {
    const fs = makeFs({ 'C:\\pics\\folder.png': { isFile: false, size: 0 } });
    await expect(readClipboardImage(fileClipboard(['C:\\pics\\folder.png']), fs)).resolves.toEqual({
      ok: false,
      reason: 'no-image',
    });
  });
});

describe('readClipboardImage - empty vs no-image split', () => {
  it('reports empty when the clipboard holds nothing at all', async () => {
    await expect(readClipboardImage(makeClipboard(), makeFs())).resolves.toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('reports empty for an internal-only item (a cleared Windows clipboard)', async () => {
    // Electron 44 on Windows returns one OLE DataObject item even when the
    // clipboard is empty; it declares only electron-internal formats.
    const clipboard = makeClipboard([
      item({}, ['electron application/osclipboard;format="DataObject"']),
    ]);
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('reports no-image for an internal-only item when readText has content', async () => {
    const clipboard = makeClipboard(
      [item({}, ['electron application/osclipboard;format="DataObject"'])],
      'hello',
    );
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: false,
      reason: 'no-image',
    });
  });

  it('reports no-image when read() is empty but readText has content', async () => {
    await expect(readClipboardImage(makeClipboard([], 'hello'), makeFs())).resolves.toEqual({
      ok: false,
      reason: 'no-image',
    });
  });

  it('reports no-image for a text-only clipboard', async () => {
    const clipboard = makeClipboard([item({ 'text/plain': 'hello' }, ['text/plain'])]);
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: false,
      reason: 'no-image',
    });
  });

  it('reports no-image when the copied files are not images', async () => {
    await expect(readClipboardImage(fileClipboard(['C:\\docs\\report.pdf']), makeFs())).resolves.toEqual({
      ok: false,
      reason: 'no-image',
    });
  });
});

describe('readClipboardImage - resilience', () => {
  it('never rejects when clipboard.read() throws', async () => {
    const clipboard: ClipboardLike = {
      read: async () => {
        throw new Error('clipboard unavailable');
      },
    };
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('never rejects when every item getType throws', async () => {
    const clipboard: ClipboardLike = {
      read: async () => [
        {
          types: ['text/uri-list'],
          getType: async () => {
            throw new Error('clipboard unavailable');
          },
        },
      ],
    };
    await expect(readClipboardImage(clipboard, makeFs())).resolves.toEqual({
      ok: false,
      reason: 'no-image',
    });
  });
});

