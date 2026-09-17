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

- Status: PROPOSED
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
