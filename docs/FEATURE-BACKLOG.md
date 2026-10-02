# FEATURE-BACKLOG.md — proposed features from competitor research

The ledger for TFlex feature proposals. Numbering is **FEA-NNN**, continuing forever, matching
the `DEF-NNN` and `ADV-NNN` ledgers.

Writers: **orchestrator** only. The `feature-scout` role returns proposals but is read-only by
design — it never writes this file, which keeps an agent that ingests untrusted web pages away
from every write path. The orchestrator records what the scout returns and sets dispositions.

Entries are appended newest-section-last inside each batch, and a disposition is never
rewritten — it is changed in place only by the orchestrator, with a History line saying who,
what and why.

## Statuses

| Status | Meaning | Set by |
| --- | --- | --- |
| PROPOSED | Returned by feature-scout, not yet decided | orchestrator |
| ACCEPTED -> Phase N | Promoted into REQUIREMENTS.md as phase N | orchestrator |
| REJECTED - reason | Will not build, with the reason | orchestrator |
| DEFERRED - reason | Wanted, but not in the current plan | orchestrator |
| OUT-OF-SCOPE - reason | Conflicts with the build rules, e.g. needs a network | orchestrator |

Accepting a proposal is not the end of it: the orchestrator appends the feature to
`REQUIREMENTS.md` as the next numbered phase, in the original phase template, including the
mandatory **Settings impact** line.

Keep entries terse. This file is read in full by the scout on every run, so it grows by ten
entries per batch and its size is a recurring cost. Name, one line, source, status. When it
passes roughly 500 lines, archive closed entries to `docs/FEATURE-BACKLOG-ARCHIVE.md`.

## Entry format

> NOTE: the entry below is an ILLUSTRATION inside this fence — its `FEA-001` number is a placeholder, not a
> real proposal. The real ledger starts at FEA-011 (the first `feature-scout` batch). Do not re-use 001-010;
> the next proposal takes the next free number after the last real entry.

```
## FEA-001: Watermark (text or image overlay)

- Status: PROPOSED
- Source: https://www.ilovepdf.com/pdf_add_watermark (iLovePDF)
- Category: Annotate
- Effort: S
- Likely new settings: no
- Batch: 1

What it does: Stamp arbitrary text or an image across pages with typography, transparency and position/tile options, distinct from the existing APPROVED-style stamp palette.

Why it matters: Users need to add document-wide watermarks for confidentiality or branding purposes.

History:
- orchestrator: recorded from feature-scout batch 1

## FEA-002: Header/footer & visual page numbers

- Status: PROPOSED
- Source: https://www.sejda.com/header-footer-pdf (Sejda)
- Category: Edit
- Effort: S
- Likely new settings: no
- Batch: 1

What it does: Apply page numbers or text labels to pages with position, size and font choices ("Page 3 of 12", headers/footers).

Why it matters: Users require visible page numbering and headers/footers for professional documents.

History:
- orchestrator: recorded from feature-scout batch 1

## FEA-003: Edit PDF metadata

- Status: PROPOSED
- Source: https://www.sejda.com/edit-pdf-metadata (Sejda)
- Category: Edit
- Effort: S
- Likely new settings: no
- Batch: 1

What it does: Change Author, Title, Subject, Keywords and other metadata fields of the open document from a small dialog.

Why it matters: Users need to manage document metadata for organization and searchability.

History:
- orchestrator: recorded from feature-scout batch 1

## FEA-004: Extract embedded images

- Status: PROPOSED
- Source: https://tools.pdf24.org/en/extract-images (PDF24)
- Category: Export
- Effort: S
- Likely new settings: no
- Batch: 1

What it does: Pull all images embedded in a PDF out as standalone files (not page renderings).

Why it matters: Users need access to the original image assets embedded in PDF documents.

History:
- orchestrator: recorded from feature-scout batch 1

## FEA-005: Batch remove annotations

- Status: PROPOSED
- Source: https://www.sejda.com/delete-pdf-annotations (Sejda)
- Category: Annotate
- Effort: S
- Likely new settings: no
- Batch: 1

What it does: Strip highlights, strikeouts, notes or all annotations from a document (or a page range) in one action.

Why it matters: Users need to clean up documents of annotations in bulk.

History:
- orchestrator: recorded from feature-scout batch 1

## FEA-006: Grayscale conversion

- Status: PROPOSED
- Source: https://www.sejda.com/grayscale-pdf (Sejda)
- Category: Optimize
- Effort: M
- Likely new settings: no
- Batch: 1

What it does: Convert a PDF's text and images to grayscale, saved as a new file.

Why it matters: Users need to convert documents to grayscale for printing or archival purposes.

History:
- orchestrator: recorded from feature-scout batch 1

## FEA-007: Advanced split modes

- Status: PROPOSED
- Source: https://www.sejda.com/split-pdf-by-outline (Sejda)
- Category: Organize
- Effort: M
- Likely new settings: no
- Batch: 1

What it does: Split by bookmarks/outline (chapters to files), by text change between pages, by target file size, and split-in-half for two-up scans.

Why it matters: Users require more sophisticated splitting options than simple page ranges.

History:
- orchestrator: recorded from feature-scout batch 1

## FEA-008: PDF overlay

- Status: PROPOSED
- Source: https://tools.pdf24.org/en/overlay-pdf (PDF24)
- Category: Edit
- Effort: M
- Likely new settings: no
- Batch: 1

What it does: Overlay two PDFs page-on-page (e.g., digital paper behind a scan, or revision layers).

Why it matters: Users need to layer PDF documents for comparison, revision tracking, or overlaying templates.

History:
- orchestrator: recorded from feature-scout batch 1

## FEA-009: Create/edit form fields (make a PDF fillable)

- Status: PROPOSED
- Source: https://www.ilovepdf.com/pdf-forms (iLovePDF)
- Category: Create
- Effort: M
- Likely new settings: yes
- Batch: 1

What it does: Add text fields, checkboxes, radio groups, dropdowns and lists to a flat PDF, plus auto field detection.

Why it matters: Users need to create fillable forms from static PDFs.

History:
- orchestrator: recorded from feature-scout batch 1

## FEA-010: Password protect / encrypt with permissions

- Status: ACCEPTED -> Phase 52 (feature D)
- Source: https://www.sejda.com/encrypt-pdf (Sejda)
- Category: Edit
- Effort: H
- Likely new settings: yes
- Batch: 1

What it does: Encrypt a PDF with an owner/user password and restriction flags (no printing, no copy, no modify).

Why it matters: Users need to protect sensitive documents with password protection and permissions.

History:
- orchestrator: recorded from feature-scout batch 1
```

