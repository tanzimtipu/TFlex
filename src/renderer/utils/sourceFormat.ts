// Phase 106 (chunk A) — source-format truth for the Home surfaces.
//
// A recent or sample entry must show the format it ACTUALLY is, derived from
// the real path extension, never a blanket "PDF" label (live-app refinement).
// A converted PDF output is a separate concern and is not described here.
//
// Pure: no React, no electron, no DOM — the mapping is unit-testable in
// isolation.

/** The coarse family used to pick an honest per-file-type illustration. */
export type SourceFormatKind =
  | "pdf"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "text"
  | "other";

export interface SourceFormat {
  /** Uppercase display label derived from the extension, e.g. "PDF", "XLSX". */
  label: string;
  /** Coarse family for a purposeful fallback illustration. */
  kind: SourceFormatKind;
}

/** Known extensions mapped to their family. Unknown extensions stay "other"
 *  but keep their real uppercased label (truth over tidiness). */
const KIND_BY_EXT: Readonly<Record<string, SourceFormatKind>> = {
  pdf: "pdf",
  doc: "document",
  docx: "document",
  odt: "document",
  rtf: "document",
  pages: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  xlsb: "spreadsheet",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  ods: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  odp: "presentation",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  svg: "image",
  heic: "image",
  avif: "image",
  txt: "text",
  md: "text",
  markdown: "text",
  json: "text",
  xml: "text",
  html: "text",
  htm: "text",
  log: "text",
};

/** The basename of an absolute or display-relative path. */
function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return cut < 0 ? trimmed : trimmed.slice(cut + 1);
}

/** The lowercased extension without the dot, or "" when there is none. A
 *  leading dot (a dotfile) is not treated as an extension. */
export function pathExtension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** The truthful source format for a path. A missing extension reads as the
 *  generic "File" rather than inventing a format. */
export function sourceFormat(path: string): SourceFormat {
  const ext = pathExtension(path);
  if (ext === "") return { label: "File", kind: "other" };
  return { label: ext.toUpperCase(), kind: KIND_BY_EXT[ext] ?? "other" };
}

/** The uppercase display label only. */
export function sourceFormatLabel(path: string): string {
  return sourceFormat(path).label;
}

/** The coarse family only. */
export function sourceFormatKind(path: string): SourceFormatKind {
  return sourceFormat(path).kind;
}