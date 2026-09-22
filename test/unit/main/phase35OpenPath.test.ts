import { describe, it, expect } from 'vitest';
import { extractFileArgument, looksLikePdfPath } from '../../../src/main/open-path';

// Phase 35 — the OS hands TFlex a PDF path through argv (launch) and through
// the `second-instance` payload (a second launch while TFlex is running).
// Both carry the same shape, so both are parsed by `extractFileArgument`.
// These are the pure parsing rules; readability/PDF sniffing is validated
// separately by the caller (handleOsOpenPath -> loadPdfFile).

const EXE = 'C:\\Program Files\\TFlex\\TFlex.exe';
const ELECTRON = 'C:\\dev\\node_modules\\electron\\dist\\electron.exe';
const PDF = 'C:\\Users\\me\\Documents\\report.pdf';

describe('Phase 35 — extractFileArgument (launch argv)', () => {
  it('packaged launch: returns the PDF path after the exe', () => {
    expect(extractFileArgument([EXE, PDF], true)).toBe(PDF);
  });

  it('dev launch: skips the electron exe and the app directory', () => {
    expect(extractFileArgument([ELECTRON, '.', PDF], false)).toBe(PDF);
  });

  it('packaged launch with no file argument returns null', () => {
    expect(extractFileArgument([EXE], true)).toBeNull();
  });

  it('dev launch with no file argument returns null', () => {
    expect(extractFileArgument([ELECTRON, '.'], false)).toBeNull();
  });

  it('skips Electron/Chromium switches before the path', () => {
    expect(extractFileArgument([EXE, '--inspect', '--foo=bar', PDF], true)).toBe(PDF);
  });

  it('returns null when the launch carries only switches', () => {
    expect(extractFileArgument([EXE, '--inspect', '--foo=bar'], true)).toBeNull();
  });

  it('never mistakes the executable or app directory for a document', () => {
    expect(extractFileArgument([EXE], true)).toBeNull();
    expect(extractFileArgument([ELECTRON, '.'], false)).toBeNull();
  });

  it('ignores empty argument slots', () => {
    expect(extractFileArgument([EXE, '', PDF], true)).toBe(PDF);
  });

  it('returns an empty argv as null', () => {
    expect(extractFileArgument([], true)).toBeNull();
    expect(extractFileArgument([], false)).toBeNull();
  });
});

describe('Phase 35 — extractFileArgument (second-instance payload)', () => {
  it('parses a packaged second-instance argv identically to a launch', () => {
    expect(extractFileArgument([EXE, PDF], true)).toBe(PDF);
  });

  it('returns null for a second instance with no document', () => {
    expect(extractFileArgument([EXE], true)).toBeNull();
  });

  it('parses a non-PDF path (the caller then fails loud)', () => {
    const txt = 'C:\\Users\\me\\Documents\\notes.txt';
    expect(extractFileArgument([EXE, txt], true)).toBe(txt);
    expect(looksLikePdfPath(txt)).toBe(false);
  });

  it('parses a missing PDF path (existence is the caller’s check)', () => {
    const missing = 'C:\\Users\\me\\Documents\\gone.pdf';
    expect(extractFileArgument([EXE, missing], true)).toBe(missing);
    expect(looksLikePdfPath(missing)).toBe(true);
  });
});

describe('Phase 35 — looksLikePdfPath', () => {
  it('accepts the .pdf extension case-insensitively', () => {
    expect(looksLikePdfPath('a.pdf')).toBe(true);
    expect(looksLikePdfPath('A.PDF')).toBe(true);
    expect(looksLikePdfPath('C:\\docs\\Report.Pdf')).toBe(true);
  });

  it('rejects non-PDF paths and paths that merely mention pdf', () => {
    expect(looksLikePdfPath('a.txt')).toBe(false);
    expect(looksLikePdfPath('pdf')).toBe(false);
    expect(looksLikePdfPath('a.pdf.exe')).toBe(false);
  });
});
