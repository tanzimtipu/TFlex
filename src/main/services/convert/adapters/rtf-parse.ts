import iconv from 'iconv-lite';

/**
 * Phase 53 feature F - the pure RTF reader for the documented subset.
 *
 * No I/O and no pdf-lib: it turns an RTF string into paragraphs of styled text
 * runs plus the colour table. The adapter owns the PDF mapping.
 *
 * The subset, exactly as Phase 53 feature F lists it: `\b` `\i` `\ul` `\strike`,
 * `\fs` (half-points), foreground colour through `\colortbl` + `\cf`, alignment
 * (`\ql` `\qc` `\qr` `\qj`), indents (`\li` `\ri` `\fi`), `\par`, `\page`, the
 * escapes `\\` `\{` `\}`, hex escapes `\'hh` and `\uN` unicode.
 *
 * Group state nests and restores (a `{` snapshots the whole state, a `}` pops
 * it). Destinations that are not document text (`\fonttbl`, `\stylesheet`,
 * `\pict`, `\info`, list/theme tables, `\*` ignorable destinations) are skipped
 * whole. Every other control word is counted in `ignoredControlWords` so the
 * adapter can report honest degradation instead of silently dropping it.
 */

export type RtfAlignment = 'left' | 'center' | 'right' | 'justify';

export interface RtfRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Colour-table index; 0 is auto/black. */
  colorIndex: number;
  /** Font size in points when `\fs` was seen, else null (adapter default). */
  sizePt: number | null;
}

export interface RtfParagraph {
  runs: RtfRun[];
  alignment: RtfAlignment;
  /** Indents in twips (1/20 pt), as RTF stores them. */
  indentLeftTwips: number;
  indentRightTwips: number;
  indentFirstTwips: number;
  pageBreakBefore: boolean;
}

export interface RtfParseResult {
  paragraphs: RtfParagraph[];
  /** Colour table; index 0 is the implicit auto/black entry. */
  colors: Array<[number, number, number]>;
  ignoredControlWords: number;
}

interface State {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  colorIndex: number;
  sizePt: number | null;
  alignment: RtfAlignment;
  indentLeft: number;
  indentRight: number;
  indentFirst: number;
  uc: number;
  inColorTable: boolean;
}

function initialState(): State {
  return {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    colorIndex: 0,
    sizePt: null,
    alignment: 'left',
    indentLeft: 0,
    indentRight: 0,
    indentFirst: 0,
    uc: 1,
    inColorTable: false,
  };
}

/** Destination groups whose contents are never document text. */
const SKIP_DESTINATIONS = new Set<string>([
  'fonttbl',
  'stylesheet',
  'info',
  'pict',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'filetbl',
  'revtbl',
  'objdata',
  'object',
  'field',
  'fldinst',
  'fldrslt',
  'pntext',
  'pntxta',
  'pntxtb',
]);

/** Common structural control words that are no-ops here and not counted as
 *  ignored formatting. */
const STRUCTURAL_CONTROLS = new Set<string>([
  'rtf',
  'ansi',
  'mac',
  'pc',
  'pca',
  'ansicpg',
  'deff',
  'deflang',
  'deflangfe',
  's',
  'cs',
  'lang',
  'langfe',
  'langnp',
  'loch',
  'hich',
  'dbch',
  'afn',
  'aftn',
  'f',
  'fcharset',
  'fprq',
  'fbidi',
  'ftnalt',
  'nestcell',
  'nestrow',
  'nesttableprops',
  'nonesttables',
  'viewkind',
  'viewscale',
  'fet',
  'formshade',
  'horzdoc',
  'vertdoc',
  'jexpand',
  'kerning',
  'nolnhtadjtbl',
  'nooverflow',
  'paperw',
  'paperh',
  'widowctrl',
  'ftnbj',
  'aenddoc',
  'aendnotes',
  'afracwidth',
  'afsize',
  'alntblind',
  'trautofit',
  'pgwsxn',
  'pghsxn',
  'marglsxn',
  'margrsxn',
  'margtsxn',
  'margbsxn',
]);

