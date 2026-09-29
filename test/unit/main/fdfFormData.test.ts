import { describe, expect, it } from 'vitest';
import {
  exportFormFdf,
  exportFormXfdf,
  parseFormFdf,
  parseFormXfdf,
  type FormValueEntry,
} from '../../../src/main/services/fdf';

/**
 * Phase 57 feature B (part 1) - the pure form-VALUE FDF / XFDF codec. No
 * Electron, engine or IPC here; part 2 wires the engine. The hostile set
 * exercises every PDF-string and XML-entity hazard plus non-ASCII text.
 */

const HOSTILE: FormValueEntry[] = [
  { name: 'plain', value: 'simple' },
  { name: 'paren(name)', value: 'value with ) and (' },
  { name: 'back\\slash', value: 'a\\b' },
  { name: 'amp&lt<gt>', value: '&<>' },
  { name: 'quote"apos\'', value: 'he said "hi" & \'bye\'' },
  { name: 'unicode-é-Ω', value: 'café Ω 中文' },
  { name: '', value: '' },
];

describe('phase57-B form FDF codec', () => {
  it('round-trips hostile names and values unchanged and in order', () => {
    const bytes = exportFormFdf(HOSTILE);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%FDF-1.2')).toBe(true);
    expect(text).toContain('/Fields');
    expect(parseFormFdf(bytes)).toEqual(HOSTILE);
  });

  it('a value containing a ) does not break the parse', () => {
    const values: FormValueEntry[] = [{ name: 'n', value: 'a)b(c\\d' }];
    expect(parseFormFdf(exportFormFdf(values))).toEqual(values);
  });

  it('throws naming the %FDF header for a non-FDF buffer', () => {
    const notFdf = new TextEncoder().encode('%PDF-1.7 not fdf');
    expect(() => parseFormFdf(notFdf)).toThrow(/%FDF/);
  });

  it('returns [] for a malformed /Fields array without throwing', () => {
    const malformed = new TextEncoder().encode(
      '%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [ << /T (a) /V (b) >>\n%%EOF',
    );
    expect(parseFormFdf(malformed)).toEqual([]);
  });

  it('returns [] when /Fields is absent', () => {
    const noFields = new TextEncoder().encode('%FDF-1.2\ntrailer\n%%EOF');
    expect(parseFormFdf(noFields)).toEqual([]);
  });

  it('tolerates extra keys and unknown key order', () => {
    const src = '%FDF-1.2\n<< /FDF << /Fields [ << /Ff 0 /V (v1) /T (a) /DV (x) >> ] >> >>\n%%EOF';
    expect(parseFormFdf(new TextEncoder().encode(src))).toEqual([
      { name: 'a', value: 'v1' },
    ]);
  });

  it('throws above the 10,000-entry ceiling on export', () => {
    const many: FormValueEntry[] = [];
    for (let i = 0; i < 10_001; i += 1) many.push({ name: `f${i}`, value: 'v' });
    expect(() => exportFormFdf(many)).toThrow(/entry ceiling/);
  });

  it('throws above the 8 MiB ceiling on parse', () => {
    expect(() => parseFormFdf(new Uint8Array(8 * 1024 * 1024 + 1))).toThrow(/ceiling/);
  });

  it('throws above the entry ceiling on parse', () => {
    const lines = ['%FDF-1.2', '<< /FDF << /Fields ['];
    for (let i = 0; i < 10_001; i += 1) lines.push(`<< /T (f${i}) /V (v) >>`);
    lines.push('] >> >>', '%%EOF');
    expect(() => parseFormFdf(new TextEncoder().encode(lines.join('\n')))).toThrow(/entry ceiling/);
  });
});

describe('phase57-B form XFDF codec', () => {
  it('round-trips hostile names and values unchanged and in order', () => {
    const xml = exportFormXfdf(HOSTILE);
    expect(xml).toContain('http://ns.adobe.com/xfdf/');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(parseFormXfdf(xml)).toEqual(HOSTILE);
    expect(parseFormXfdf(exportFormXfdf(HOSTILE))).toEqual(HOSTILE);
  });

  it('throws for a non-XFDF string', () => {
    expect(() => parseFormXfdf('hello world')).toThrow(/xfdf/i);
    expect(() => parseFormXfdf('<?xml version="1.0"?><foo/>')).toThrow(/xfdf/i);
  });

  it('parses a field with no <value> to an empty string', () => {
    const xml =
      '<xfdf xmlns="http://ns.adobe.com/xfdf/"><fields>' +
      '<field name="a"/>' +
      '<field name="b"></field>' +
      '</fields></xfdf>';
    expect(parseFormXfdf(xml)).toEqual([
      { name: 'a', value: '' },
      { name: 'b', value: '' },
    ]);
  });

  it('decodes XML entities and tolerates attribute order', () => {
    const xml =
      '<xfdf xmlns="http://ns.adobe.com/xfdf/"><fields>' +
      '<field type="text" name="a&amp;b"><value>x &lt; y &amp; z &#233;</value></field>' +
      '</fields></xfdf>';
    expect(parseFormXfdf(xml)).toEqual([{ name: 'a&b', value: 'x < y & z é' }]);
  });

  it('throws above the entry ceiling on parse', () => {
    const parts = ['<xfdf xmlns="http://ns.adobe.com/xfdf/"><fields>'];
    for (let i = 0; i < 10_001; i += 1) parts.push(`<field name="f${i}"><value>v</value></field>`);
    parts.push('</fields></xfdf>');
    expect(() => parseFormXfdf(parts.join('\n'))).toThrow(/entry ceiling/);
  });
});

describe('phase57-B cross-format agreement', () => {
  it('the same entries exported to FDF and XFDF both parse back', () => {
    const values: FormValueEntry[] = [
      { name: 'Name', value: 'Ada Lovelace' },
      { name: 'note(last)', value: 'a \\) tricky (value) \u00e9' },
      { name: 'paths', value: 'C:\\tmp\\file (1).pdf' },
    ];
    expect(parseFormFdf(exportFormFdf(values))).toEqual(values);
    expect(parseFormXfdf(exportFormXfdf(values))).toEqual(values);
  });
});
