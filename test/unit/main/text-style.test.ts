import { describe, expect, it } from 'vitest';
import {
  BUNDLED_EDIT_FONTS,
  EDIT_FONTS,
  STANDARD_EDIT_FONTS,
  isBundledEditFont,
  isEditFont,
  validateTextBoxStylePatch,
  validateTextStyleFields,
} from '../../../src/main/services/text-style';

// ---------------------------------------------------------------------------
// Phase 21 — validation matrix for the text style fields and the full
// `updateTextBox` patch. Contract: an ABSENT field is accepted (default
// applied at draw time); a PRESENT-but-invalid field rejects the payload.
// ---------------------------------------------------------------------------

describe('Phase 21: validateTextStyleFields', () => {
  it('accepts an object with no style fields (all absent -> defaults)', () => {
    const r = validateTextStyleFields({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it('accepts every valid field', () => {
    const r = validateTextStyleFields({
      align: 'justify',
      lineHeight: 1.5,
      bold: true,
      italic: false,
      underline: true,
      baselineShift: -3,
      highlight: { r: 1, g: 0.5, b: 0 },
      list: 'number',
      indent: 18,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        align: 'justify',
        lineHeight: 1.5,
        bold: true,
        italic: false,
        underline: true,
        baselineShift: -3,
        highlight: { r: 1, g: 0.5, b: 0 },
        list: 'number',
        indent: 18,
      });
    }
  });

  it('rejects an unsupported align', () => {
    expect(validateTextStyleFields({ align: 'middle' }).ok).toBe(false);
    expect(validateTextStyleFields({ align: 3 }).ok).toBe(false);
  });

  it('rejects out-of-range / non-finite lineHeight', () => {
    expect(validateTextStyleFields({ lineHeight: 0 }).ok).toBe(false);
    expect(validateTextStyleFields({ lineHeight: 99 }).ok).toBe(false);
    expect(validateTextStyleFields({ lineHeight: Number.NaN }).ok).toBe(false);
    expect(validateTextStyleFields({ lineHeight: '1.5' }).ok).toBe(false);
  });

  it('accepts the lineHeight bounds exactly', () => {
    expect(validateTextStyleFields({ lineHeight: 0.5 }).ok).toBe(true);
    expect(validateTextStyleFields({ lineHeight: 5 }).ok).toBe(true);
  });

  it('rejects non-boolean bold/italic/underline', () => {
    expect(validateTextStyleFields({ bold: 'yes' }).ok).toBe(false);
    expect(validateTextStyleFields({ italic: 1 }).ok).toBe(false);
    expect(validateTextStyleFields({ underline: null }).ok).toBe(false);
  });

  it('rejects out-of-range baselineShift', () => {
    expect(validateTextStyleFields({ baselineShift: 1e9 }).ok).toBe(false);
    expect(validateTextStyleFields({ baselineShift: -1e9 }).ok).toBe(false);
    expect(validateTextStyleFields({ baselineShift: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it('rejects a highlight with components outside 0..1', () => {
    expect(validateTextStyleFields({ highlight: { r: 2, g: 0, b: 0 } }).ok).toBe(false);
    expect(validateTextStyleFields({ highlight: { r: -1, g: 0, b: 0 } }).ok).toBe(false);
    expect(validateTextStyleFields({ highlight: { r: 0, g: 0 } }).ok).toBe(false);
    expect(validateTextStyleFields({ highlight: 'red' }).ok).toBe(false);
  });

  it('rejects an unsupported list style', () => {
    expect(validateTextStyleFields({ list: 'roman' }).ok).toBe(false);
    expect(validateTextStyleFields({ list: 1 }).ok).toBe(false);
  });

  it('accepts a valid indent and its exact bounds (0 and 200)', () => {
    const r = validateTextStyleFields({ indent: 24 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.indent).toBe(24);
    expect(validateTextStyleFields({ indent: 0 }).ok).toBe(true);
    expect(validateTextStyleFields({ indent: 200 }).ok).toBe(true);
  });

  it('ignores an absent indent (no key in the validated subset)', () => {
    const r = validateTextStyleFields({ bold: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('indent' in r.value).toBe(false);
      expect(r.value.indent).toBeUndefined();
    }
  });

  it('rejects an out-of-range / non-finite indent, naming the bounds', () => {
    expect(validateTextStyleFields({ indent: -1 }).ok).toBe(false);
    expect(validateTextStyleFields({ indent: 201 }).ok).toBe(false);
    expect(validateTextStyleFields({ indent: Number.NaN }).ok).toBe(false);
    expect(validateTextStyleFields({ indent: Number.POSITIVE_INFINITY }).ok).toBe(false);
    expect(validateTextStyleFields({ indent: '10' }).ok).toBe(false);
    const r = validateTextStyleFields({ indent: 1e9 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('indent must be a finite number in 0..200');
  });

  it('rejects a non-object payload', () => {
    expect(validateTextStyleFields(null).ok).toBe(false);
    expect(validateTextStyleFields('x').ok).toBe(false);
  });
});

describe('Phase 21: validateTextBoxStylePatch', () => {
  it('accepts a full valid patch', () => {
    const r = validateTextBoxStylePatch({
      text: 'hello',
      font: 'Times',
      size: 18,
      color: { r: 0.1, g: 0.2, b: 0.3 },
      background: 'white',
      align: 'right',
      lineHeight: 2,
      bold: true,
      italic: true,
      underline: true,
      baselineShift: 4,
      highlight: { r: 1, g: 1, b: 0 },
      list: 'bullet',
      indent: 12,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.indent).toBe(12);
  });

  it('accepts an empty patch (all fields absent -> preserve)', () => {
    const r = validateTextBoxStylePatch({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it('rejects a font outside the EditFont allowlist, naming the limitation', () => {
    const r = validateTextBoxStylePatch({ font: 'Arial' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('supported families');
  });

  it('rejects an out-of-range / non-finite size', () => {
    expect(validateTextBoxStylePatch({ size: 0 }).ok).toBe(false);
    expect(validateTextBoxStylePatch({ size: 5000 }).ok).toBe(false);
    expect(validateTextBoxStylePatch({ size: Number.NaN }).ok).toBe(false);
  });

  it('rejects an invalid text / color / background', () => {
    expect(validateTextBoxStylePatch({ text: 123 }).ok).toBe(false);
    expect(validateTextBoxStylePatch({ color: { r: 2, g: 0, b: 0 } }).ok).toBe(false);
    expect(validateTextBoxStylePatch({ background: 'blue' }).ok).toBe(false);
  });

  it('propagates a style-field rejection from the shared validator', () => {
    expect(validateTextBoxStylePatch({ align: 'middle' }).ok).toBe(false);
    expect(validateTextBoxStylePatch({ lineHeight: 0 }).ok).toBe(false);
  });

  it('accepts highlight: null as an explicit removal and carries it through', () => {
    const r = validateTextBoxStylePatch({ highlight: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('highlight' in r.value).toBe(true);
      expect(r.value.highlight).toBeNull();
    }
  });

  it('still rejects a malformed highlight colour on the patch', () => {
    expect(validateTextBoxStylePatch({ highlight: { r: 2, g: 0, b: 0 } }).ok).toBe(false);
    expect(validateTextBoxStylePatch({ highlight: 'red' }).ok).toBe(false);
    expect(validateTextBoxStylePatch({ highlight: { r: 0, g: 0 } }).ok).toBe(false);
  });

  it('keeps a white {1,1,1} highlight a legitimate (visible) colour, not a removal', () => {
    const r = validateTextBoxStylePatch({ highlight: { r: 1, g: 1, b: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.highlight).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('an ABSENT highlight preserves (no highlight key in the validated patch)', () => {
    const r = validateTextBoxStylePatch({ bold: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('highlight' in r.value).toBe(false);
      expect(r.value.highlight).toBeUndefined();
    }
  });

  it('the payload validator still rejects highlight: null (removal is patch-only)', () => {
    expect(validateTextStyleFields({ highlight: null }).ok).toBe(false);
    expect(validateTextStyleFields({ highlight: null, bold: true }).ok).toBe(false);
  });

  // DEF-242 — an all-unknown key set is a caller error; keys supplied with an
  // `undefined` value do not count as supplied.
  it('rejects an all-unknown-key patch, naming every unknown key', () => {
    const one = validateTextBoxStylePatch({ evil: 1 });
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.reason).toContain('"evil"');

    const two = validateTextBoxStylePatch({ evil: 1, another: 'x' });
    expect(two.ok).toBe(false);
    if (!two.ok) {
      expect(two.reason).toContain('"evil"');
      expect(two.reason).toContain('"another"');
    }
  });

  it('treats keys supplied with an undefined value as absent (empty patch)', () => {
    const r = validateTextBoxStylePatch({ bold: undefined, evil: undefined });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it('ignores unknown keys mixed with at least one known key', () => {
    const r = validateTextBoxStylePatch({ bold: true, evil: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ bold: true });
      expect('evil' in r.value).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 27 — character spacing (tracking, the `Tc` operator). Contract:
// finite and bounded to -5..20 pt; absent = 0 (no extra tracking); a
// present-but-invalid value rejects the payload (preserve-if-valid /
// reject-if-invalid, same shape as every other style field).
// ---------------------------------------------------------------------------

describe('Phase 27: charSpacing validation', () => {
  it('accepts a valid charSpacing and carries it', () => {
    const r = validateTextStyleFields({ charSpacing: 2.5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.charSpacing).toBe(2.5);
  });

  it('accepts the exact bounds (-5 and 20)', () => {
    expect(validateTextStyleFields({ charSpacing: -5 }).ok).toBe(true);
    expect(validateTextStyleFields({ charSpacing: 20 }).ok).toBe(true);
    const r = validateTextStyleFields({ charSpacing: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.charSpacing).toBe(0);
  });

  it('rejects out-of-range / non-finite / non-number, naming the bounds', () => {
    expect(validateTextStyleFields({ charSpacing: -5.01 }).ok).toBe(false);
    expect(validateTextStyleFields({ charSpacing: 20.01 }).ok).toBe(false);
    expect(validateTextStyleFields({ charSpacing: Number.NaN }).ok).toBe(false);
    expect(validateTextStyleFields({ charSpacing: Number.POSITIVE_INFINITY }).ok).toBe(false);
    expect(validateTextStyleFields({ charSpacing: '3' }).ok).toBe(false);
    const r = validateTextStyleFields({ charSpacing: 1e9 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('charSpacing must be a finite number in -5..20');
  });

  it('ignores an absent charSpacing (no key in the validated subset)', () => {
    const r = validateTextStyleFields({ bold: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('charSpacing' in r.value).toBe(false);
      expect(r.value.charSpacing).toBeUndefined();
    }
  });

  it('the patch validator treats charSpacing as a known, mergeable key', () => {
    const r = validateTextBoxStylePatch({ charSpacing: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.charSpacing).toBe(3);
  });

  it('a charSpacing-only patch is not an all-unknown caller error', () => {
    const r = validateTextBoxStylePatch({ charSpacing: 4 });
    expect(r.ok).toBe(true);
  });

  it('rejects a malformed charSpacing on the patch path too', () => {
    expect(validateTextBoxStylePatch({ charSpacing: 21 }).ok).toBe(false);
    expect(validateTextBoxStylePatch({ charSpacing: -6 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 27 — the EditFont allowlist grows with the bundled OFL families.
// Contract: every bundled id validates; an unknown id rejects with a reason
// naming the font and the supported list (fail loud, never a silent
// substitution).
// ---------------------------------------------------------------------------

describe('Phase 27: EditFont allowlist', () => {
  it('keeps the three standard families and adds the bundled ones', () => {
    expect(EDIT_FONTS).toContain('Helvetica');
    expect(EDIT_FONTS).toContain('Times');
    expect(EDIT_FONTS).toContain('Courier');
    expect(EDIT_FONTS).toContain('Liberation Sans');
    expect(EDIT_FONTS).toContain('DejaVu Serif');
    expect(EDIT_FONTS).toContain('DejaVu Sans Mono');
    expect(EDIT_FONTS).toHaveLength(6);
  });

  it('accepts every bundled family id on the text-box patch path', () => {
    for (const font of BUNDLED_EDIT_FONTS) {
      const r = validateTextBoxStylePatch({ font });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.font).toBe(font);
    }
  });

  it('keeps the three standard families valid', () => {
    for (const font of STANDARD_EDIT_FONTS) {
      const r = validateTextBoxStylePatch({ font });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.font).toBe(font);
    }
  });

  it('rejects an unknown family, naming the font and the supported list', () => {
    const r = validateTextBoxStylePatch({ font: 'Arial' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('"Arial"');
      expect(r.reason).toContain('Liberation Sans');
    }
  });

  it('rejects a non-string font and a near-miss id', () => {
    expect(validateTextBoxStylePatch({ font: 3 }).ok).toBe(false);
    expect(validateTextBoxStylePatch({ font: 'liberation sans' }).ok).toBe(false);
    expect(validateTextBoxStylePatch({ font: 'LiberationSans' }).ok).toBe(false);
  });

  it('isEditFont / isBundledEditFont agree with the allowlist', () => {
    expect(isEditFont('Helvetica')).toBe(true);
    expect(isEditFont('DejaVu Serif')).toBe(true);
    expect(isEditFont('Arial')).toBe(false);
    expect(isEditFont(undefined)).toBe(false);
    expect(isBundledEditFont('DejaVu Serif')).toBe(true);
    expect(isBundledEditFont('Helvetica')).toBe(false);
    expect(isBundledEditFont('Arial')).toBe(false);
  });
});
