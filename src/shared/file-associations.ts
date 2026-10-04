/**
 * Phase 97 - the PDF-family association registry: the ONE typed source of
 * truth shared by the main process (OS open routing) and the renderer
 * (type-naming in-app message).
 *
 * `.pdf` is deliberately NOT in this list. It is renderable and keeps its own
 * validated open path. Every type here is REGISTRATION-ONLY: Jovrel registers
 * as a selectable Windows default-app candidate for it, launches, and shows an
 * in-app message naming the type instead of rendering it.
 */

export interface PdfFamilyType {
  readonly ext: string;
  readonly label: string;
  readonly renderable: boolean;
}

export const PDF_FAMILY_TYPES: readonly PdfFamilyType[] = [
  { ext: ".aaui", label: "Acrobat User Interface", renderable: false },
  { ext: ".bpdx", label: "Acrobat Batch PDX", renderable: false },
  { ext: ".fdf", label: "Acrobat Forms Document", renderable: false },
  { ext: ".pdx", label: "Acrobat Catalog Index", renderable: false },
  { ext: ".rmf", label: "Acrobat Rights Management Document", renderable: false },
  { ext: ".sequ", label: "Acrobat Action File", renderable: false },
  { ext: ".xdp", label: "Acrobat XML Data Package", renderable: false },
  { ext: ".xfdf", label: "Acrobat Forms Document", renderable: false },
];

/** The URL protocol Jovrel registers as a Windows default-app candidate. */
export const ACROBAT_PROTOCOL_SCHEME = "acrobat";

const ACROBAT_PROTOCOL_LABEL = "acrobat URL protocol";

const ACROBAT_PROTOCOL_PATTERN = /^acrobat:/i;

export type PdfFamilyTarget =
  | PdfFamilyType
  | { readonly scheme: "acrobat"; readonly label: string };

/** Extension of the last path segment, lower-cased, or "" when there is none. */
function extensionOf(value: string): string {
  const trimmed = value.trim();
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

/**
 * Resolve a value to its registered target: a family extension first
 * (case-insensitive), then the `acrobat:` URL protocol. `null` for anything
 * else, including `.pdf`, which is renderable and handled separately.
 */
export function pdfFamilyTargetFor(value: string): PdfFamilyTarget | null {
  const ext = extensionOf(value);
  if (ext.length > 1) {
    const match = PDF_FAMILY_TYPES.find((type) => type.ext === ext);
    if (match !== undefined) return match;
  }
  if (ACROBAT_PROTOCOL_PATTERN.test(value.trim())) {
    return { scheme: ACROBAT_PROTOCOL_SCHEME, label: ACROBAT_PROTOCOL_LABEL };
  }
  return null;
}

/** True for one of the eight family extensions or an `acrobat:` URL target. */
export function isPdfFamilyTarget(value: string): boolean {
  return pdfFamilyTargetFor(value) !== null;
}
