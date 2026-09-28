import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../../src/shared/result';
import type { ConvertResult } from '../../../src/shared/convert';
import { isPdfBytes } from '../../../src/main/services/print';
import {
  MARKDOWN_PRINT_CSS,
  markdownToHtml,
} from '../../../src/main/services/convert/markdown-to-html';
import {
  createMarkdownAdapter,
  hasMarkdownLink,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/markdown';
import { createDefaultRegistry, readSniffHead } from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';

/**
 * Phase 53 chunk B — the Markdown adapter and `marked` renderer. The print
 * engine is injected, so no Electron is needed.
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

const FIXTURE = [
  '# H1',
  '## H2',
  '### H3',
  '#### H4',
  '##### H5',
  '###### H6',
  '',
  '**bold** and *italic* and [docs](https://example.com)',
  '',
  '- alpha',
  '- beta',
  '',
  '1. one',
  '2. two',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '> a quote',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '---',
].join('\n');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-md-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkFile(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

function fakePrint(blockedUrls: string[] = []): HtmlPrintFn {
  return async () =>
    ok({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      pageCount: 3,
      blockedUrls,
    });
}

async function convertMarkdown(path: string, print = fakePrint()): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  return createMarkdownAdapter(print).convert({
    path,
    options: resolveConvertOptions(),
    head,
  });
}

function headingSizes(): string[] {
  const sizes: string[] = [];
  for (let level = 1; level <= 6; level += 1) {
    const match = new RegExp(`h${level}\\s*\\{[^}]*?font-size:\\s*([0-9.]+(?:px|pt))`).exec(
      MARKDOWN_PRINT_CSS,
    );
    expect(match, `h${level} font-size`).not.toBeNull();
    if (match) sizes.push(match[1]);
  }
  return sizes;
}

describe('phase53 markdown rendering', () => {
  it('renders every promised construct to semantic HTML', () => {
    const html = markdownToHtml(FIXTURE);
    for (let level = 1; level <= 6; level += 1) {
      expect(html).toContain(`<h${level}`);
    }
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<table>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('Content-Security-Policy');
  });

  it('gives H1-H6 six pairwise-different font sizes and a rule per construct', () => {
    const sizes = headingSizes();
    expect(sizes).toHaveLength(6);
    expect(new Set(sizes).size).toBe(6);
    for (const selector of ['strong', 'em', 'a', 'ul', 'ol', 'table', 'blockquote', 'pre', 'hr']) {
      expect(MARKDOWN_PRINT_CSS).toMatch(new RegExp(`(^|\\n)${selector}\\s*\\{`));
    }
  });
});

describe('phase53 markdown adapter warnings', () => {
  it('emits links-not-live for a source with a link and not for one without', async () => {
    const withLink = await mkFile('linked.md', '# Title\n\n[site](https://example.com)\n');
    const linked = await convertMarkdown(withLink);
    expect(linked.warnings.some((warning) => warning.code === 'links-not-live')).toBe(true);

    const withoutLink = await mkFile('plain.md', '# Title\n\nplain body\n');
    const plain = await convertMarkdown(withoutLink);
    expect(plain.warnings.some((warning) => warning.code === 'links-not-live')).toBe(false);
  });

  it('detects inline links but not images', () => {
    expect(hasMarkdownLink('[a](u)')).toBe(true);
    expect(hasMarkdownLink('![alt](u)')).toBe(false);
  });

  it('returns layout fidelity, page count, format and resource warnings', async () => {
    const path = await mkFile('doc.md', FIXTURE);
    const result = await convertMarkdown(path, fakePrint(['https://x/y.png']));
    expect(result.sourceFormat).toBe('markdown');
    expect(result.fidelity).toBe('layout');
    expect(result.pageCount).toBe(3);
    expect(result.warnings.some((warning) => warning.code === 'resource-blocked')).toBe(true);
  });
});

describe('phase53 markdown empty-visible-content warning (DEF-376)', () => {
  it('converts a whitespace-only source and warns partial-content once', async () => {
    const path = await mkFile('blank.md', '   \n\n\t\n');
    const result = await convertMarkdown(path);
    expect(isPdfBytes(result.bytes)).toBe(true);
    const partial = result.warnings.filter((warning) => warning.code === 'partial-content');
    expect(partial).toHaveLength(1);
    expect(partial[0]?.message).toContain('no visible content');
    expect(partial[0]?.detail).toMatch(/\d+ character\(s\), \d+ line\(s\)/);
  });

  it('does not warn for a contentful source', async () => {
    const path = await mkFile('content.md', '# Title\n\nsome real words\n');
    const result = await convertMarkdown(path);
    expect(result.warnings.some((warning) => warning.code === 'partial-content')).toBe(false);
  });

  it('does not warn for an image-only source (renders content)', async () => {
    const path = await mkFile('img.md', '![alt](https://example.com/a.png)\n');
    const result = await convertMarkdown(path);
    expect(result.warnings.some((warning) => warning.code === 'partial-content')).toBe(false);
  });

  it('warns for a source whose headings hold no words and only a rule renders', async () => {
    const path = await mkFile('empty-headings.md', '#\n\n##\n\n---\n');
    const result = await convertMarkdown(path);
    const partial = result.warnings.filter((warning) => warning.code === 'partial-content');
    expect(partial).toHaveLength(1);
    expect(partial[0]?.message).toContain('no visible content');
  });

  it('leaves the existing links-not-live code and text unchanged', async () => {
    const path = await mkFile('linked2.md', '# T\n\n[site](https://example.com)\n');
    const result = await convertMarkdown(path);
    const link = result.warnings.find((warning) => warning.code === 'links-not-live');
    expect(link?.message).toBe(
      'Links are printed as text and are not clickable in this version.',
    );
  });
});

describe('phase53 criterion 9: .txt bytes that are Markdown', () => {
  it('routes a .txt file whose bytes are Markdown to the markdown adapter', async () => {
    const path = await mkFile('mislabelled.txt', '# Heading\n\n- one\n- two\n\n> quote\n');
    const registry = createDefaultRegistry();
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('markdown');
    expect(resolved?.byExtension).toBe(false);
  });

  it('routes a plain .txt file to the text adapter', async () => {
    const path = await mkFile('plain.txt', 'hello world\nsecond line\n');
    const registry = createDefaultRegistry();
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('text');
    expect(resolved?.byExtension).toBe(true);
  });
});
