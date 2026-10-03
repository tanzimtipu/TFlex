# TFL-487 / DEF-513 (ADV-180) verification evidence

## Change
`engine.addBates` encodability pre-check now judges the font that will actually
be embedded instead of hardcoding WinAnsi.

- `src/main/services/engine.ts`
  - import `isBundledEditFont` from `./text-style` (`engine.ts:134-141`).
  - resolve `fontFamily = settings.font ?? DEFAULT_SETTINGS.editDefaultFont ?? 'Helvetica'`,
    validate with `isEditFont`, then branch (`engine.ts:4362-4399`):
    StandardFont keeps `undrawableStandardFontChars`; a bundled family embeds
    into a throwaway `PDFDocument.create()` and refuses only characters whose
    code point is absent from the font's real `getCharacterSet()` coverage or
    whose single-char `encodeText` lays out as `.notdef` (`<0000>`) / throws.
    The throwaway probe means a refusal never mutates the real document (bytes
    byte-for-byte unchanged, one snapshot untouched, no undo entry).
  - embed the same resolved `fontFamily` on success (`engine.ts:4412`).
  - new helper `bundledFontUnencodableChars` (`engine.ts:5276-5306`).
- `test/unit/main/phase89BatesEngine.test.ts`: +2 SUCCESS cases
  (`font: "DejaVu Serif"`, prefix U+03A9 and U+0101 -> ok, label stamped,
  extraction contains it, exactly one undo entry); the existing `unencodable`
  case (default font, U+6587) is unchanged and still refuses `engine-error`
  with bytes unchanged and no undo entry.

## Command 1 - target unit suite (mutex held)
```
> tflex@1.47.1 test:unit
> vitest run test/unit/main/phase89BatesEngine.test.ts

 RUN  v4.1.11 C:/Users/tanzi/OneDrive/App Development/TFlex

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  17:00:33
   Duration  1.86s (transform 325ms, setup 426ms, import 1.06s, tests 196ms, environment 0ms)
```

## Command 2 - verify (mutex held)
```
> tflex@1.47.1 verify
> node scripts/check-conventions.mjs && npm run typecheck
conventions: clean (338 source file(s) scanned)
> tflex@1.47.1 typecheck
> tsc --noEmit -p tsconfig.json
VERIFY_EXIT=0
```

## Font probe (independent confirmation of the coverage rule)
`@cantoo/pdf-lib` + `@pdf-lib/fontkit`, `assets/fonts/DejaVuSerif.ttf`:
U+0041 true, U+03A9 true, U+0101 true, U+6587 false, U+5B57 false;
`encodeText`: `Ω -> <0001>`, `ā -> <0002>`, `文 -> <0000>`, `A -> <0003>`.

## Doc-maintenance
No changes required: REQUIREMENTS.md Phase 89 item 6 (`:5333`) already states
the chosen-font semantics and the `settings.font ?? editDefaultFont ?? 'Helvetica'`
fallback, which this fix now implements. DEFECTS.md / ADVERSARIAL_REVIEW.md are
owned ledgers outside this role's edit set.
