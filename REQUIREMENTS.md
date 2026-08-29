# TFlex — Requirements

## Summary

TFlex is a modern desktop PDF studio for Windows — a fast, lightweight, single-user
alternative to Adobe Acrobat Pro for the things people actually do with PDFs: view them
beautifully, organize pages, annotate, fill forms, and sign.

It is an installable Windows desktop app. It should feel like a real commercial product from
the first launch: quick, fluid, polished, and clearly capable. It ships with sample documents
available from a welcome screen so every feature can be tried immediately.

TFlex is built to grow: licensing, user accounts, and a cloud-backed document database are
planned for a future version. Version 1 stays fully local with no login, but the architecture
must not paint us into a corner (see "Future-proofing" below).

## The product

### Application shell

- A modern desktop window: left rail (thumbnails / annotations / bookmarks), top toolbar,
  central document canvas, right properties panel that appears when relevant.
- Light mode and dark mode, switched by an always-available control. The choice persists.
- A welcome / start screen shown when no document is open: recent files, sample documents,
  and clear primary actions (Open, Merge).
- Smooth, purposeful motion: panel transitions, tab changes and list updates animate
  (roughly 150–250 ms). Nothing janky, nothing gratuitous.
- Multiple documents open in tabs within one window.

### Phase features

See "Phases and success criteria" for the buildable, gated feature list.

## Seed content

The installer ships with sample PDFs (a formatted report, a scanned-style document, a form,
and a long document of 100+ pages) registered on the welcome screen, so every feature is on
display from first launch. The set grows with the phases.

## High-level technical guidance

Just enough direction to keep things on track — specific library choices are left to the
Coding Agent unless stated here.

- **Electron** app written in **TypeScript**, with a **React** renderer and a documented
  build/start setup (npm scripts). Packaged for Windows with **electron-builder** (NSIS
  installer and a portable build).
- **PDF.js** for page rendering in the renderer process.
- **pdf-lib** for PDF manipulation (merge, split, rotate, annotations, forms, flatten) in the
  main process. Rendering and manipulation are separate concerns — keep them in separate
  modules behind clear interfaces.
- All file and PDF-engine work happens in the main process (or a worker), never on the UI
  thread. The UI must stay responsive while a 500-page file loads.
- Prefer **popular, well-supported libraries** over custom code. Keep the implementation
  simple and conventional.
- End-to-end tests drive the real packaged-style app via **Playwright** (Electron support).
- Unit tests accompany every phase, frontend and backend.

### Future-proofing (architecture constraints, not features)

Version 2 will add license verification, user login and a database. Therefore in v1:

- Keep a clean main/renderer boundary with typed IPC contracts in `src/shared/` — no renderer
  code reaching into Electron APIs directly.
- Isolate all persistence behind a single storage/service layer (e.g. app settings, recent
  files) that can later front a real database.
- Keep an obvious seam where licensing/auth gating would attach (an app-level gate before
  the main UI mounts), without building the gate itself.
- Do NOT build: login, accounts, licensing, sync, or any network dependency. v1 works
  fully offline.

## Performance budget

TFlex's identity is fast and lightweight. These are requirements, not aspirations:

- Cold start to interactive welcome screen: under 3 seconds on an ordinary Windows laptop.
- Opening a 500-page PDF: first page rendered and UI interactive within 3 seconds; the app
  never freezes during load (progressive rendering).
- Scrolling and zooming a document stay smooth (no visible blank-page stalls beyond brief
  tile rendering).
- Idle memory with one typical document open: under 400 MB for the whole app.
- Installer size: under 150 MB.

## Not in scope

Deliberately left out of v1. Do not build these:

- No in-place editing of existing PDF text or images (v2 candidate — it is the hardest
  feature in the category).
- No OCR, redaction, document compare, Bates numbering, preflight/print-production,
  digital certificate signing, or batch processing.
- No login, licensing, accounts, cloud sync, or any network features (v2).
- No bookmarks/outline editing (read the outline if present; editing is out of scope).
- No PDF creation from scratch or from other formats (docx, images) — v1 works on
  existing PDFs, except that merge/split/extract produce new PDFs.