---

_No proposals recorded yet. The first `feature-scout` run appends its batch below this line._

## FEA-011: Dock text properties panel with Adobe's FORMAT TEXT control set

- Status: ACCEPTED -> Phase 21
- Source: https://helpx.adobe.com/acrobat/desktop/edit-documents/edit-text-in-pdfs/format-text.html (Adobe Acrobat Pro); https://www.pdf-xchange.com/product/pdf-xchange-editor (PDF-XChange Properties Pane / Format Tab)
- Category: Edit
- Effort: M
- Likely new settings: no (reuses `editDefaultFont` and the annotation colour fields)
- Batch: research for Phase 21 (2026-09-19)

What it does: A docked text-properties panel (not a floating toolbox) beside the left rail, carrying Adobe's
verbatim FORMAT TEXT set - font family, font size, font colour, bold/italic/underline,
superscript/subscript, alignment (left/centre/right/justify), line spacing, character spacing,
horizontal scaling, bulleted/numbered lists - applied on change and committed on deselect, exactly like
Acrobat's Edit panel.

Why it matters: two independent desktop peers (Acrobat's Edit panel, PDF-XChange's Properties Pane / Format
Tab) use the docked-panel convention; the floating double-click toolbox is the legacy pattern Phase 21
retires. Research note: pdf-lib exposes no character-spacing / horizontal-scaling operators, so those two
controls must ship disabled-with-tooltip unless the engine grows custom `Tc`/`Tz` operators; live reflow of
foreign content streams is out of scope (Foxit/Adobe reflow is the H item); font changes are substitutions
by definition under the StandardFont allowlist and must fail loud, the way Sejda's Font Replacement dialog
does ("This font (embedded in the document) does not support this style change...").

History:
- orchestrator: recorded from feature-scout research dispatch (Phase 21 design input)

## FEA-012: Format Painter (copy formatting from one text object to another)

- Status: ACCEPTED -> Phase 80
- Source: https://support.microsoft.com/en-us/word/training/add-and-edit-text (Microsoft Word, Font group)
- Category: Edit
- Effort: M
- Likely new settings: no
- Batch: research for Phase 21 (2026-09-19)

What it does: Pick up the formatting of a selected text object and apply it to another with one click,
like Word's Format Painter.

Why it matters: once the Phase-21 panel exists, re-applying a font/colour/size combination to many objects
is the most common bulk action; peers ship it and the panel is the natural home for it.

History:
- orchestrator: recorded from feature-scout research dispatch (deferred candidate after Phase 21)
- orchestrator: accepted on CEO commission TFL-315; promoted to Phase 80

## FEA-013: Spell check inside the text editor

- Status: ACCEPTED -> Phase 82
- Source: https://helpx.adobe.com/acrobat/using/edit-text-pdfs.html (Adobe: spell check as part of Add/Edit text)
- Category: Edit
- Effort: M
- Likely new settings: maybe (dictionary/language)
- Batch: research for Phase 21 (2026-09-19)

What it does: Underline misspellings in the text being edited and offer suggestions, offline.

Why it matters: Adobe treats it as part of the edit-text flow; a fully offline PDF studio can ship a small
bundled dictionary without any network call, which keeps it inside the v1 offline rule.

History:
- orchestrator: recorded from feature-scout research dispatch (deferred candidate after Phase 21)
- orchestrator: accepted on CEO commission TFL-315; promoted to Phase 82

## FEA-014: Booklet and poster printing (imposition layouts)

- Status: ACCEPTED -> Phase 83
- Source: https://helpx.adobe.com/acrobat/using/printing-pdfs.html (Adobe Acrobat print dialog: Booklet / Poster / Multiple pages per sheet)
- Category: Print
- Effort: L
- Likely new settings: yes (a saved booklet/poster preset)
- Batch: print research for Phase 30 (2026-09-21)

What it does: Impose pages for folding (booklet: 2-up, reordered for saddle stitch, with gutter/creep and
booklet subset options) and scale one page across multiple sheets (poster: tile with overlap marks and
cut marks). Acrobat ships both as first-class print layouts next to N-up.

Why it matters: Phase 30 shipped N-up, page order and odd/even/reverse, which is the tile/ordering
substrate these two layouts are built on - the remaining work is the imposition math and the preview
render, so the phase left the cheapest possible seam for it.

History:
- orchestrator: recorded from the feature-scout print research that produced Phase 30 (booklet/poster were
  named in the research but deliberately left out of the Phase 30 feature list as the L-effort tier)
- orchestrator: accepted on CEO commission TFL-315; promoted to Phase 83

## FEA-015: Named print presets persisted across sessions

