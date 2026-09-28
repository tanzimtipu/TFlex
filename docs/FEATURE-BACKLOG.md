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

- Status: PROPOSED
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

## FEA-013: Spell check inside the text editor

- Status: PROPOSED
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

## FEA-014: Booklet and poster printing (imposition layouts)

- Status: PROPOSED
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

## FEA-015: Named print presets persisted across sessions

- Status: PROPOSED
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