export function parseRtf(source: string): RtfParseResult {
  const paragraphs: RtfParagraph[] = [];
  const colors: Array<[number, number, number]> = [[0, 0, 0]];
  let ignoredControlWords = 0;

  let state: State = initialState();
  const stack: State[] = [];

  let runs: RtfRun[] = [];
  let paraDirty = false;
  let pendingPageBreak = false;
  let pendingFallback = 0;
  let groupDepth = 0;
  let skipDepth = -1;
  let ignorableNext = false;
  let colorR: number | null = null;
  let colorG: number | null = null;
  let colorB: number | null = null;

  const sameFlags = (run: RtfRun): boolean =>
    run.bold === state.bold &&
    run.italic === state.italic &&
    run.underline === state.underline &&
    run.strike === state.strike &&
    run.colorIndex === state.colorIndex &&
    run.sizePt === state.sizePt;

  const appendText = (text: string): void => {
    if (text.length === 0) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && sameFlags(last)) {
      last.text += text;
    } else {
      runs.push({
        text,
        bold: state.bold,
        italic: state.italic,
        underline: state.underline,
        strike: state.strike,
        colorIndex: state.colorIndex,
        sizePt: state.sizePt,
      });
    }
    paraDirty = true;
  };

  const emitChar = (ch: string): void => {
    if (pendingFallback > 0) {
      pendingFallback -= 1;
      return;
    }
    appendText(ch);
  };

  const endParagraph = (): void => {
    if (!paraDirty && runs.length === 0) return;
    paragraphs.push({
      runs,
      alignment: state.alignment,
      indentLeftTwips: state.indentLeft,
      indentRightTwips: state.indentRight,
      indentFirstTwips: state.indentFirst,
      pageBreakBefore: pendingPageBreak,
    });
    pendingPageBreak = false;
    runs = [];
    paraDirty = false;
  };

  const enterSkip = (): void => {
    skipDepth = groupDepth;
    ignorableNext = false;
  };

  const pushColor = (): void => {
    if (colorR === null && colorG === null && colorB === null) return;
    colors.push([colorR ?? 0, colorG ?? 0, colorB ?? 0]);
    colorR = null;
    colorG = null;
    colorB = null;
  };

  const emitHex = (code: number): void => {
    const decoded =
      code < 0x80
        ? String.fromCharCode(code)
        : iconv.decode(Buffer.from([code]), 'windows-1252');
    emitChar(decoded);
  };

  const handleControl = (word: string, param: number | null): void => {
    const on = (value: number | null): boolean => value !== 0;
    switch (word) {
      case 'b':
        state.bold = on(param);
        return;
      case 'i':
        state.italic = on(param);
        return;
      case 'ul':
        state.underline = on(param);
        return;
      case 'ulnone':
        state.underline = false;
        return;
      case 'strike':
        state.strike = on(param);
        return;
      case 'plain':
        state.bold = false;
        state.italic = false;
        state.underline = false;
        state.strike = false;
        state.colorIndex = 0;
        return;
      case 'fs':
        if (param !== null && param > 0) state.sizePt = param / 2;
        return;
      case 'cf':
        state.colorIndex = param ?? 0;
        return;
      case 'par':
        endParagraph();
        return;
      case 'page':
        endParagraph();
        pendingPageBreak = true;
        return;
      case 'ql':
        state.alignment = 'left';
        return;
      case 'qc':
        state.alignment = 'center';
        return;
      case 'qr':
        state.alignment = 'right';
        return;
      case 'qj':
        state.alignment = 'justify';
        return;
      case 'li':
        state.indentLeft = param ?? 0;
        return;
      case 'ri':
        state.indentRight = param ?? 0;
        return;
      case 'fi':
        state.indentFirst = param ?? 0;
        return;
      case 'pard':
        state.alignment = 'left';
        state.indentLeft = 0;
        state.indentRight = 0;
        state.indentFirst = 0;
        return;
      case 'uc':
        state.uc = param ?? 1;
        return;
      case 'u': {
        const code = param === null ? 0 : param < 0 ? param + 65536 : param;
        appendText(String.fromCharCode(code));
        pendingFallback = state.uc;
        return;
      }
      case 'colortbl':
        state.inColorTable = true;
        colorR = null;
        colorG = null;
        colorB = null;
        return;
      case 'red':
        if (state.inColorTable && param !== null) colorR = param;
        else ignoredControlWords += 1;
        return;
      case 'green':
        if (state.inColorTable && param !== null) colorG = param;
        else ignoredControlWords += 1;
        return;
      case 'blue':
        if (state.inColorTable && param !== null) colorB = param;
        else ignoredControlWords += 1;
        return;
      default:
        if (SKIP_DESTINATIONS.has(word)) {
          enterSkip();
          return;
        }
        if (STRUCTURAL_CONTROLS.has(word)) return;
        ignoredControlWords += 1;
    }
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    if (ch === '\\') {
      const next = source[i + 1];
      if (next === undefined) {
        i += 1;
        continue;
      }
      if (/[A-Za-z]/.test(next)) {
        let j = i + 1;
        while (j < source.length && /[A-Za-z]/.test(source[j])) j += 1;
        const word = source.slice(i + 1, j);
        let k = j;
        let sign = 1;
        if (source[k] === '-') {
          sign = -1;
          k += 1;
        }
        let digits = '';
        while (k < source.length && /[0-9]/.test(source[k])) {
          digits += source[k];
          k += 1;
        }
        const param = digits.length > 0 ? sign * Number(digits) : null;
        i = source[k] === ' ' ? k + 1 : k;
        if (skipDepth >= 0) continue;
        if (ignorableNext) {
          ignorableNext = false;
          enterSkip();
          continue;
        }
        handleControl(word, param);
        continue;
      }
      if (next === "'") {
        const hex = source.slice(i + 2, i + 4);
        i += 4;
        if (skipDepth >= 0) continue;
        const code = parseInt(hex, 16);
        if (!Number.isNaN(code)) emitHex(code);
        continue;
      }
      i += 2;
      if (skipDepth >= 0) continue;
      switch (next) {
        case '\\':
        case '{':
        case '}':
          emitChar(next);
          break;
        case '~':
          emitChar('\u00a0');
          break;
        case '-':
        case '_':
          break;
        case '*':
          ignorableNext = true;
          break;
        default:
          ignoredControlWords += 1;
      }
      continue;
    }

    if (ch === '{') {
      groupDepth += 1;
      stack.push({ ...state });
      i += 1;
      continue;
    }
    if (ch === '}') {
      groupDepth -= 1;
      const previous = stack.pop();
      if (previous !== undefined) state = previous;
      if (skipDepth >= 0 && groupDepth < skipDepth) skipDepth = -1;
      i += 1;
      continue;
    }
    if (skipDepth >= 0) {
      i += 1;
      continue;
    }
    if (state.inColorTable) {
      if (ch === ';') pushColor();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (source[i + 1] === '\n') i += 1;
      i += 1;
      continue;
    }
    if (ch === '\n') {
      i += 1;
      continue;
    }
    emitChar(ch);
    i += 1;
  }

  endParagraph();
  return { paragraphs, colors, ignoredControlWords };
}