- Status: ACCEPTED -> Phase 81
- Source: https://helpx.adobe.com/acrobat/using/printing-pdfs.html (Acrobat: print presets you can save and reuse)
- Category: Print
- Effort: S
- Likely new settings: yes (a `printPresets` list: name + PrintSettings snapshot, validated in
  `src/main/services/settings.ts`)
- Batch: print research for Phase 30 (2026-09-21)

What it does: Save the current print dialog settings under a name and re-apply them later, across app
restarts.

Why it matters: Phase 30 shipped session-level presets only (per its Settings impact: none). Users who
print the same way repeatedly (duplex + greyscale + fit) re-enter the same six controls every time; this is
the smallest follow-on with a real daily benefit and it is the only print item that needs a settings field.

History:
- orchestrator: recorded from the feature-scout print research that produced Phase 30
- orchestrator: accepted on CEO commission TFL-315; promoted to Phase 81

## FEA-016: Paper source / tray selection by page size

- Status: DEFERRED - no Electron print option exposes the paper source or tray, so the app cannot honour
  it; the Phase 30 dialog omits the control rather than shipping a no-op. Revisit only if a native or
  driver-level print path replaces `webContents.print`.
- Source: https://helpx.adobe.com/acrobat/using/printing-pdfs.html (Acrobat: Choose paper source by PDF
  page size)
- Category: Print
- Effort: L
- Likely new settings: no
- Batch: print research for Phase 30 (2026-09-21)

What it does: Pick the input tray per page size (e.g. letter pages from tray 1, legal from tray 2).

Why it matters: it is the one industry print option TFlex provably cannot deliver on the current engine;
the research flagged it as driver-dependent, and Electron's `print(options)` has no key for it
(verified in Phase 30: `getPrintersAsync()` returns no tray/status data either).

History:
- orchestrator: recorded from the feature-scout print research; DEFERRED with the engine limitation as the
  reason (Phase 30 verified the limitation rather than guessing it)

## FEA-017: Encrypted PDF support - open with a password (the Phase 52 research)

- Status: ACCEPTED -> Phase 52 (features A-C)
- Source: qpdf manual (crypto/version mapping + the "empty user password opens, restrictions are unenforceable"
  semantics), Sejda's encrypt/unlock pages (the prompt + limited-permission UX), PDF24's lock page (AES-256 +
  the 8 permission toggles), Foxit (AES-256 + a free Unlock tool), the installed `pdfjs-dist` 4.10.38 source
  (`src/core/crypto.js` - R2-R6 handlers; `src/display/api.js` - `password`/`onPassword`/PasswordException),
  `pdf-lib`'s README (why `ignoreEncryption` must not be used) and `@cantoo/pdf-lib` (MIT drop-in: load with
  `{password}` incl. empty; `encrypt()` AES-256 R6 default with permissions).
- Category: Edit
- Effort: M (open) + S-M (create)
- Likely new settings: yes (`encryptDefaults` - the create dialog's remembered algorithm + permission toggles)
- Batch: the operator's encrypted-PDF research (2026-09-28)

What it does: opens password-protected PDFs (pdf.js for display, a decrypting loader for editing), shows an
honest protection/permission banner, and creates AES-256/AES-128 encrypted PDFs with permission flags.

Why it matters: the operator hit a real encrypted file the app could not open at all; every desktop peer opens
them, and creating them is the natural counterpart (FEA-010).

Decision record: permission flags are DISPLAY-ONLY; no explicit remove-protection action (a save writes a
decrypted copy and says so); AES-256 default / AES-128 optional, RC4 never WRITTEN (still readable); passwords
live in renderer memory only (never settings, logs or sync).

History:
- orchestrator: recorded from the feature-scout encrypted-PDF research dispatch; promoted straight into
  Phase 52 at the operator's request

## FEA-018: Native 3D / CAD structure rendering for PDF/E

- Status: DEFERRED - the operator's 2026-09-29 universal-format request asked for "layered 3D structural
  data rendering" and "CAD metadata" in `.pdf/E`. Phase 57 delivers the layers panel, the CAD/engineering
  XMP metadata surface and an announced, readable limitation for 3D content. Rendering U3D/PRC geometry
  needs a 3D engine (three.js + a U3D/PRC decoder) that has no maintained offline pure-JS implementation;
  shipping one is its own program. Phase 57 refuses to render 3D rather than showing a blank page.
- Source: The operator's file-format matrix (2026-09-29); PDF/E-1 ISO 24517-1 (3D annotations, measurement,
  geospatial)
- Category: Viewer / Engineering
- Effort: XL (new 3D subsystem)
- Likely new settings: yes (viewer defaults for 3D)
- Batch: universal file-format program (2026-09-29)

What it does: renders U3D/PRC 3D annotations and CAD structural data inside `.pdf/E` documents natively.

Why it matters: it is the one genuinely heavyweight capability in the request that cannot be delivered with
pure-JS offline libraries at acceptable quality; the honest degraded path is delivered in Phase 57.

## FEA-019: PDF page to SVG vector export

- Status: DEFERRED - the request listed `.svg` under imaging; Phase 54 delivers SVG IMPORT (native vector
  translation plus Chromium raster fallback). Exporting a PDF page to true SVG vector paths requires
  translating PDF content-stream operators into SVG primitives, which is a separate interpreter; Phase 54
  ships PNG/JPEG page export at 72-600 DPI instead, which covers the practical need.
- Source: The operator's file-format matrix (2026-09-29)
- Category: Export
- Effort: L
- Likely new settings: no
- Batch: universal file-format program (2026-09-29)

What it does: exports a PDF page as an editable SVG preserving vector paths and text.