- No macOS or Linux packaging — Windows only.

## Look and feel

Applies to the whole app:

- **Modern, calm, and designed on purpose.** Clean typography (a quality UI font such as
  Inter), generous spacing, a restrained neutral base (zinc/slate family) with ONE accent
  color used consistently for primary actions and selections — **`#2563eb` (blue 600)**.
- Dark mode is a first-class theme, equally considered — not an inverted afterthought. The
  document canvas adapts gracefully in dark mode (dimmed chrome around pages; page content
  itself is not color-inverted).
- Motion: fast, subtle transitions (150–250 ms, ease-out). Panels slide, hover states
  respond, tabs crossfade. No bouncy or slow animations.
- Avoid the tells of generated design: gradient hero backgrounds, purple-dominated themes,
  thin accent borders down one side of panels, oversized rounded corners on everything,
  emoji used as UI icons (use a proper icon set such as Lucide).
- Density: this is a productivity tool. Comfortable but information-dense — closer to
  VS Code / Linear than to a marketing site.
- Beyond these rules, layout and visual style are the Coding Agent's call.

## Phases and success criteria

Build in these phases, in order. **Do not start a phase until every success criterion of
the previous phase is demonstrably met** — each criterion must be something you can show
working, not just assert.

Every phase closes the same loop: its unit tests pass, its end-to-end tests pass against the
real running Electron app, and the new features have been used in the running app with
screenshots taken and inspected.

### Phase 1 — Viewer foundation and Windows packaging

**Features**

- Dev start with one documented command; production build produces a Windows installer
  (NSIS) and portable build via electron-builder.
- App shell: toolbar, left thumbnail rail, tab bar, welcome screen with recent files and
  samples; light/dark themes persisted.
- Open a PDF from disk; render pages with PDF.js; continuous scrolling, zoom (buttons,
  ctrl+wheel, fit-width / fit-page), page indicator and jump-to-page.
- Thumbnail rail with current-page highlight; text search within the document with hit
  highlighting and next/previous navigation; document outline (bookmarks) panel shown when
  the PDF has one.
- Recent files list, persisted. Window size/position/theme persisted.
- Sample PDFs bundled and listed on the welcome screen.
- The Playwright + Electron e2e harness runs against the real app.

**Success criteria**

1. One documented command starts the app in dev; a documented command produces an
   installable Windows build.
2. Opening the bundled sample report renders its pages crisply; zooming and fit modes work;
   scrolling stays smooth through 100+ pages.
3. The thumbnail rail tracks the current page; clicking a thumbnail jumps to it.
4. Searching for a known word in the sample report highlights all hits and next/previous
   cycles through them with the document scrolled to each.
5. Theme toggle restyles the whole app, and theme, recent files, and window geometry survive
   an app restart.
6. Cold start and 500-page-open meet the performance budget (timed and recorded).
7. Unit tests for document open, page model, search index and settings persistence pass.
8. At least one e2e test launches the real Electron app, opens a sample PDF, searches, and
   toggles the theme — and passes.

### Phase 2 — Page organization

**Features**

- Insert/merge: combine the open document with one or more other PDFs (choose position).
- Split by page range into a new file; extract selected pages to a new file.
- In the thumbnail rail: drag to reorder pages, rotate left/right, delete (with undo).
- Save and Save-As for the modified document.
- A clear modified-state indicator on the document tab.

**Success criteria**

1. Merging two sample PDFs produces a file whose pages are A-then-B in the expected order;
   the output opens correctly in an external reader (verified by re-opening it in TFlex with
   correct page count and text extraction).
2. Splitting pages 10–20 of the long sample produces an 11-page PDF that opens correctly.
3. Dragging a thumbnail reorders pages; rotate and delete apply correctly; undo restores.
4. Save-As writes a valid PDF; reopening it in TFlex shows the reorganized pages.
5. The tab shows modified state after any change and clears after save.
6. Unit tests for merge, split, reorder, rotate, delete and undo in the PDF engine pass.
7. E2e tests cover merging two documents and reordering pages via drag — and pass.

### Phase 3 — Annotation

**Features**

