import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ok } from '../../../src/shared/result';
import type { ConvertErrorCode, ConvertFormatId, ConvertResult } from '../../../src/shared/convert';
import {
  DocumentConversionService,
  type ConvertEnginePort,
} from '../../../src/main/services/convert';
import {
  ConvertRegistry,
  createDefaultRegistry,
  readSniffHead,
  type ConversionAdapter,
} from '../../../src/main/services/convert/registry';
import { CONVERT_ERROR_MESSAGES } from '../../../src/main/services/convert/errors';
import { CONVERT_LIMITS } from '../../../src/main/services/convert/limits';

/**
 * Phase 53 chunk A — registry, error layer and limits foundation.
 * Fixtures are synthetic, built in-test (no committed binaries).
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-convert-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const stubEngine: ConvertEnginePort = {
  async loadDocumentBytes() {
    return ok(new ArrayBuffer(0));
  },
};

interface StubOptions {
  label?: string;
  extensions?: string[];
  specificity?: 'generic' | 'specific';
  sniff?: (path: string, head: Buffer) => boolean;
  convert?: () => Promise<ConvertResult>;
}

function stubAdapter(id: ConvertFormatId, options: StubOptions = {}): ConversionAdapter {
  return {
    id,
    label: options.label ?? id,
    extensions: options.extensions ?? [],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'native',
    specificity: options.specificity ?? 'generic',
    sniff: options.sniff ?? (() => true),
    convert:
      options.convert ??
      (async () => ({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        pageCount: 1,
        sourceFormat: id,
        fidelity: 'native',
        warnings: [],
        title: id,
      })),
  };
}

function registryWith(adapters: Array<{ id: ConvertFormatId; extensions: string[]; adapter: ConversionAdapter }>): ConvertRegistry {
  const registry = new ConvertRegistry();
  for (const entry of adapters) {
    registry.register({
      id: entry.id,
      extensions: entry.extensions,
      load: async () => entry.adapter,
    });
  }
  return registry;
}

async function mkFile(name: string, content: string | Buffer): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe('phase53 convert registry', () => {
  it('resolves .txt to the shipped text adapter by extension', async () => {
    const path = await mkFile('notes.txt', 'hello');
    const registry = createDefaultRegistry();
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('text');
    expect(resolved?.byExtension).toBe(true);
  });

  it('resolves by extension for an in-test stub adapter', async () => {
    const path = await mkFile('data.foo', 'abc');
    const stub = stubAdapter('markdown', { extensions: ['.foo'] });
    const registry = registryWith([{ id: 'markdown', extensions: ['.foo'], adapter: stub }]);
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('markdown');
    expect(resolved?.byExtension).toBe(true);
  });

  it('routes by content when the extension candidate sniff returns false', async () => {
    const path = await mkFile('mystery.foo', 'content bytes');
    const wrong = stubAdapter('markdown', {
      extensions: ['.foo'],
      sniff: () => false,
    });
    const right = stubAdapter('csv', {
      extensions: ['.bar'],
      sniff: () => true,
    });
    const registry = registryWith([
      { id: 'markdown', extensions: ['.foo'], adapter: wrong },
      { id: 'csv', extensions: ['.bar'], adapter: right },
    ]);
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('csv');
    expect(resolved?.byExtension).toBe(false);
  });

  it('returns null for an unknown extension with no content match', async () => {
    const path = await mkFile('archive.xyz', 'plain bytes');
    const registry = createDefaultRegistry();
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved).toBeNull();
  });

  it('reports unsupported-format for a NUL-bearing mislabelled .txt', async () => {
    const path = await mkFile('binary.txt', Buffer.from([0x00, 0x01, 0x02, 0x00]));
    const service = new DocumentConversionService({ engine: stubEngine });
    const result = await service.sourceInfo(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported-format');
  });
});

describe('phase53 registry precedence (criterion 9)', () => {
  it('a specific content match beats a generic extension match', async () => {
    // .txt extension candidate is the GENERIC text stub and its sniff passes;
    // a SPECIFIC stub matches the same bytes. The specific one must win even
    // though the generic one is the extension candidate registered first.
    const path = await mkFile('mislabelled.txt', 'content bytes');
    const generic = stubAdapter('text', {
      extensions: ['.txt'],
      specificity: 'generic',
      sniff: () => true,
    });
    const specific = stubAdapter('markdown', {
      extensions: ['.md'],
      specificity: 'specific',
      sniff: () => true,
    });
    const registry = registryWith([
      { id: 'text', extensions: ['.txt'], adapter: generic },
      { id: 'markdown', extensions: ['.md'], adapter: specific },
    ]);
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('markdown');
    expect(resolved?.byExtension).toBe(false);
  });

  it('the specific adapter wins regardless of registration order', async () => {
    const path = await mkFile('mislabelled.txt', 'content bytes');
    const generic = stubAdapter('text', {
      extensions: ['.txt'],
      specificity: 'generic',
      sniff: () => true,
    });
    const specific = stubAdapter('markdown', {
      extensions: ['.md'],
      specificity: 'specific',
      sniff: () => true,
    });
    const registry = registryWith([
      { id: 'markdown', extensions: ['.md'], adapter: specific },
      { id: 'text', extensions: ['.txt'], adapter: generic },
    ]);
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('markdown');
  });

  it('the generic extension candidate wins when no specific adapter matches', async () => {
    const path = await mkFile('plain.txt', 'plain content');
    const generic = stubAdapter('text', {
      extensions: ['.txt'],
      specificity: 'generic',
      sniff: () => true,
    });
    const specific = stubAdapter('markdown', {
      extensions: ['.md'],
      specificity: 'specific',
      sniff: () => false,
    });
    const registry = registryWith([
      { id: 'text', extensions: ['.txt'], adapter: generic },
      { id: 'markdown', extensions: ['.md'], adapter: specific },
    ]);
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('text');
    expect(resolved?.byExtension).toBe(true);
  });
});

describe('phase53 conversion service', () => {
  it('reports unsupported-format for an unknown extension', async () => {
    const path = await mkFile('archive.xyz', 'plain bytes');
    const service = new DocumentConversionService({ engine: stubEngine });
    const result = await service.sourceInfo(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported-format');
  });

  it('reports empty-file for a zero-byte supported file', async () => {
    const path = await mkFile('empty.txt', '');
    const service = new DocumentConversionService({ engine: stubEngine });
    const result = await service.sourceInfo(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('empty-file');
  });

  it('resolves an adapter throw to err(internal) without rejecting', async () => {
    const path = await mkFile('boom.md', 'body');
    const boom = stubAdapter('markdown', {
      extensions: ['.md'],
      convert: async () => {
        throw new Error('adapter exploded');
      },
    });
    const registry = registryWith([{ id: 'markdown', extensions: ['.md'], adapter: boom }]);
    const service = new DocumentConversionService({ engine: stubEngine, registry });
    const result = await service.toDocument('doc-1', path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal');
      expect(result.error.message).toContain('adapter exploded');
    }
  });

  it('returns too-large above CONVERT_LIMITS.textBytes', async () => {
    const path = join(dir, 'huge.txt');
    await writeFile(path, Buffer.alloc(CONVERT_LIMITS.sniffHeadBytes, 0x61));
    await truncate(path, CONVERT_LIMITS.textBytes + 1);
    const service = new DocumentConversionService({ engine: stubEngine });
    const result = await service.toDocument('doc-big', path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too-large');
  });
});

describe('phase53 error layer', () => {
  it('gives every ConvertErrorCode a non-empty human message', () => {
    const expected: ConvertErrorCode[] = [
      'unsupported-format',
      'empty-file',
      'password-required',
      'too-large',
      'decode-failed',
      'corrupt',
      'cancelled',
      'timeout',
      'internal',
    ];
    for (const code of expected) {
      const message = CONVERT_ERROR_MESSAGES[code];
      expect(typeof message).toBe('string');
      expect(message.trim().length).toBeGreaterThan(0);
    }
    expect(Object.keys(CONVERT_ERROR_MESSAGES).sort()).toEqual([...expected].sort());
  });
});