Why it matters: design and print users want vector extraction; deferred because a partial interpreter that
silently flattens is worse than an honest raster export.

## FEA-020: True CMYK / ICC colour management (PDF/X production preflight)

- Status: DEFERRED in part - Phase 54 validates PDF/X (output intent, ICC presence, CMYK-only, embedding,
  transparency rules) and enforces or refuses honestly. Actual colour-space CONVERSION engine work (RGB to
  CMYK via ICC transforms, ICC embedding of a user-supplied profile) is deferred: it needs a CMM (Little CMS
  or similar) which is a native binary, forbidden by the pure-JS packaging rule.
- Source: The operator's file-format matrix (2026-09-29); PDF/X-1a:2001 and PDF/X-4 ISO 15930
- Category: Print production
- Effort: XL (native CMM)
- Likely new settings: yes (profiles per intent)
- Batch: universal file-format program (2026-09-29)

What it does: converts document colours into a target CMYK ICC space and embeds the profile.

Why it matters: it is the single feature that turns validation into production-grade output; blocked by the
no-native-addon rule and by `pdf-lib`'s lack of a colour-management pipeline.

## FEA-021: Faithful PDF to DOCX / XLSX layout reconstruction

- Status: DEFERRED - Phase 55 ships STRUCTURAL export (text, detected headings and tables, images) with a
  mandatory fidelity warning, verified by re-import. Reconstructing true page layout (floating frames,
  column geometry, exact positions) in an editable Word/Excel file is a different order of problem and is
  where commercial converters themselves fail.
- Source: The operator's file-format matrix (2026-09-29) - "and vice-versa"
- Category: Export / Office
- Effort: XL
- Likely new settings: yes (layout mode)
- Batch: universal file-format program (2026-09-29)

What it does: produces a DOCX/XLSX that visually matches the PDF page layout, not just its content.

Why it matters: the operator asked for bidirectionality; Phase 55 delivers it at structural fidelity and
this entry records that layout fidelity is knowingly not claimed.

## FEA-022: DRM-protected e-book support

- Status: OUT-OF-SCOPE - refuses by policy. `.azw`/`.epub` files carrying DRM protection are detected and
  refused with a readable message. The app never attempts to decrypt protected e-books or install a
  circumvention library; no such dependency may be added.
- Source: The operator's file-format matrix (2026-09-29) - `.mobi` / `.azw`
- Category: Reading
- Effort: n/a (policy)
- Likely new settings: no
- Batch: universal file-format program (2026-09-29)

What it does: would open DRM-protected Kindle/Adobe e-books.

Why it matters: recorded so no later phase re-opens it as an oversight; the detection-and-refusal behaviour
is a Phase 56 success criterion.

## FEA-023: Tagged-PDF structure preservation on save

- Status: DEFERRED - found by backend-dev during the DEF-378 fix (2026-09-29): `serializeDoc` rebuilds
  every document from the page copies, so `/StructTreeRoot` is dropped and **saving any tagged PDF
  silently untags it** (screen readers lose the reading order and the semantic structure). Every other
  catalog entry the rebuild dropped was carried in Phase 54's fix or is contracted into Phase 57 feature G;
  this one is deferred with a written reason: structure elements (`StructElem`) reference PAGE objects and
  parent links, so carrying them means remapping the page references AND validating the parent/child
  linkage and the `/MarkInfo /Marked` flag together. Shipping a half-carried structure tree would be worse
  than dropping it, because a file that CLAIMS to be tagged but has a broken tree is worse for assistive
  technology than an honestly untagged file.
- Source: `src/main/services/engine.ts` `serializeDoc`'s dropped-entry list (DEF-378 fix cycle); ISO 32000-1
  14.7 (logical structure), PDF/UA-1
- Category: Accessibility / Archival
- Effort: L (structure-tree remapping plus a tagged-fixture regression set)
- Likely new settings: no
- Batch: the Phase 54 DEF-378 fix cycle (2026-09-29)

What it does: keeps a tagged PDF's logical structure intact across an open-and-save round-trip.

Why it matters: accessibility is a legal requirement in several of the audiences this program was asked to
serve, and a save that silently strips tagging is data loss even though no visible pixel changes.

## FEA-024: Styled / heading-aware DOCX export

- Status: DEFERRED - found by backend-dev while implementing REQUIREMENTS.md Phase 55 feature D
  (2026-09-29). The phase originally promised `.docx` export with "headings by font size" and a
  `docxHeadingDetection` setting; the implementation could not honour it because the engine's text
  extractor (`extractTextFromRawPdf` / `parseContentStreamText`, `src/main/services/engine.ts:5907/6258`)
  returns per-page PLAIN TEXT with no per-line font size, weight or colour, and the DOCX builder
  (`buildDocxFromDoc`, `engine.ts:6414`) consumes only `DocxDocPage { kind:'text', text }`. Heading
  detection needs a metric-aware extractor and a styled document model behind it, which is its own change
  to the engine's most load-bearing code path. The setting was REMOVED from the phase rather than shipped
  as a knob that changes nothing, and the phase text was amended to match what the product actually does.
- Source: REQUIREMENTS.md Phase 55 feature D as originally written; the DEF-060/DEF-106 docx export history
- Category: Export / Office
- Effort: L (a styled text-extraction pass plus a styled document model and a DOCX writer over it)
- Likely new settings: yes (`officeConvertDefaults.exports.docxHeadingDetection` returns here when it can
  actually be honoured)
- Batch: the Phase 55 export implementation (2026-09-29)

What it does: exports a PDF to a DOCX that preserves heading levels, bold/italic runs, colours and detected
tables instead of flattening everything to plain paragraphs.