- Text markup: highlight, underline, strikethrough — applied by selecting text, with color
  choice.
- Freehand pen (color, width), text boxes, and shapes: rectangle, ellipse, arrow.
- Sticky-note comments attached to a page location, with an editable note.
- An annotations panel listing all annotations of the document; clicking one scrolls to it;
  annotations can be edited (color, content) and deleted.
- Annotations are written into the PDF itself (standard PDF annotation objects) so they
  appear when the file is opened in other readers; saving persists them.

**Success criteria**

1. Each annotation type can be created on a page and renders correctly at every zoom level.
2. Text markup anchors to the selected text and stays aligned after zoom and scroll.
3. The annotations panel lists every annotation; selecting one navigates to it; editing and
   deleting work.
4. After Save-As, annotations survive: reopening the file in TFlex shows them, and they are
   present as real annotation objects in the saved file (verified by parsing, e.g. with
   pdf-lib, in a unit test).
5. Unit tests for annotation create/edit/delete and PDF serialization pass.
6. E2e tests cover highlighting text, adding a sticky note, saving and reopening — and pass.

### Phase 4 — Forms and signatures

**Features**

- AcroForm detection: form fields (text, checkbox, radio group, dropdown, list) become
  fillable in the viewer with appropriate editors.
- Filled forms save with values intact (still editable on reopen) and can optionally be
  flattened (values baked in, fields removed) on Save-As.
- Signatures: create by drawing (pointer) or typing (rendered in a script style); place,
  move, resize and delete a signature on any page; saved signatures list for reuse
  (stored locally).
- Signed documents save correctly; optionally flattened.

**Success criteria**

1. Opening the sample form shows every field as fillable with a type-appropriate editor;
   filling and saving preserves values on reopen.
2. Flattening produces a PDF with the values visible but no form fields (verified by
   parsing the saved file).
3. A drawn signature can be placed, moved, resized and saved; it appears in the output file
   as page content.
4. A saved signature can be reused on another page without redrawing.
5. Unit tests for form read/write, flatten, and signature placement pass.
6. E2e tests cover filling the sample form, signing it, saving and reopening — and pass.

### Phase 5 — Final quality gate

**Work**

- A look-and-feel pass over the whole app in both themes.
- The full unit and e2e suites, with coverage measured.
- A complete walkthrough of the running app with screenshots of every screen in both
  themes.
- An adversarial review of the finished product, including hostile PDFs from
  `test-fixtures/`.
- A packaged-build verification: install the produced installer (or run the portable
  build) and repeat the smoke walkthrough there.
- Performance re-verified against the budget and recorded.

**Success criteria**

1. Full unit suites pass with at least 80% statement coverage in `src/main` (PDF engine)
   and meaningful coverage in the renderer core logic, reported by the test command.
2. The full e2e suite passes against the real running app.
3. Every feature in this document has been exercised in the running app with inspected
   screenshots in both themes; no errors in the console during the walkthrough.
4. The adversarial review record exists; every finding is fixed or rejected with a written
   reason; all suites pass on the final build.
5. The packaged build passes the same smoke walkthrough.
6. Performance budget numbers are met and recorded in `PERFORMANCE.md`.

## Final success criteria

The project is complete, and the Coding Agent may stop, when **all** of the following are
true:

- A non-technical person can install TFlex on Windows from the produced installer (or run
  the portable build) and use it without instructions beyond the welcome screen.
- Viewing, search, tabs, themes; merge/split/reorder/rotate/delete/extract with undo; all
  annotation types with an annotations panel; and form filling, flattening and signatures —
  all work as described, and all changes save correctly to real PDF files that open in
  other readers.
- The performance budget is met and recorded.
- The look-and-feel rules are met in both themes and none of the avoid-list appears.
- All unit tests pass at the coverage target and the full e2e suite passes.
- The adversarial record exists, every finding is fixed or rejected with a written reason,
  and all suites pass on the final packaged build.
- **Most importantly: the product has been validated by using it end to end as a real user
  would — opening, organizing, annotating, filling and signing real PDFs, in both themes,
  on the packaged build, with every screen visually inspected. Passing tests is necessary
  but NOT sufficient.**
