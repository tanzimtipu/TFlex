import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../../src/shared/result';
import type { ConvertResult } from '../../../src/shared/convert';
import { isPdfBytes } from '../../../src/main/services/print';
import { injectSecurityMeta } from '../../../src/main/services/convert/templates';
import {
  createHtmlAdapter,
  htmlAdapter,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/html';
import { readSniffHead } from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';
import {
  detectRemoteResources,
  mergeResourceUrls,
} from '../../../src/main/services/convert/remote-resources';

/**
 * Phase 53 chunk B — the HTML adapter. The print engine is injected, so no
 * Electron is needed.
 */

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/tmp') },
  session: {
    fromPartition: vi.fn(() => ({
      webRequest: { onBeforeRequest: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
    })),
    defaultSession: {},
  },
  BrowserWindow: class {},
}));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-html-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkFile(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

function counting(count: number, blockedUrls: string[] = []): HtmlPrintFn {
  return async () =>
    ok({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      pageCount: count,
      blockedUrls,
    });
}

describe('phase53 html sniff', () => {
  it('accepts .html/.htm/.xhtml by extension', () => {
    for (const name of ['a.html', 'a.htm', 'a.xhtml']) {
      expect(htmlAdapter.sniff(join(dir, name), Buffer.from('plain'))).toBe(true);
    }
  });

  it('accepts doctype/html content regardless of extension', () => {
    expect(htmlAdapter.sniff('a.txt', Buffer.from('<!DOCTYPE html><body>x'))).toBe(true);
    expect(htmlAdapter.sniff('a.txt', Buffer.from('<HTML><body>x'))).toBe(true);
  });

  it('rejects a plain text file with a non-HTML extension', () => {
    expect(htmlAdapter.sniff('a.txt', Buffer.from('just some words\nand more'))).toBe(false);
  });
});

describe('phase53 CSP injection', () => {
  it('injects exactly once into a document with a head', () => {
    const html = injectSecurityMeta(
      '<!doctype html><html><head><title>t</title></head><body></body></html>',
    );
    expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('injects exactly once into a document with no head', () => {
    const html = injectSecurityMeta('<html><body><p>hi</p></body></html>');
    expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(html).toContain('<head>');
  });

  it('wraps a bare fragment exactly once', () => {
    const html = injectSecurityMeta('<p>hi</p>');
    expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(html).toContain('<html>');
  });

  it('is idempotent on an already-injected document', () => {
    const once = injectSecurityMeta('<p>hi</p>');
    expect(injectSecurityMeta(once).match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('the adapter injects the CSP into the html it hands the engine', async () => {
    let captured = '';
    const print: HtmlPrintFn = async (html) => {
      captured = html;
      return ok({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
        pageCount: 1,
        blockedUrls: [],
      });
    };
    const path = await mkFile('doc.html', '<html><body><p>hi</p></body></html>');
    await createHtmlAdapter(print).convert({
      path,
      options: resolveConvertOptions(),
      head: await readSniffHead(path),
    });
    expect(captured.match(/Content-Security-Policy/g)).toHaveLength(1);
  });
});

describe('phase53 html adapter result and warnings', () => {
  it('returns a layout result and caps blocked-resource warnings at 5', async () => {
    const path = await mkFile('doc.html', '<html><body><img src="https://x/y.png"></body></html>');
    const urls = Array.from({ length: 7 }, (_, i) => `https://x/${i}.png`);
    const result: ConvertResult = await createHtmlAdapter(counting(4, urls)).convert({
      path,
      options: resolveConvertOptions(),
      head: await readSniffHead(path),
    });
    expect(result.sourceFormat).toBe('html');
    expect(result.fidelity).toBe('layout');
    expect(result.pageCount).toBe(4);
    const blocked = result.warnings.filter((warning) => warning.code === 'resource-blocked');
    expect(blocked).toHaveLength(5);
    // 7 session-blocked urls + the one remote <img src> the source scan detects
    // are all distinct, so the truthful total is now 8 (was 7 before the
    // source-level detection pass existed). The cap assertion is unchanged.
    expect(blocked[0]?.detail).toContain('8');
  });
});

describe('phase53 html empty-visible-content warning (DEF-376)', () => {
  async function convertWith(print: HtmlPrintFn, name: string, content: string): Promise<ConvertResult> {
    const path = await mkFile(name, content);
    return createHtmlAdapter(print).convert({
      path,
      options: resolveConvertOptions(),
      head: await readSniffHead(path),
    });
  }

  it('converts a whitespace-only source and warns partial-content once', async () => {
    const result = await convertWith(
      counting(1),
      'blank.html',
      '<html><body>   \n\n</body></html>',
    );
    expect(isPdfBytes(result.bytes)).toBe(true);
    const partial = result.warnings.filter((warning) => warning.code === 'partial-content');
    expect(partial).toHaveLength(1);
    expect(partial[0]?.message).toContain('no visible content');
    expect(partial[0]?.detail).toMatch(/\d+ character\(s\)/);
  });

  it('does not warn for a contentful source', async () => {
    const result = await convertWith(counting(1), 'words.html', '<html><body><p>hi</p></body></html>');
    expect(result.warnings.some((warning) => warning.code === 'partial-content')).toBe(false);
  });

  it('does not warn for an image-only page, local or remote', async () => {
    const local = await convertWith(
      counting(1),
      'img-local.html',
      '<html><body><img src="images/local.png"></body></html>',
    );
    expect(local.warnings.some((warning) => warning.code === 'partial-content')).toBe(false);

    const remote = await convertWith(
      counting(1),
      'img-remote.html',
      '<html><body><img src="https://example.com/a.png"></body></html>',
    );
    expect(remote.warnings.some((warning) => warning.code === 'partial-content')).toBe(false);
    // The remote image still raises its own resource-blocked warning.
    expect(remote.warnings.some((warning) => warning.code === 'resource-blocked')).toBe(true);
  });

  it('warns for an empty-text source with only a heading and a rule', async () => {
    const result = await convertWith(counting(1), 'empty.html', '<html><body><h1></h1><hr></body></html>');
    const partial = result.warnings.filter((warning) => warning.code === 'partial-content');
    expect(partial).toHaveLength(1);
  });

  it('does not warn when the head carries only a title but the body has text', async () => {
    const result = await convertWith(
      counting(1),
      'head.html',
      '<html><head><title>t</title></head><body><p>seen</p></body></html>',
    );
    expect(result.warnings.some((warning) => warning.code === 'partial-content')).toBe(false);
  });
});

describe('phase53 html remote-resource detection', () => {
  it('names the remote stylesheet, image and @import from the source', () => {
    const html = [
      '<html><head>',
      '<link rel="stylesheet" href="https://example.com/style.css">',
      '<style>@import "https://example.com/imported.css";</style>',
      '</head><body>',
      '<img src="https://example.com/x.png">',
      '</body></html>',
    ].join('');
    expect(detectRemoteResources(html)).toEqual([
      'https://example.com/style.css',
      'https://example.com/imported.css',
      'https://example.com/x.png',
    ]);
  });

  it('ignores data:, relative and file: references', () => {
    const html = [
      '<img src="data:image/png;base64,AAAA">',
      '<img src="images/local.png">',
      '<a href="#top">top</a>',
      '<style>body{background:url(./bg.png)}</style>',
    ].join('');
    expect(detectRemoteResources(html)).toEqual([]);
  });

  it('detects a protocol-relative URL', () => {
    expect(detectRemoteResources('<img src="//cdn.example.com/a.png">')).toEqual([
      '//cdn.example.com/a.png',
    ]);
  });

  it('de-duplicates by normalised URL, preserving the first spelling', () => {
    const urls = mergeResourceUrls(
      ['https://EXAMPLE.com/a.png'],
      ['https://example.com/a.png'],
    );
    expect(urls).toEqual(['https://example.com/a.png']);
  });
});

describe('phase53 html adapter resource-blocked warnings', () => {
  it('warns once per remote subresource even when the session recorded none', async () => {
    const path = await mkFile(
      'net.html',
      [
        '<html><head>',
        '<link rel="stylesheet" href="https://example.com/style.css">',
        '<style>@import "https://example.com/imported.css";</style>',
        '</head><body><img src="https://example.com/x.png"></body></html>',
      ].join(''),
    );
    const result = await createHtmlAdapter(counting(1)).convert({
      path,
      options: resolveConvertOptions(),
      head: await readSniffHead(path),
    });
    const blocked = result.warnings.filter((w) => w.code === 'resource-blocked');
    expect(blocked).toHaveLength(3);
    const messages = blocked.map((w) => w.message).join('\n');
    expect(messages).toContain('https://example.com/style.css');
    expect(messages).toContain('https://example.com/imported.css');
    expect(messages).toContain('https://example.com/x.png');
  });

  it('caps at 5 names with the total in detail', async () => {
    const links = Array.from(
      { length: 7 },
      (_, i) => `<img src="https://example.com/${i}.png">`,
    ).join('');
    const path = await mkFile('many.html', `<html><body>${links}</body></html>`);
    const result = await createHtmlAdapter(counting(1)).convert({
      path,
      options: resolveConvertOptions(),
      head: await readSniffHead(path),
    });
    const blocked = result.warnings.filter((w) => w.code === 'resource-blocked');
    expect(blocked).toHaveLength(5);
    expect(blocked[0]?.detail).toContain('7');
  });

  it('reports a URL linked twice only once', async () => {
    const path = await mkFile(
      'dup.html',
      '<html><body><img src="https://example.com/a.png"><img src="https://example.com/a.png"></body></html>',
    );
    const result = await createHtmlAdapter(counting(1)).convert({
      path,
      options: resolveConvertOptions(),
      head: await readSniffHead(path),
    });
    const blocked = result.warnings.filter((w) => w.code === 'resource-blocked');
    expect(blocked).toHaveLength(1);
  });

  it('does not double-report a URL the session already blocked', async () => {
    const path = await mkFile(
      'both.html',
      '<html><body><img src="https://example.com/a.png"></body></html>',
    );
    const result = await createHtmlAdapter(
      counting(1, ['https://example.com/a.png']),
    ).convert({
      path,
      options: resolveConvertOptions(),
      head: await readSniffHead(path),
    });
    const blocked = result.warnings.filter((w) => w.code === 'resource-blocked');
    expect(blocked).toHaveLength(1);
  });

  it('yields no warning for a document with only local and data references', async () => {
    const path = await mkFile(
      'local.html',
      '<html><body><img src="data:image/png;base64,AAAA"><img src="images/local.png"></body></html>',
    );
    const result = await createHtmlAdapter(counting(1)).convert({
      path,
      options: resolveConvertOptions(),
      head: await readSniffHead(path),
    });
    expect(result.warnings.filter((w) => w.code === 'resource-blocked')).toHaveLength(0);
  });
});