Why it matters: it is the difference between an editable Word file and a Word file that merely contains the
words; commercial converters compete on exactly this, and the phase's fidelity notes must keep saying what
the product really achieves until this lands.

## FEA-025: HUFF/CDIC-compressed MOBI text decoding

- Status: DEFERRED - the Phase 56 mobi reader implements the uncompressed and PalmDOC-compressed text
  records but not the Huffman/Dic (HUFF/CDIC) records Kindle uses for its own repacked books. A file whose
  text records are HUFF/CDIC is DETECTED and refused with a readable `unsupported-format` message; it is
  never decoded wrongly. Implementing the codec (a dictionary-based Huffman decoder plus the CDIC phrase
  tables) is a self-contained but non-trivial offline pure-JS job, deferred rather than half-built.
- Source: Phase 56 feature B mobi adapter (`src/main/services/convert/adapters/mobi.ts`); Mobipocket format
  documentation (PalmDOC vs HUFF/CDIC record compression)
- Category: Reading
- Effort: M (codec + fixtures)
- Likely new settings: no
- Batch: the Phase 57 refusal sweep (2026-09-29)

What it does: would decode HUFF/CDIC-compressed MOBI text so those Kindle books open in the Reading view.

Why it matters: recorded so a later phase re-opens it knowingly; the shipped behaviour is a readable refusal,
not a crash or a garbled page.

## FEA-026: Unbounded inlined-image extraction budget

- Status: OUT-OF-SCOPE - reason: the Phase 56 e-book path inlines images as `data:` URIs, and the image
  PREFLIGHT now refuses a declared extent above 5,000 image references or 64 MiB before doing any work
  (the DEF-396/397/398 fix). Raising or removing that ceiling would let an attacker-declared image count
  exhaust memory or stall the decode slot; the ceiling ships as a documented, typed refusal carrying the
  measured extent. Unbounded extraction conflicts with the project's memory-stability rule.
- Source: DEF-396/397/398 (the declared-extent preflight); Phase 56 EPUB inlining
  (`src/main/services/convert/epub-parse.ts`)
- Category: Reading / Security
- Effort: n/a (policy)
- Likely new settings: no
- Batch: the Phase 57 refusal sweep (2026-09-29)

What it does: would inline an arbitrarily large number of e-book images into the reading HTML.

Why it matters: it documents why the app refuses big declared extents rather than trying and dying, which is
the behaviour criterion 7 asks to be recorded.

## FEA-027: Unbounded TAR / ZIP container expansion

- Status: OUT-OF-SCOPE - reason: the CBZ/CBT comic and ODT/XLSX/PPTX office readers bound every archive by a
  declared entry count and a per-entry and total uncompressed-size ceiling (Phase 56), refusing over-budget
  archives with a typed error before extraction. An unbounded reader is a zip-bomb vector; the ceilings are a
  security rule, not a missed feature, and they ship as documented refusals.
- Source: Phase 56 features A-C (`src/main/services/convert/convert-zip.ts`, the comic/TAR reader and the
  office container walker); DEF-392/393/394 (attacker-declared extents)
- Category: Reading / Security
- Effort: n/a (policy)
- Likely new settings: no
- Batch: the Phase 57 refusal sweep (2026-09-29)

What it does: would extract arbitrarily many, arbitrarily large entries from a TAR or ZIP-backed document.

Why it matters: it records the deliberate ceilings so no later phase reads them as an accident.

## FEA-028: Unbounded XMP metadata scanning

- Status: OUT-OF-SCOPE - reason: Phase 57 feature A's `getCadMetadata` scans the document for the PDF/E
  engineering XMP packet under a 4 MiB ceiling and returns a typed refusal above it. Metadata is
  attacker-controlled and can be padded arbitrarily; an unbounded scan would let a file stall the document
  info surface, which conflicts with the latency budget. The ceiling is documented and reported, not silent.
- Source: Phase 57 feature A (`engine.getCadMetadata`); the Phase 57 document-info surface
- Category: Engineering
- Effort: n/a (policy)
- Likely new settings: no
- Batch: the Phase 57 refusal sweep (2026-09-29)

What it does: would scan the whole file for an XMP packet regardless of size.

Why it matters: it records the ceiling as a deliberate bound, satisfying criterion 7's written-reason
requirement for the refusal.

## FEA-029: Destination shapes Phase 57 feature G deliberately drops

- Status: OUT-OF-SCOPE - reason: the feature-G serializer carries `/Dests` and `/OpenAction` only when they
  can be carried CORRECTLY - a destination whose page reference resolves through the page map, and an
  `/OpenAction` that is an `/S /GoTo` dictionary. Two shapes are deliberately not carried: (1) a destination
  whose page reference resolves to no source page (a dangling/inter-document reference), and (2) an
  `/OpenAction` that is not a `/S /GoTo` dict (e.g. a JavaScript action or a non-GoTo action type). Guessing
  a remap for a dangling reference, or rewriting a non-GoTo action, would change behaviour rather than
  preserve it; the serializer's block comment names both drops with this reason.
- Source: Phase 57 feature G (`serializeDoc` / `carryPageLinkedEntries`, `src/main/services/engine.ts`);
  ISO 32000-1 12.3.2 (destinations) and 12.6.4.2 (GoTo actions)
- Category: Archival / Catalog round-trip
- Effort: n/a (scope boundary)
- Likely new settings: no
- Batch: the Phase 57 refusal sweep (2026-09-29)

What it does: would carry every destination and action shape across a save without judgement.

Why it matters: it names the boundary of the feature-G carry so a later phase can extend it deliberately
rather than reading the drop as a bug.

## FEA-030: Retire the Phase 56 `openComicView` command-palette verb

- Status: CANDIDATE - cleanup, not commissioned. Reason it was not folded into Phase 66: REQUIREMENTS
  Phase 66 ruling 6 protects "the surviving comic controls", and ruling 2's "one entry" governs the
  canvas entry point (already singular after chunk 1 retired the visible trigger). Removing the verb
  would regress a control the ruling protects and force churn across the shared tools registry and its
  specs (`readingView.test.tsx:410/479`, `toolsRegistry.test.tsx:73`,
  `e2e/installed/phase57_packaged_surface.spec.cjs:166`) at phase close. ADV-136 was therefore REJECTED
  for Phase 66 and parked here.
- Source: ADV-136 (adversary TFL-146 diff-pass, 2026-10-01); `src/renderer/state/toolsRegistry.ts:1454-1463`,
  App action wiring `src/renderer/App.tsx:9290/:10661`, gate `src/renderer/state/dockModel.ts:170-185`
- Category: Renderer / commands
- Effort: small (registry + wiring + gate branch + 3 spec updates)
- Likely new settings: no
- Batch: unassigned; CEO to schedule if desired

What it does: `Control+K` -> "Open comic view" still mounts the pre-Phase-66
`[data-reading-view][data-reading-mode="comic"]` overlay for a `.cbz` / `.cbt` (same in-window shell, not
a second BrowserWindow). Phase 66 replaced that surface with Book View and retired the visible trigger but
left the palette verb live, so a second, older comic reader survives alongside Book View.

Why it matters: it is the one remaining duplicate of the comic-reading surface; if the intent is that Book
View fully supersedes the old comic viewport, this verb should be retired in its own small change with the
accompanying spec updates, rather than silently at a phase close.

## FEA-031: True redaction (permanent content removal)

- Status: ACCEPTED -> Phase 84
- Source: https://tools.pdf24.org/en/redact-pdf (PDF24); https://www.foxit.com/pdf-editor/ (Foxit "Redact Information - Permanently remove sensitive content")
- Category: Edit
- Effort: M
- Likely new settings: maybe (redaction defaults: mark colour, apply-on-save)
- Batch: 4 (feature-scout TFL-377, 2026-10-02)

What it does: mark text/regions and permanently strip the underlying content on save, unlike the shipped
Phase-10 delete which is documented visual redact-and-redraw (original text remains extractable).

Why it matters: confidentiality workflows are unusable when "redacted" text survives copy/paste; every
desktop peer ships real redaction.

History:
- orchestrator: recorded from feature-scout batch FEA-031..FEA-040 (TFL-377)
- orchestrator: accepted on CEO commission TFL-315, iteration 4; promoted to Phase 84

## FEA-032: Compare two documents (side-by-side diff)

- Status: PROPOSED
- Source: https://tools.pdf24.org/en/compare-pdf (PDF24); https://stirlingpdf.io/ (Stirling "Compare PDF Files"); https://www.foxit.com/pdf-editor/ (Foxit "Compare two PDF versions")
- Category: Edit
- Effort: L
- Likely new settings: maybe (default diff mode: text vs pixel)
- Batch: 4 (feature-scout TFL-377, 2026-10-02)

What it does: open two versions and highlight inserted/deleted/changed text, and optionally pixel
differences, page by page.

Why it matters: revision review is a top Acrobat/Foxit Pro capability TFlex cannot answer at all.

History:
- orchestrator: recorded from feature-scout batch FEA-031..FEA-040 (TFL-377)

## FEA-033: Bates numbering

- Status: PROPOSED
- Source: https://www.sejda.com/bates-numbering-pdf (Sejda, "Bates stamp multiple files at once")
- Category: Annotate
- Effort: M
- Likely new settings: maybe (batesDefaults: prefix, start number, padding, position)
- Batch: 4 (feature-scout TFL-377, 2026-10-02)

What it does: stamp sequential case/file numbers across selected pages of one or more documents, with
prefix/suffix and position options.

Why it matters: legal and accounting workflows expect Bates stamps; plain page numbering does not cover
them.

History:
- orchestrator: recorded from feature-scout batch FEA-031..FEA-040 (TFL-377)

## FEA-034: Certificate-based digital signature (sign and validate)

- Status: PROPOSED
- Source: https://stirlingpdf.io/ (Stirling "Sign PDF with a Certificate", "Validate PDF Signature"); https://www.foxit.com/pdf-editor/signing-digitally/ (Foxit)
- Category: Edit
- Effort: H
- Likely new settings: no (certificate material and its password must never persist in settings)
- Batch: 4 (feature-scout TFL-377, 2026-10-02)

What it does: sign with a local .pfx/.p12 certificate (PKCS#7 over the signed byte range) and show a
validity notice for existing /Sig fields instead of treating them as dead unfillable widgets.

Why it matters: the one peer signing capability TFlex structurally lacks; the form code already detects
/FT /Sig fields and classifies them unfillable.

History:
- orchestrator: recorded from feature-scout batch FEA-031..FEA-040 (TFL-377)

## FEA-035: Create and edit bookmarks (outline tree)

- Status: ACCEPTED -> Phase 85
- Source: https://stirlingpdf.io/ (Stirling "Edit PDF Bookmarks"); https://www.sejda.com/pdf-bookmarks (Sejda "Create Bookmarks")
- Category: Organize
- Effort: M
- Likely new settings: no
- Batch: 4 (feature-scout TFL-377, 2026-10-02)

What it does: add, rename, retarget, nest and delete outline entries; today the outline panel is view-only
navigation.

Why it matters: merged or reorganized documents (Phases 2/32) end up with stale or missing bookmarks;
peers fix that in the same panel.

History:
- orchestrator: recorded from feature-scout batch FEA-031..FEA-040 (TFL-377)
- orchestrator: accepted on CEO commission TFL-315, iteration 4; promoted to Phase 85

## FEA-036: Embed file attachments plus an attachments panel

- Status: PROPOSED
- Source: https://stirlingpdf.io/ (Stirling "Add Attachments to PDF")
- Category: Create
- Effort: M
- Likely new settings: no
- Batch: 4 (feature-scout TFL-377, 2026-10-02)

What it does: attach files into the document's /EmbeddedFiles name tree with a panel to open, save and
remove them; PDF/A validation already detects embedded files but there is no management surface.

Why it matters: attaching source material to a PDF is a standard desktop-peer capability TFlex can
currently only detect, not manage.

History:
- orchestrator: recorded from feature-scout batch FEA-031..FEA-040 (TFL-377)

## FEA-037: Sanitize PDF (strip active content)

- Status: PROPOSED
- Source: https://stirlingpdf.io/ (Stirling "Sanitize PDF")
- Category: Optimize
- Effort: M
- Likely new settings: yes (sanitize options: JavaScript, embedded files, external launch actions, metadata)
- Batch: 4 (feature-scout TFL-377, 2026-10-02)

What it does: remove JavaScript, launch and embedded-file actions and other executable metadata from a
document, reporting what was stripped.

Why it matters: fits the Audit/verify stage and the app's documented attacker-controlled-content posture;
peers expose it as a one-click safety action.

History:
- orchestrator: recorded from feature-scout batch FEA-031..FEA-040 (TFL-377)

## FEA-038: Search and replace text across the document

- Status: PROPOSED
- Source: https://www.sejda.com/pdf-editor (Sejda, "Easily find and replace all occurrences of words in a PDF")
- Category: Edit
- Effort: M
- Likely new settings: no
- Batch: 4 (feature-scout TFL-377, 2026-10-02)

What it does: find every occurrence of a term and replace it, one-by-one confirm or replace-all, using the
existing search index and text-edit machinery.

Why it matters: search exists today but stops at finding; renaming a term through a long document is
manual page-by-page work.

History:
- orchestrator: recorded from feature-scout batch FEA-031..FEA-040 (TFL-377)

## FEA-039: Remove blank pages

- Status: PROPOSED
- Source: https://stirlingpdf.io/ (Stirling "Remove Blank Pages from PDF")
- Category: Organize
- Effort: S
- Likely new settings: maybe (ink-coverage threshold for what counts as blank)
- Batch: 4 (feature-scout TFL-377, 2026-10-02)

What it does: detect pages with no renderable content, or only scanner noise below a threshold, and delete
them in one pass.

Why it matters: the cheapest scan-cleanup win; complements OCR (Phase 11) for paper workflows.

History:
- orchestrator: recorded from feature-scout batch FEA-031..FEA-040 (TFL-377)

## FEA-040: Repair damaged PDF (salvage import)

- Status: PROPOSED
- Source: https://stirlingpdf.io/ (Stirling "Repair PDF"); https://www.sejda.com/repair-pdf (Sejda)
- Category: Optimize
- Effort: M
- Likely new settings: no
- Batch: 4 (feature-scout TFL-377, 2026-10-02)

What it does: attempt recovery of a corrupted file (rebuild the cross-reference table from scanned objects,
salvage readable pages) and open the salvageable subset with an honest report of what was lost.

Why it matters: today a damaged file is simply refused; peers can often recover its pages, and the engine
already rebuilds documents from page objects on save.

History:
- orchestrator: recorded from feature-scout batch FEA-031..FEA-040 (TFL-377)

## FEA-041: Deskew + auto-rotate scanned pages

- Status: PROPOSED
- Source: https://www.sejda.com/deskew-pdf (Sejda); https://stirlingpdf.io/ (Stirling "Auto Rotate")
- Category: Optimize
- Effort: M
- Likely new settings: maybe (scanCleanupDefaults: max deskew angle, auto-rotate on/off)
- Batch: 5 (feature-scout TFL-389, 2026-10-02)

What it does: detect and remove page skew and wrong orientation on scanned pages, straightening the raster before save (reuses the existing OCR raster pipeline).

Why it matters: every desktop peer ships scan cleanup; today manual rotate is the only fix and OCR quality depends on straight pages.

History:
- orchestrator: recorded from feature-scout batch FEA-041..FEA-050 (TFL-389); CEO disposition: PROPOSED

## FEA-042: Flip / mirror pages horizontally or vertically

- Status: PROPOSED
- Source: https://www.sejda.com/flip-pdf (Sejda "Flip - Mirror pages horizontally or vertically")
- Category: Organize
- Effort: M
- Likely new settings: no
- Batch: 5 (feature-scout TFL-389, 2026-10-02)

What it does: apply a horizontal or vertical mirror transform to selected pages and save it into the file.

Why it matters: mirrored scans and specialty print workflows need true mirroring; the shipped rotate ops (rotate-cw/ccw only) cannot produce it.

History:
- orchestrator: recorded from feature-scout batch FEA-041..FEA-050 (TFL-389); CEO disposition: PROPOSED

## FEA-043: Alternate & Mix merge (interleave two documents)

- Status: PROPOSED
- Source: https://www.sejda.com/alternate-mix-pdf (Sejda "Mixes pages from 2 or more documents, alternating between them")
- Category: Organize
- Effort: S
- Likely new settings: no
- Batch: 5 (feature-scout TFL-389, 2026-10-02)

What it does: merge two documents by interleaving their pages (A1,B1,A2,B2...; with reverse and step options) into one file.

Why it matters: the classic two-sided-scan reunite workflow is today only manual page-by-page reordering.

History:
- orchestrator: recorded from feature-scout batch FEA-041..FEA-050 (TFL-389); CEO disposition: PROPOSED

## FEA-044: Resize pages (scale content to a target size, add margins/padding)

- Status: PROPOSED
- Source: https://www.sejda.com/resize-pdf (Sejda "Add page margins and padding, Change PDF page size"); https://stirlingpdf.io/ (Stirling "Resize PDF Pages")
- Category: Edit
- Effort: M
- Likely new settings: maybe (resizeDefaults: default target page size)
- Batch: 5 (feature-scout TFL-389, 2026-10-02)

What it does: change a page's media size (A5 to A4) scaling the content, or pad with margins onto a larger sheet - distinct from shipped crop, which only clips.

Why it matters: print and form workflows need uniform page geometry; crop alone cannot enlarge or rescale.

History:
- orchestrator: recorded from feature-scout batch FEA-041..FEA-050 (TFL-389); CEO disposition: PROPOSED

## FEA-045: Add and edit hyperlink annotations

- Status: PROPOSED
- Source: https://www.sejda.com/pdf-editor (Sejda editor: "Add new links to web URLs or pages in the document. Easily edit existing hyperlinks in the PDF")
- Category: Edit
- Effort: M
- Likely new settings: no
- Batch: 5 (feature-scout TFL-389, 2026-10-02)

What it does: draw a link rectangle over text or an area and set an internal GoTo destination, a file link or a URL; edit or remove existing links.

Why it matters: the engine carries existing /Link annots untouched but users cannot create or fix links in a reorganized document.

History:
- orchestrator: recorded from feature-scout batch FEA-041..FEA-050 (TFL-389); CEO disposition: PROPOSED

## FEA-046: Place an image on a page (image stamp tool)

- Status: PROPOSED
- Source: https://stirlingpdf.io/ (Stirling "Add Image to PDF"); https://www.sejda.com/pdf-editor (Sejda: "Add images to the page. Click and drag to move, resize or rotate the image")
- Category: Edit
- Effort: M
- Likely new settings: no
- Batch: 5 (feature-scout TFL-389, 2026-10-02)

What it does: insert a PNG/JPEG anywhere on a page as a movable, resizable, deletable object (logo, photo, exhibit), written as real page content.

Why it matters: create-from-images only builds NEW PDFs and watermark overlays whole documents; there is no way to place one image object on an existing page.

History:
- orchestrator: recorded from feature-scout batch FEA-041..FEA-050 (TFL-389); CEO disposition: PROPOSED

## FEA-047: Remove images from a PDF

- Status: PROPOSED
- Source: https://stirlingpdf.io/ (Stirling "Remove Images from PDF")
- Category: Optimize
- Effort: M
- Likely new settings: maybe (removeImages: keep-images-below-size threshold)
- Batch: 5 (feature-scout TFL-389, 2026-10-02)

What it does: strip embedded images from selected pages or the whole document (optionally keeping small ones), shrinking the file.

Why it matters: complements shipped Reduce file size and text export when only the text matters; peers expose it as a one-click action.

History:
- orchestrator: recorded from feature-scout batch FEA-041..FEA-050 (TFL-389); CEO disposition: PROPOSED

## FEA-048: Adjust / replace / invert page colours

- Status: PROPOSED
- Source: https://stirlingpdf.io/ (Stirling "Adjust PDF Colors and Contrast", "Replace and Invert PDF Colors")
- Category: Optimize
- Effort: M
- Likely new settings: maybe (remember the last adjust preset)
- Batch: 5 (feature-scout TFL-389, 2026-10-02)

What it does: adjust brightness/contrast/saturation or replace one color with another / invert colors, applied to page rasters on save - the file-level sibling of FEA-006 grayscale.

Why it matters: low-contrast scans and inverted reading copies are common reader asks; grayscale is the only color transform shipped.

History:
- orchestrator: recorded from feature-scout batch FEA-041..FEA-050 (TFL-389); CEO disposition: PROPOSED

## FEA-049: Split scanned photos by detected image boundaries

- Status: PROPOSED (low priority)
- Source: https://stirlingpdf.io/ (Stirling "Split Scanned Photos")
- Category: Organize
- Effort: L
- Likely new settings: maybe (minimum detected-photo size)
- Batch: 5 (feature-scout TFL-389, 2026-10-02)

What it does: take a flatbed scan containing several photos and split it into separate pages at the detected photo boundaries.

Why it matters: photo-digitization sessions otherwise need manual crop-and-extract per photo; complements Phase 11 OCR in the scan pipeline.

History:
- orchestrator: recorded from feature-scout batch FEA-041..FEA-050 (TFL-389); CEO disposition: PROPOSED

## FEA-050: Auto-rename from page text on save

- Status: PROPOSED
- Source: https://www.sejda.com/rename-pdf (Sejda "Change document filename based on text from the PDF pages"); https://stirlingpdf.io/ (Stirling "Auto Rename PDF Files")
- Category: Create
- Effort: S
- Likely new settings: maybe (autoRename pattern template)
- Batch: 5 (feature-scout TFL-389, 2026-10-02)

What it does: propose a filename derived from the document's first-page text (user-editable pattern) in the Save dialog.

Why it matters: scanned/merged output defaults to useless names; the engine already extracts first-page text.

History:
- orchestrator: recorded from feature-scout batch FEA-041..FEA-050 (TFL-389); CEO disposition: PROPOSED
