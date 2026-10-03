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

### Current-scope supersession

The original v1 exclusions above describe the first release. A later numbered phase that
explicitly adds a capability supersedes the matching exclusion for the current project.
Therefore Phases 9–11 authorise their specified create/export, edit, and OCR work; Phase 6
authorises the OTA release workflow. Phases 44–52 authorise the accounts/cloud-sync,
digital-publishing-surface and encrypted-PDF work they specify. **Phases 53–57 authorise the
universal file-format program: they supersede the original "No PDF creation from scratch or
from other formats (docx, images)" exclusion and the PDF-only import assumption, for exactly
the formats and directions those phases list and no others.** All other original exclusions
remain in force — in particular the app remains Windows-only, still ships no login/licensing
of its own beyond the Phase 44 accounts surface, and the conversion pipeline makes no network
calls (Phase 53 success criterion 7 makes that testable).

Where a later phase sets a visual or motion rule that differs from the general look-and-feel
guidance, the later phase controls for that feature. In particular, Phase 14's glass motion
may use its stated 200–400 ms spring transitions; all unrelated UI keeps the 150–250 ms,
non-bouncy baseline.

**Phase 35 supersedes the wallpaper show-through.** The operator requires standard Windows window
behaviour (double-click maximise, Aero Snap to the top/left/right edges, and an auto-hide taskbar that
reveals on hover). `transparent: true` makes the window a Windows layered window, which breaks those
behaviours and swallows the taskbar hover, so Phase 35 retires Phase 14's "desktop wallpaper shows
through the window" behaviour in favour of an opaque window whose frosted chrome diffuses the app's OWN
ambient background. The frosted/glassy look and its motion rules stay in force; only the source of the
translucency changes (the app's background instead of the desktop).

**Phase 57 supersedes the installer-size budget (operator ruling, 2026-09-30).** The Performance
budget's fifth bullet, "Installer size: under 150 MB." (the Performance budget section), is
**WITHDRAWN**. Meeting that ceiling had required pruning renderer-only dependency trees and their
transitive leaves out of the packaged `app.asar`; the operator judged the risk of a shipped feature
silently missing a module to be worth more than the size constraint, and directed that the prune be
reverted rather than tightened. There is now **no installer- or portable-size ceiling**. The builder
must still ship every dependency the main, preload and renderer code needs, and must still produce a
working NSIS installer and portable build (a broken or missing artifact remains a HIGH defect).
Installer and portable byte sizes are still **recorded** in `PERFORMANCE.md` for the record, with no
pass/fail budget. Consequently Phase 57 feature D's "remain within the installer-size budget" clause
and Phase 57 success criterion 6's "the recorded installer size ... inside the budgets in this
document" clause are superseded **in that one respect only**: the packaged matrix walkthrough and the
cold-start, 500-page-open and idle-memory budgets remain in force unchanged.

**Phase 57 TASK-6 triage is in scope (operator ruling, 2026-09-30).** The triage findings filed at the
Phase 57 close are promoted from deferred to in-scope work: the `exportText` `/ToUnicode` mis-decode
and the Flatten-undo geometry loss must be fixed and closed, not deferred, notwithstanding their
pre-existing origin.

**Phase 69 supersedes the ONE-ACCENT colour clause and the Phase 49 artwork (operator request via
TFL-120, 2026-10-01).** The "Look and feel" rule below that fixes the app's single accent at
`#2563eb` (blue 600) — and its "avoid ... purple-dominated themes" caution — is superseded by the
operator's explicit direction to match the Jovrel "Halo" brand: the single accent becomes the brand
**violet** family per Phase 69, implemented with restraint (one hue, the existing theme lightness
discipline, the brand gradient reserved for the mark and the loader). Phase 69 also replaces the
Phase 49 (blue "triple-stroke J") mark, wordmark treatment, PDF file-type icon and `.ico` set with
the operator's final Halo kit; the Jovrel NAME, `productName`, the internal `appId: com.tflex.app`
and the Phase 49 userData migration are unchanged. The Phase 69 regression oracles supersede the
Phase 49 mark-geometry assertions (`test/unit/renderer/phase49Brand.test.tsx` and the mark-geometry
half of `e2e/phase49_brand_gate.spec.cjs`).

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

## Version numbering (Phase 6 onward)

From Phase 6 the semver series is active: **v1.1.x**. Retrospemptive naming of v1
deliverables: v1.0.0 for the original gate closure (Phases 1-5). From now on
`package.json.version` always matches the next tag. Tag names like `v1.1.0`,
`v1.1.1` etc; incrementing through included build metadata when needed.

## Phase 6 — Tab UX, tools palette, menus, color picker, OTA updates, auto-git-push

**Planned first; fixes to land before features are declared green:**

1. BUG — tab click frozen/unresponsive (React handler/state) — reproduce and fix source.

Features and success criteria:

1. Empty tabs: "+" control to create an empty tab; opening a PDF fills it; closing
   returns to the previous tab. Success: "+ tab->" stay alive in welcome/-empty tab and
   closed returns to prior tab as evidenced by e2e.
2. Tools palette right-side panel (icon+label list/grid toggle persisted) containing
   merge/split/extract/rotate/delete/sign/forms entries. Success: panel opens; modes
   persist across restart via settings; e2e verifies.
3. Standard app menu: File (Open/Merge/Save/SaveAs/Recent/Close-Tab-Exit), View, Edit,
   Tools, Window, Help/About with version badge, Preferences (theme default, recents
   limit, storage). Success: menu rendered with existing single-source handlers;
   accelerators work; About reports app version for OTA surface.
4. Annotation color UX: active-tool swatch as rounded square under the tool; opens
   color palette with preset+full picker (hex/RGB); persisted per theme. Applies to
   highlight/ink/underline/strikeout/note/shapes. Success: e2e picks custom color and
   persists.
5. OTA updates: electron-updater in main via updateService, IPC status/download/install,
   About+toolbar indicator; silent download+prompt restart; portable build explicitly
   no-auto-update (documented); private repo credentials not committed. Success: bump
   version then simulated/published release surfaces "Update available" in app.
6. Release pipeline: after a full green loop (build, unit+e2e, package checks) for a
   phase/fix batch, git-agent tags v1.x.x (`npm version <level> --no-git-tag-version`,
   commit bump, `git tag`, then push) **only after explicit operator authorisation in the
   current session**. Success: tag lands only on green builds, and the pushed tag's
   `package.json` version matches the local working copy.

Repo-safety amendments:
- Prune duplicate reduntant e2e/unused harnesses before first commit; no new debug
  files under e2e/ or root.
- .gitignore additions: .env, test-results/, screenshots/, test-fixtures/*.pdf never
  pushing-kill exceptions (qa/adversary-authored README/MD inside those dirs still OK).
- Unused harnesses named harness.cjs/harness.js/retest_harness.cjs/retest_rework*
  purge as part of P6 gate.

Completion demands: all Phase-6 green; tag v1.x.x pushed; OTA verified by a version
bump against tanzimtipu/tflex-releases (release artifacts in the public releases repo,
source-only commits stay in the private tanzimtipu/TFlex repo); thumbnails/screenshots included per gate; timing per
performance budget as RECheckWise for the new tab-switch/palette work.

### Phase-6 no-op remediation checklist (required to close Phase 6)

These bugs came out of the Phase-6 extension scope. qa files one DEF each (severity
tagged inline/in parentheses), frontend/backend:frontend-dev owns renderer fixes
(except #3 export and #2 sign where the backend path is implicated; coordinate via
shared contract). qa defines entry, developer fixes, qa verifies → CLOSED. Each of
these must be verified together with the CONTROL-INDEX per phase rule and a no-op
sweep + silence attack audit before Phase 7 is allowed to start:

1. The "+" for new tab visible on empty workload. It must only appear when at least
   one tab exists. — LOW.
2. Sign inside PDF returns "Item not found" — the promised new flow returns a
   failure at engine/driver level. HIGH.
3. Word export saves as an image (.docx containing a page rendered as picture); it
   must contain editable text. HIGH — backend chose wrong export path.
4. Click Edit then select text: the canvas goes blank. HIGH (silent canvas crash).
5. Left-pane page selection reverts to page 2 of the long PDF. HIGH.
6. Rotate page click: no-op. HIGH.
7. Delete page click: no-op. HIGH.
8. Highlight color default shows white; must be the accent blue (#2563eb). MEDIUM.
9. Crop function click: no-op. HIGH.
10. Stamp "place on page" click: no-op. HIGH.

## Phase 7 — Phase-6 fixes (must land before Phase 8 features)

**Fixes (target the source, not workarounds):**

1. Color palette: replace the hex/RGB text-input picker with a visual color picker —
   hue/saturation gradient pad, hue slider, optional swatch grid, and the current-color
   preview. Preset swatches remain as quick-picks; the custom picker appears inline
   (not as a dialog) when the user selects "Custom…" from the swatch row. Applies to
   all annotation tools. Persisted per theme.
2. "+" add-tab control: move from the far right of the tab bar to immediately after
   the rightmost open tab (always adjacent to the last tab). Clicking "+" opens an
   empty tab; the control re-attaches to the new rightmost tab.
3. App menu: the Phase-6 standard menu (File/View/Edit/Tools/Window/Help/About/
   Preferences) is not visible in the running app. Diagnose why (missing
   `Menu.setApplicationMenu`, wrong platform assumption, or registration missing in
   `start()`) and fix so the menu bar renders on Windows with all items functional.

**Success criteria:**

1. Palette: visual gradient picker picks a custom color and persists per theme; unit
   tests cover the picker state model; e2e exercises a custom-color round trip.
2. "+": adjacent placement verified visually (screenshot) and by e2e (open 3 tabs,
   verify control sits after tab 3).
3. Menu: menu bar renders on Windows; every menu item triggers its handler; e2e drives
   File→Open and Preferences→theme-default.
4. No regressions: full unit + e2e suites green.

**Settings impact:** none (reuse Phase-6 `annotationColors` and existing fields).

## Phase 8 — Optimize (file size reduction)

**Features**

- Reduce file size action: one-click "Reduce file size" (image downsample/recompress,
  font subsetting, discard objects, cleanup) with a quality preset choice
  (screen/ebook/printer/press).
- Audit space usage: dialog showing percentage breakdown of the file by element type
  (images, fonts, content streams, metadata).
- Fast web view (linearize) toggle on Save-As.

**Success criteria**

1. Reducing a 20MB sample PDF produces a measurably smaller file that re-opens
   correctly with identical page count and text extraction.
2. Audit dialog shows a plausible breakdown for a real file; numbers are reproducible.
3. Unit tests for optimizer pipeline round-trip; e2e covers reduce+audit+reopen.

**Settings impact:** `optimizePreset?: 'screen'|'ebook'|'printer'|'press'` (default
`'ebook'`; validation: preserve-if-valid enum, reject-if-invalid; transported via
AppSettings IPC; used by the optimizer action and saved per-document? No — global).

## Phase 9 — Create + Export

**Features**

- Create PDF from images (JPEG/PNG) and from clipboard content; insert resulting pages
  into open document or new tab.
- Export PDF pages to images (JPEG/PNG/TIFF) with resolution choice; export text to
  plain text/RTF; export whole PDF to Word (.docx) via a bundled converter (offline).
- Insert blank page; insert from another PDF at a chosen position.

**Success criteria**

1. Creating a PDF from 3 sample images produces a valid PDF that opens in TFlex with
   correct page count and dimensions.
2. Exporting a page to PNG at 150 DPI produces a viewable image; text export preserves
   reading order for the sample report.
3. Insert-blank and insert-from-PDF round-trip correctly in unit tests and e2e.

**Settings impact:** `exportImageFormat?: 'png'|'jpeg'|'tiff'` (default `'png'`);
`exportImageDpi?: number` (default 150, range 72–600); `createImageQuality?: number`
(default 85, range 10–100). All validated preserve-if-valid.

## Phase 10 — Edit content (text and images in place)

**Features**

- Edit existing text: click into a text run, change/replace/delete with font metrics
  preserved (font, size, color, baseline); reflow within the original bounding box.
- Add new text box on any page with font/size/color choice.
- Edit images: move/resize/replace/crop embedded images.

**Success criteria**

1. Editing a word in the sample report produces a PDF that opens in an external reader
   with the change visible and no layout shift.
2. Round-trip: edit → save → reopen shows the edit; text extraction reflects it.
3. Unit tests for text-run replacement and image crop; e2e for the full edit-save-reopen
   loop.

**Settings impact:** `editDefaultFont?: string` (default `'Helvetica'`; validation:
string from a bundled allowlist, preserve-if-valid).

## Phase 11 — OCR (recognize text)

**Features**

- Recognize Text action on a scanned PDF: searchable-image output (text layer behind
  the image) with language choice and downsample option.
- Batch OCR via the tools palette on multiple open documents.
- Fix OCR suspects: list low-confidence words with click-to-correct.

**Success criteria**

1. Running OCR on the scanned-style sample makes its text searchable (search finds a
   known word) and selectable; saved file re-opens with the text layer intact.
2. Batch OCR on two scanned files completes without UI freeze; progress is reported.
3. Unit tests for OCR engine integration; e2e for search-after-OCR.

**Settings impact:** `ocrLanguage?: string` (default `'eng'`; validation: ISO-639
code from a bundled allowlist, preserve-if-valid); `ocrDownsample?: number` (default
300, range 72–600).

## Phase 12 — Residual page-organize + annotate parity

**Features**

- Replace pages (swap pages from another file, retaining links/bookmarks); renumber
  pages (logical page labels, sections); crop pages (CropBox/TrimBox control).
- Callout text boxes; stamps (built-in palettes + custom stamp creation); comment
  import/export (FDF/XFDF local files).

**Success criteria**

1. Replace-pages on the sample report retains its outline and links; output opens
   correctly.
2. Crop a page and verify dimensions change in the saved file.
3. Stamps render at every zoom; comment export produces a valid FDF that re-imports.
4. Unit tests for replace/renumber/crop/stamp/FDF; e2e for the user-visible flows.

**Settings impact:** `defaultStampId?: string` (default `'APPROVED'`; validation:
string from a bundled allowlist, preserve-if-valid).
## Phase 13 — UX polish: borderless window + professional color

**Features**

1. Borderless app window (frame: false) with a custom title bar (drag region,
   window controls min/max/close wired through existing IPC), modern industry-
   standard styling, smooth animations (150-250ms ease-out per existing design
   rules).
2. Professional color: UI text and icons pop against the neutral base with
   intentional semantic color (info/success/warning/error, action accent,
   annotation colors) rather than a flat all-gray palette. Both themes equally
   considered.

**Success criteria**

1. App launches frameless with a custom title bar that drags and window controls
   that work; no OS chrome visible.
2. The installer window also appears borderless/modern (electron-builder NSIS
   appearance configured to the extent it supports; document limits).
3. Typography and icons are visibly more readable and colorful in both themes,
   while keeping the single accent color rule for primary actions; no emojis,
   proper icon set throughout.
4. Unit tests for the title bar state + any new renderer reducers; e2e covers
   frameless launch + window controls + theme colors; performance budget
   re-timed (cold start, long-doc open) and unchanged or improved.

**Settings impact:** none (theme already stored; this phase refines it).

## Phase 14 — Liquid Glass theme with frosted glass effects

**Features**

1. **Frosted glass theme**: Replace solid backgrounds with translucent frosted glass that reveals the desktop wallpaper behind the app window. Use CSS `backdrop-filter: blur()` with appropriate opacity and background colors.

2. **Tool descriptions restored**: Tools panel shows icon + title + description text for each tool (e.g., "Merge PDFs" / "Combine multiple PDFs..."). Never icon-only in this view.

3. **Dynamic panel sizing**: Tools panel width adjusts dynamically to accommodate full tool descriptions without truncation or congestion. Panel can be wider than current fixed width.

4. **iOS liquid glass animations**: Implement spring-based, fluid animations for:
   - Panel open/close transitions (spring physics, not linear)
   - Tool item hover states (subtle scale/glow)
   - Background parallax/subtle movement
   - Window focus/defocus blur intensity changes
   - Smooth 200-400ms transitions with ease-out-spring curves

5. **Visual polish**: Gradient background hints, subtle inner shadows, rounded corners on panels (16-20px), consistent frosted glass across title bar, side panels, and tool panels.

**Success criteria**

1. Desktop wallpaper shows through frosted glass backgrounds; blur intensity is pleasant and readable.
2. Tools panel displays icon + title + description for every tool; text is fully visible and not truncated.
3. Panel width accommodates content without congestion; user can see full descriptions.
4. Animations feel fluid and springy (iOS-style), not mechanical; all transitions complete smoothly.
5. Light/dark/frosted themes all implement glass effects appropriately.
6. Performance: no frame drops during animations; 60fps maintained.
7. Unit tests for animation state; e2e verifies glass theme renders and animations complete.

**Settings impact:** none (theme already stored; this phase enhances the frosted glass variant).

## Phase 14.1 — Liquid Glass CORRECTION (Visual Refinement)

**Purpose:** Correct the Phase 14 implementation to properly match the Liquid Glass reference image. The current implementation incorrectly interprets Liquid Glass as "blue + transparent." This correction establishes proper material design.

**CORRECTION PRIORITIES:**

### 1. TOP BAR HIERARCHY (Most Critical)
Create THREE horizontal surfaces with CONSISTENT design:
- **Title/Tab Bar**: Document tabs, new tab, window controls
- **Primary Command Bar**: Open, navigation, Save, zoom, primary actions
- **Context Toolbar**: Annotation tools (only when editing)

Requirements:
- Standardized heights using tokens: `TitleBarHeight`, `CommandBarHeight`, `ToolbarHeight`
- Consistent vertical centering across all bars
- Control groups with glass capsule backgrounds
- 8px-based spacing system
- NO arbitrary heights based on content
- NO misaligned controls

### 2. NEUTRAL FROSTED GLASS (Not Blue)
Primary glass material must be NEUTRAL:
- White/gray translucent base
- Subtle backdrop blur
- Restrained saturation
- 1px luminous edge highlight
- Soft inner highlight
- Blue is ACCENT ONLY for:
  - Selected states
  - Active tools
  - Focus indicators
  - Primary actions (Open button)

### 3. SHARED GLASS SIDEBAR COMPONENT
Create `GlassSidebar` component used by BOTH panels:

**Shared tokens:**
- `GlassSidebarBackground`
- `GlassSidebarBorder`
- `GlassSidebarBorderRadius` (14-18px)
- `GlassSidebarShadow`
- `GlassSidebarHeaderHeight`
- `GlassSidebarContentPadding`

**Pages Sidebar (Left):**
- "Pages" header with toggle
- Floating glass card with margins
- Thumbnails with rounded selection (not blue rectangle)
- Selection: thin accent outline + subtle glow
- Thumbnail content remains opaque (PDF accurate)

**Tools Sidebar (Right):**
- "Tools" header with view toggle
- Same glass material as Pages
- Tool rows: neutral glass, hover highlight, selected tint
- Icon colors preserved
- Full descriptions visible

### 4. FLOATING PANELS WITH MARGINS
Both sidebars must:
- Float above workspace with consistent margins (16px)
- NOT be flush to window edges
- Have outer rounded corners
- Cast soft elevation shadow
- Feel like inspector panels

### 5. TOOLBAR CONTROL GROUPING
Group related controls into glass capsules:

Example groups:
- Navigation: `[<] [1/34] [>]`
- Actions: `[Save] [Open]`
- Zoom: `[-] [307%] [+]`
- Tools: `[pointer|hand|text|box|image]`
- Document: `[Merge] [Split] [Sign] [More]`

Each group has subtle translucent background.
NO individual heavy buttons for every icon.

### 6. STANDARDIZED DIMENSIONS

**Spacing tokens (8px-based):**
- 4px = micro
- 8px = small
- 12px = control
- 16px = standard
- 24px = section
- 32px = major

**Corner radii:**
- Window: 18-22px
- Panels: 14-18px
- Control groups: 10-14px
- Buttons: 8-12px
- Pills: full

**Control sizes:**
- Visual height: 32-38px
- Hit target: 36-44px

### 7. MATERIAL HIERARCHY
Create material tokens:
- `GlassChrome` - Title/command bars
- `GlassSidebar` - Left/right panels
- `GlassControlGroup` - Toolbar capsules
- `GlassControlHover` - Interactive hover
- `GlassSelection` - Selected items

Each has:
- Blur amount
- Opacity
- Border intensity
- Shadow
- Highlight

### 8. EDGE CHARACTERISTICS
All glass surfaces need:
- Top-edge luminous highlight
- 1px translucent border
- Soft inner highlight
- Soft outer shadow
- NO obvious white outlines

### 9. PDF ISOLATION (Preserve)
- PDF canvas: completely opaque
- NO blur/opacity/tint on PDF
- PDF thumbnails: opaque
- Only UI gets glass treatment

### 10. DOCUMENT WORKSPACE
- Neutral, quiet background
- Low saturation
- Does not compete with PDF
- Subtle material variation only

**Success Criteria**

1. Three top bars with consistent heights and alignment
2. Glass is primarily neutral, not blue
3. Left and right sidebars match in material and treatment
4. Both panels float with 16px margins
5. Toolbar controls grouped in glass capsules
6. Spacing follows 8px system
7. Corner radii standardized per hierarchy
8. Material system with edge highlights
9. PDF remains completely opaque
10. Side-by-side comparison matches reference

**Settings impact:** none (visual correction only).

## Phase 14.2 — Liquid Glass Polish (Remaining Issues)

**Purpose:** Address remaining visual polish issues from user feedback.

### 1. ANNOTATION BAR SIZE CONSISTENCY
**Issue:** Annotation bar is not same size as top bars
**Fix:** 
- Context annotation bar must match `--chrome-commandbar-h` (52px)
- Same material as command bar
- Consistent vertical centering
- Everything below fills entire app window

### 2. UNIFY PANELS WITH REST OF UI (ALL THEMES)
**Issue:** Left/right panels disconnected in frosted glass; look unified in dark/light
**Fix:**
- Apply same panel styling across ALL themes
- Panels should feel connected to main UI, not floating islands
- Consistent borders, shadows, spacing across themes
- Dark/light themes: panels should also adjust page view dynamically

### 3. OPEN BUTTON VISUAL
**Issue:** Open button has overlapping element with blue icon on top
**Fix:**
- Remove background overlap
- Clean single-layer button
- Blue accent only, no ghost element

### 4. DYNAMIC PAGE VIEW ADJUSTMENT (ALL THEMES)
**Issue:** Only frosted glass adjusts page view; dark/light don't
**Fix:**
- Light theme: page view adjusts when panels open/close
- Dark theme: page view adjusts when panels open/close
- Same responsive behavior as frosted glass

### 5. SMOOTH ANIMATION FOR PANEL/PAGE ADJUSTMENT
**Issue:** Clunky animation - panel collapses first, then page adjusts
**Fix:**
- Simultaneous animation of panel AND page view
- Use CSS transitions with `transition: width 0.3s ease, margin 0.3s ease`
- Both elements animate together, not sequentially
- Smooth 300ms ease-out

### 6. INCREASE ICON SIZES
**Issue:** Icons too small
**Fix:**
- Increase toolbar icons from ~16-18px to ~20-24px
- Command bar icons: 20px minimum
- Sidebar icons: 20px minimum
- Maintain proper hit targets (40px)

### 7. REPLACE THREE DOTS WITH "ALL TOOLS" ICON
**Issue:** Three dots (⋯) unclear
**Fix:**
- Replace with distinct "All tools" icon
- Use grid/layout icon or tools/wrench icon
- Clearly indicates tools panel

### 8. REDUCE EMPTY SPACE IN FROSTED GLASS PAGE VIEW
**Issue:** Too much margin around PDF in frosted glass
**Fix:**
- Mimic dark/light theme page positioning
- Tighter margins around document
- Page takes more available space
- Keep 16px minimum for floating aesthetic

**Success Criteria**

1. Annotation bar matches top bar height (52px)
2. Panels unified with UI in all themes (not disconnected)
3. Open button clean, no overlap
4. All themes dynamically adjust page view
5. Smooth simultaneous panel/page animations
6. Icons increased to 20-24px
7. "All tools" distinct icon (not three dots)
8. Frosted glass page margins match dark/light
9. No visual regressions in any theme
10. User approves final result

**Settings impact:** none (polish fixes only).

### Phase 15 — Cross-Theme Animation System

**Features**

- Centralized motion token system: CSS custom properties (`--motion-duration-*`, `--motion-ease-*`, `--motion-scale-*`) and a matching JS constants file (`motionTokens.ts`) consumed by all animated surfaces.
- Named animation wrappers/components: `AnimatedDialog` (bloom in/out), `AnimatedPanel` (slide in/out), `AnimatedTab` (crossfade + liquid glide), popover hooks (`usePopAnimation`), scale hooks (`useScaleAnimation`).
- Theme crossfade: a 400ms View-Transitions-based (or CSS-class fallback) crossfade on every theme switch; PDF page content is excluded from all transitions.
- Uniform motion across light/dark/frosted themes — only visual properties (shadow, highlight) differ; timing and easing stay identical.
- Reduced-motion support: all JS-driven springs and CSS transitions degrade when `prefers-reduced-motion: reduce` is active.
- Performance target: all animations stay within a 16ms frame budget and maintain 60fps.

**Success criteria**

1. Theme crossfade runs at ~60fps on a quiet workspace (measured via rAF sampling); no frame gaps exceed 33ms and the 400ms transition completes within its token duration.
2. Every pressable button family (`.btn`, `.tool-btn`, `.tab-new`, etc.) resolves the canonical `--motion-scale-press` token in its `:active` transform; no hardcoded scale values survive in the cascade.
3. The centralized token layer is wired to every animated surface named in the feature list: dialogs, panels, tabs, popovers, buttons, and thumbnails each consume the token system (not a parallel hardcoded preset).
4. Mid-session changes to the OS `prefers-reduced-motion` setting are picked up live: JS-driven springs collapse to instant state changes without an app restart.
5. Theme application does not trigger duplicate View Transitions or unhandled "Transition was skipped" pageerrors; at most one transition runs per user flip.
6. Unit tests cover the token constants, the animation hooks, and the component wrappers; e2e measures live fps and computed transform values.
7. No regressions: full unit + e2e suites green.

**Settings impact:** none.

### Phase 16 — Collapsible page panel with ruler mode

**Features**

- **Remove "Pages" title text** from the left sidebar header. The header shows only icon controls in a consistent layout.
- **Round/pill icon backgrounds** on every header icon in the left sidebar: the view-toggle icons (thumbnails, annotations, bookmarks) and the new collapse/expand icon all sit inside matching round glass-pill backgrounds (`glass-control-group` or `glass-icon-pill` treatment), matching the command bar's capsule style.
- **Collapse icon** on the left sidebar header: a chevron-left (or panel-left-close) button that collapses the entire left panel.
- **Collapsed ruler mode**: when collapsed, the left panel shrinks to a narrow vertical strip (~48px wide) that shows only page numbers stacked vertically. No thumbnails, no scroll bar chrome — just the numbers in the current theme's text color. The strip has a subtle separator border against the workspace.
- **Current-page highlight in ruler mode**: the number of the page currently visible in the main workspace is highlighted with the accent color (`#2563eb`) and/or bold weight so it stands out from the other numbers.
- **Click-to-jump in ruler mode**: clicking any page number in the ruler jumps the main workspace to that page (same behavior as clicking a thumbnail in expanded mode).
- **Expand icon** on the collapsed strip: a chevron-right (or panel-left-open) button that expands the panel back to full thumbnail view.
- **Panel state persistence**: the collapsed/expanded choice survives app restart.
- **Consistent animations**: the collapse and expand transitions use the centralized token system (Phase 15):
  - Panel width change: `AnimatedPanel` slide/resize with `--motion-duration-panel` (280ms) and `--motion-ease-layout` easing.
  - Page number appearance/disappearance: opacity + slight scale, not a hard cut.
  - Ruler number hover/focus: the standard `LiftMotionProps` hover lift (subtle, token-driven).

**Success criteria**

1. The left sidebar header shows zero text titles — only grouped round-background icons. The view tabs (thumbnails/annotations/bookmarks) and the collapse icon share the same pill background treatment.
2. Clicking the collapse icon shrinks the panel to the ruler strip within 280ms; the workspace reflows smoothly (page view adjusts, not overlapped).
3. In ruler mode: only page numbers are visible, rendered vertically, current page highlighted in accent color. Clicking a number jumps the workspace to that page.
4. Clicking the expand icon restores the full thumbnail panel within 280ms; the workspace reflows back.
5. The collapsed/expanded state persists across app restart (verified by closing and reopening the app).
6. No visual regressions in the thumbnail rail (drag reorder, rotate, delete, annotation panel, bookmarks panel) when expanded.
7. Unit tests for the collapse state reducer and ruler click handler; e2e covers collapse → ruler click → jump → expand cycle and persistence restart.
8. All animations resolved from the centralized motion token system; no hardcoded transition values in the collapse/expand CSS or JS.

**Settings impact:** `pagesPanelCollapsed?: boolean` (default `false`; validation: boolean, preserve-if-valid; transported via AppSettings IPC so the state survives restart).

## Phase 17 — PreferencesDialog redesign and enhanced settings

**Features**

- **PreferencesDialog redesign**: Simplified UI with a single panel layout instead of a sidebar navigation. The dialog now uses a cleaner, more streamlined layout with categorized sections.
- **Enhanced settings management**: All settings are now displayed in a single view with clear grouping by category (Appearance, Recent files, Storage locations).
- **Theme settings**: Direct control over the application theme (Light, Dark, Frosted, System default) with immediate visual feedback.
- **Recent files management**: Configuration for the maximum number of recent files to track.
- **Storage location information**: Clear display of user data, settings, and signatures storage paths.

**Success criteria**

1. The PreferencesDialog displays settings in a clean, single-panel layout without sidebar navigation.
2. All settings categories (Appearance, Recent files, Storage locations) are clearly visible and organized.
3. Theme selection works correctly with immediate visual feedback.
4. Recent files configuration works properly with input validation.
5. Storage location information is displayed correctly.
6. Unit tests for the new PreferencesDialog implementation pass.
7. E2e tests cover the redesigned PreferencesDialog functionality.

**Settings impact:** none (existing settings are preserved but with new UI layout).

## Phase 18 — Watermark (text or image overlay)

**Features**

- **Text watermark**: Add arbitrary text across pages with typography, transparency, and position/tile options.
- **Image watermark**: Stamp an image across pages with positioning, sizing, and transparency controls.
- **Position control**: Place watermarks at any position on the page using coordinates or predefined positions (top-left, top-center, top-right, center-left, center, center-right, bottom-left, bottom-center, bottom-right).
- **Transparency control**: Adjust watermark opacity from 0% (invisible) to 100% (opaque).
- **Tile option**: Repeat watermarks across the page to create a seamless pattern.
- **Typography options**: Choose font family, size, color, and style (bold, italic, underline) for text watermarks.
- **Page range selection**: Apply watermark to specific pages or all pages of the document.
- **Watermark preview**: Real-time preview of watermark appearance before applying.
- **Delete watermark**: Remove a specific watermark by ID from a document.

**Success criteria**

1. Text watermarks can be added to PDF pages with customizable typography and positioning.
2. Image watermarks can be added to PDF pages with positioning and transparency controls.
3. Watermark preview works in real-time before applying.
4. Watermark can be applied to specific pages or all pages of the document.
5. Watermark transparency and tiling options work correctly.
6. Watermark positioning works with both coordinate-based and predefined position controls.
7. Unit tests for watermark creation and application pass.
8. E2e tests cover creating, previewing, and applying watermarks.
9. Watermarks can be deleted by ID.

**Settings impact:** none (this feature is implemented as part of the annotation tools, similar to stamps and callouts).

## Phase 19 — Annotation tools move into the CommandBar (MRU five + all-tools dropdown)

**Supersession note:** this phase deliberately retires the separate annotation chrome row introduced
by the Phase 14.2 layout (`.ann-toolbar` as its own 52px row below the CommandBar). The annotation
tools now live INSIDE the CommandBar as one grouped pill; the freed row height returns to the page
view. The Phase 14.2 styling rules (CommandBar primitive, shared height token, tool-btn ladder) stay
in force for the group itself — only the second row is retired.

**Features**

- **One bar, one group**: the annotation tools render inside the CommandBar (`.toolbar`) at its right
  end, after the existing Tools group, as a single `GlassControlGroup` pill built from the CommandBar's
  own primitives (`tool-btn`, `toolbar-sep`, the 22px glyph ladder) so the bar reads as one chrome
  system. The separate `.ann-toolbar` row is removed and its height is returned to the page view.
- **Five visible tools**: the group shows exactly five tool buttons by default, ordered
  **most-recently-used first**. Using any annotation tool (from the visible five or from the dropdown)
  immediately promotes it to the first visible position.
- **Colour selector**: the existing annotation colour swatch + popover picker moves into the group
  immediately LEFT of the dropdown arrow, keeping today's rules (shown for colour-capable tools,
  hidden otherwise).
- **Dropdown (all tools)**: a single arrow button at the far right of the group opens a menu listing
  **all eleven tools** in today's six groups — Select; Text markup (highlight / underline /
  strikeout); Pen (ink); Text box; Shapes (rect / ellipse / arrow / callout); Note. Selecting one arms
  it. Keyboard: Arrow keys move, Enter arms, Escape closes; it also closes on outside click and on
  re-click of the arrow. `aria-haspopup` / `aria-expanded` reflect the state.
- **Pen width**: the ink-only pen-width row moves into the dropdown panel (shown when Ink is active);
  no other tool consumes pen width.
- **Persistence**: the MRU order survives app restart.
- **Consistency**: the dropdown uses the centralized popover motion (`usePopAnimation`); the tool
  buttons use the existing hover-lift / press tokens; identical timing across light / dark / frosted;
  no hardcoded animation values; the existing disabled states (Edit mode open, Pan active) and their
  explanatory tooltips are preserved.
- **Stable hooks**: every tool button (visible and in the dropdown) keeps `data-tool="<id>"`; the
  group keeps `data-annotation-toolbar`; new hooks `data-ann-tools-visible`,
  `data-ann-dropdown-toggle`, `data-ann-dropdown-menu`, `data-ann-color` let the e2e specs address the
  new structure without rewriting their intent.

**Success criteria**

1. No annotation row exists below the CommandBar; the tools render inside the CommandBar as one
   grouped pill at its right end, and the page view gains the freed height (no overlap, no clipped
   page slot).
2. Exactly five tool buttons are visible by default, ordered most-recent-first.
3. Arming a tool that is not among the visible five (chosen from the dropdown) makes it the FIRST
   visible button on the next render, and the fifth-most-recent drops out.
4. The colour selector sits immediately left of the dropdown arrow and opens the existing picker
   popover; it follows today's colour-capable-tool rules.
5. The dropdown lists all eleven tools in the six groups; selecting one arms it; Escape, outside
   click and re-clicking the arrow all close it; Arrow keys + Enter work; `aria-expanded` is accurate.
6. The pen-width control is reachable from the dropdown panel when Ink is active.
7. The MRU order survives app restart (verified by an e2e restart run reading the persisted order).
8. Disabled/blocked states are unchanged: with Edit mode open or Pan active the tools are disabled
   and carry the existing explanatory tooltips.
9. Unit tests pass for the MRU ordering helper (promote-on-use, cap, dedupe, malformed input) and for
   the group rendering (five visible buttons, dropdown contents, colour placement).
10. E2e covers: the group inside the CommandBar with five visible tools; MRU reorder after arming a
    dropdown tool; dropdown open / select / close (all three close paths); the colour popover; the
    restart persistence; the absence of the old row and the page-view height gain.
11. All animations resolve from the centralized motion token system; no hardcoded transition values in
    the new CSS or JS.
12. Existing annotation e2e/unit specs that asserted `.ann-toolbar` are repointed to the new group and
    pass (the `data-tool` contract is unchanged).

**Settings impact:** `annotationRecentTools?: string[]` — default `[]`; validation:
preserve-if-valid / reject-if-invalid in `src/main/services/settings.ts` (must be an array of at most
6 known annotation tool ids — `select`, `highlight`, `underline`, `strikeout`, `ink`, `textbox`,
`rect`, `ellipse`, `arrow`, `callout`, `note` — deduplicated, most-recent-first; anything else is
rejected so the field falls back to the default); transported via the AppSettings IPC so the order
survives restart. The main-process validation lands before any renderer code reads the field.

## Phase 20 — Animation standard: morphing surfaces, animated resizes, no un-animated appearances

**Supersession note:** this phase supersedes the per-component entrance treatments wherever they
conflict: every surface that appears, grows, shrinks or is replaced by another surface now follows the
standard below, and the Phase-15 token set stays the only source of durations/easings/scales.

**Features**

- **Morphing dropdowns/menus (the "one element" rule)**: a menu/popover/dropdown must read as the
  trigger box GROWING into the expanded box. Concretely: the surface animates from the trigger's rect
  to the menu's rect (origin-aware scale + fade), `transform-origin` pinned to the trigger edge it is
  anchored to, the menu flush with the trigger (no gap, no offset shadow seam, no separate-window
  feel), and the reverse morph on close. Applies to every menu/popover/dropdown in the app
  (annotation tools menu, colour popover, theme popover, title-bar menus, page-zoom and any future
  one).
- **Animated context-window resize**: any window whose content swaps to a different size (e.g. the
  Sign tool's three tabs) animates its width/height change with the standard token duration/easing
  instead of jumping. Content cross-fades within the resizing frame.
- **Animated window-to-window swap**: when one window/surface is replaced by another (tab-to-tab,
  tool panel to tool panel, dialog to dialog where one closes as another opens), the outgoing surface
  transitions into the incoming one (crossfade + morph) rather than disappearing and popping.
- **No un-animated appearances**: no element in the app may appear, disappear, grow, shrink or be
  replaced without an animation from the centralized token system. Any surface found without one gets
  the standard treatment (a `data-no-anim` escape hatch is allowed ONLY for the PDF content layer and
  for `prefers-reduced-motion`).
- **Enforceable standard**: the standard is documented in this phase and pinned by a contract test
  (every popover/menu/dialog/panel class must resolve its enter/exit from the motion tokens); a
  `prefers-reduced-motion` path collapses the durations to the reduced token without changing
  structure.
- **Consistency**: identical timing in light/dark/frosted; transform/opacity (and layout-aware
  animation for size changes) only, no layout thrashing; 60fps target preserved; PDF content never
  animates.

**Success criteria**

1. Opening and closing any dropdown/menu/popover shows a morph from the trigger's rect with no gap
   between trigger and surface, in all three themes (verified by frame sampling + screenshots).
2. The Sign tool's context window animates its size change when switching between its three tabs
   (measured: the frame's height/width interpolates over the token duration rather than jumping).
3. A window-to-window swap shows the outgoing surface transitioning into the incoming one (no frame
   where both are absent or both are fully painted at rest positions).
4. An inventory sweep of the app's surfaces (dialogs, popovers, menus, panels, floating toolbars,
   badges, toasts, banners) finds ZERO surfaces that appear/disappear without a token-driven
   animation; the inventory and its evidence are recorded.
5. The contract test fails when a surface's enter/exit is removed or hardcoded, and passes on the
   shipped tree.
6. Reduced motion collapses all of the above to the reduced-duration path with no structural change.
7. All new animations resolve from the motion tokens; no hardcoded durations/easings/scales.

**Settings impact:** none (uses the existing Phase-15 motion tokens; no new AppSettings fields).

## Phase 21 — Text properties panel (Word/Adobe-style text manipulation, replacing the floating toolbox)

**Supersession note:** this phase retires the floating inline text toolbox that appeared after
double-clicking a text-bearing tool. The editing surface becomes the left properties panel; the
in-canvas overlay keeps only the selection/drag affordances.

**Features**

- **Text properties panel**: a left-side panel (docked to the RIGHT of the thumbnail/page rail, on
  the same edge as the existing left panel) that appears whenever a text-bearing tool is selected or
  a text object is selected/created - text box, callout, sticky note, and the edit-text run editor.
  The page view reflows with animation to accommodate it (the same "page adjusts, never overlapped"
  contract the Tools panel follows).
  **Per-family control scope (settled 2026-09-19):** the FULL control set below applies to the
  TFlex-owned text objects (text boxes and edited text runs), whose style the engine draws. For
  ANNOTATION text objects (callout / sticky note / text-box annotation) the engine's annotation
  payload carries text colour only, so the panel opens for them, routes the colour control live, and
  renders every other control DISABLED with a tooltip naming the reason ("not supported for
  annotations - the annotation's text is baked by the annotation engine"). A disabled control must
  never silently no-op.
- **Word/Adobe-class controls** (researched from Adobe Acrobat's text-edit UI and Microsoft Word's
  font/paragraph groups): font family, font size, bold / italic / underline, text colour, highlight
  colour, superscript/subscript, character spacing where feasible, line spacing, paragraph alignment
  (left/centre/right/justify), bulleted/numbered lists, indent in/out, and clear-formatting. Every
  control applies live to the selected text object and persists in the panel while any text-bearing
  tool is active (one shared panel for all of them).
- **Live application + undo**: each change applies to the engine through the existing text-edit ops
  with the per-doc undo stack intact; a change that cannot be represented in the PDF (e.g. an
  unsupported font) must fail loud, not silently drop.
- **Selection-aware state**: the panel reflects the current text object's actual formatting when a
  text object is selected, and reverts to per-tool defaults when a new object is created.
- **Consistency**: the panel uses the standard panel animation (Phase 20), the existing panel tokens,
  and the app's control styling; disabled controls follow the app's disabled treatment with tooltips.

**Success criteria**

1. Selecting a text-bearing tool (or a text object) opens the left text panel; deselecting closes it;
   both animate and the page view reflows without overlap or clipping.
2. The panel exposes the full control list above; each control visibly changes the selected text and
   the change survives save + reopen (round-trip verified for at least: font family, size, bold,
   italic, underline, colour, highlight, alignment, line spacing, list style).
3. The floating double-click STYLE toolbox no longer appears for text-bearing tools; the panel is the
   only STYLE surface for them. The in-canvas editor keeps what is not styling - the drag grip, the
   text-content textarea, and the Confirm / Cancel / Delete actions - and no style control remains
   in-canvas (verified for the text box, callout, note and edit-text-run paths).
4. The same panel serves every text-bearing tool (text box, callout, note, edit-text run) and
   re-targets when tools/objects change: the full control set is live for TFlex-owned text objects
   (text boxes, edited runs) and, for annotation text objects, the colour control is live while every
   unsupported control is disabled with its reason tooltip (per the per-family scope above).
5. Undo/redo restores both the text and the panel's reflected state.
6. Unit tests cover the panel's control -> payload mapping and its selection-aware state; e2e covers
   open/close, the page reflow, and a save/reopen round-trip per control group.
7. Reduced motion and all three themes behave per the app standard.

**Settings impact:** none (the panel's visibility derives from the active tool; text defaults reuse the
existing `editDefaultFont` / annotation colour fields).

## Phase 22 — Title-bar Open + Save/Save As relocation

**Features**

- **Open and Save/Save As move to the title bar** (the bar that carries the TFlex logo and the PDF
  tabs): the two actions sit immediately to the RIGHT of the TFlex logo and to the LEFT of the tab
  strip, as one small grouped control that matches the title bar's material and metrics.
- The CommandBar keeps its page/zoom/view/annotate/edit/delete groups; the Open and Save buttons are
  removed from it (no duplicate controls anywhere).
- **Sizing/layout**: the relocated controls are sized to the title-bar ladder (not the CommandBar
  ladder), keep their existing accelerators (Ctrl+O / Ctrl+S / Ctrl+Shift+S), their aria-labels and
  their tooltips, and must not collide with the tab strip at the minimum window width (the tab strip
  scrolls instead).
- **State**: the Save control keeps its modified-dot / disabled semantics exactly as today.

**Success criteria**

1. The title bar shows Open and Save/Save As immediately right of the logo, left of the tabs, in one
   grouped control; screenshots in all three themes show it visually consistent with the title bar.
2. The CommandBar no longer contains Open/Save/Save As; no duplicate remains anywhere in the DOM.
3. Ctrl+O, Ctrl+S and Ctrl+Shift+S still work and the Save control still reflects the modified state
   and disables when there is nothing to save.
4. At the minimum window width the relocated controls stay reachable and the tab strip scrolls rather
   than clipping either.
5. Existing e2e/unit specs that addressed the CommandBar Open/Save selectors are repointed and pass.

**Settings impact:** none (pure layout relocation).

## Phase 23 — Animation off switch (setting + Preferences control)

**Features**

- **An "Animations" control in Preferences** (Appearance section) that turns the app's animations OFF
  entirely - not merely reduced. With it OFF, every motion collapses to the instant path app-wide:
  the Phase-20 morph, the Phase-21 panel reflow, the rail / panel slides, dialogs, popovers, menus,
  toolbars, toasts, tab transitions, the tools-palette resize and the theme crossfade all complete with
  no travel, scale or fade animation, while every end state and geometry stays identical to the
  animated path.
- **Effective motion policy**: animations run only when the setting is ON **and** the OS does not
  request reduced motion. `prefers-reduced-motion: reduce` always wins over the setting; the setting
  OFF forces the instant path regardless of the OS preference.
- **Immediate + persisted**: the change applies the moment the control is toggled (like the theme
  default) and survives restart.
- **Both motion layers neutralised**: the JS motion layer (springs/presets) AND the CSS
  animations/transitions must both honour the policy - the existing reduced-motion plumbing is the
  mechanism, extended to consider the setting, so no surface is left animating.
- **No structural change**: the instant path must still mount/unmount, position and reflow exactly as
  the animated path does; only the motion is removed.

**Success criteria**

1. With animations OFF, frame sampling shows the instant path (1-2 frames, no intermediate values) for:
   a morphing menu open/close, the text-panel reflow, a dialog open/close, a toast, a theme switch, the
   rail collapse/expand, a tab switch and the tools-palette resize - and every end state (rects,
   geometry, visibility) is identical to the animated path.
2. The setting persists across restart and is validated in the main process (a non-boolean or malformed
   stored value falls back to the default; a valid `false` is preserved and re-read).
3. The Preferences control reflects the stored value, applies immediately, and carries an explanatory
   hint naming what it disables.
4. With the setting ON and the OS reduced-motion preference set, the reduced path still applies (the OS
   preference wins); with the setting OFF and no OS preference, the instant path applies.
5. Unit tests for the main-process validation and the renderer's effective-motion resolver (setting x OS
   preference matrix); e2e for the toggle -> instant behaviour -> restart persistence.
6. The Phase-20 motion-token contract test still passes (the switch must not break the token plumbing),
   and no new hardcoded durations/easings are introduced.

**Settings impact:** `animationsEnabled?: boolean` - default `true`; validation:
preserve-if-valid / reject-if-invalid in `src/main/services/settings.ts` (must be a boolean; anything
else is rejected so the field falls back to the default); transported via the AppSettings IPC so the
choice survives restart. The main-process validation lands before any renderer code reads the field.

## Phase 24 — Full text-style support for annotation text objects (textbox, callout, note)

**Supersession note:** this phase supersedes the Phase-21 per-family scope restriction that limited
annotation text objects to colour-only in the text-properties panel. Every control in the panel
(font family, size, bold, italic, underline, alignment, line spacing, list, indent, highlight,
superscript/subscript, clear formatting) is now live for textbox/callout/note annotations, stored in
the annotation model, honoured by the baked appearance stream, and surviving save/reopen.

**Features**

- **The text-properties panel is fully live for annotation text objects.** When a textbox, callout
  or sticky-note annotation is selected, every panel control — font family, size, bold, italic,
  underline, colour, highlight, alignment, line spacing, bulleted/numbered lists, indent,
  superscript/subscript, clear formatting — operates exactly as it does for Edit-mode text boxes.
  The disabled-with-tooltip "not supported" message is retired.
- **Annotation model extended:** `AnnModel` carries the same `TextStyleFields` set introduced in
  Phase 21 (`font`, `size`, `bold`, `italic`, `underline`, `align`, `lineHeight`, `highlight`,
  `baselineShift`, `list`, `indent`); default values reproduce the previous behaviour when the
  fields are absent so all existing annotations are unaffected.
- **Baked appearance honours the style:** `buildFreeTextAPStream` (annotations.ts) uses the stored
  style fields when building the /AP stream — font variant selected via `selectStandardFont`, size
  from the stored value, colour from the stored colour, alignment positioning, highlight bands, line
  height, list prefixes and indent offset mirror the Phase-21 `drawStyledTextLines` logic. The auto-
  fit still applies when the stored size would overflow the box.
- **`createAnnotation` / `editAnnotation` payloads** accept the new style fields. Validation:
  preserve-if-valid / reject-if-invalid (same contract as Phase-21 `TextBoxStylePatch`).
- **Round-trip:** style fields are baked into the /AP stream and also persisted in the annotation's
  custom metadata so a reopen accurately reflects the stored style (the baked stream is what other
  viewers see; TFlex reads the metadata on reopen to re-populate the panel).

**Success criteria**

1. With a textbox/callout/note annotation selected, every text panel control is live (no disabled
   control and no "not supported" tooltip); changing font/size/bold/italic/alignment/etc. through
   the panel applies immediately to the annotation's rendered text.
2. All style changes survive save + reopen — the annotation opens in the other viewer with the
   correct appearance (via the baked /AP stream) and TFlex's panel reflects the stored style.
3. Existing annotations (no style fields stored) reopen unchanged (default values reproduce the
   old Helvetica appearance).
4. Validation rejects malformed style fields (same contract as Phase-21 text boxes) and fails loud;
   valid fields are preserved; absent fields default.
5. Unit tests for the new annotation payload validation + the appearance-stream style application
   (font variant, alignment, line height, list prefix, highlight band); e2e for the live apply +
   save/reopen round-trip for each style group.
6. The Phase-21 text-box / edit-text-run contracts are unchanged.

**Settings impact:** none (the style fields ride the existing annotation IPC; no new AppSettings
field).

## Phase 25 — Floating, movable text-properties panel (no header, no page reflow)

**Supersession note:** this phase supersedes the Phase-21/24 docked-column design. The panel is no
longer a grid column with a header and a page reflow; it is a floating card over the page view that
the user can drag anywhere inside the page area.

**Features**

- **No header**: the panel's distinct header bar and its "Text" title are removed. The controls are
  the whole panel; a small drag affordance (the existing `ContentGrip` pattern) is the only chrome.
- **Floats over the page view**: the panel is positioned inside the page-view area (`.workspace-main`)
  as an overlay, not a grid column. It never takes top-bar space and never sits outside the page
  window.
- **The page does NOT reflow**: opening/closing the panel must not change the page geometry, the
  scroll position, or the fit scale. The `--tf-text-w` grid column and the `data-text-panel-open`
  reflow are retired (or pinned to 0) so the page stays exactly where it was.
- **User-movable**: the panel can be dragged anywhere within the page view (the existing
  `useDragWindow` hook, the same pattern the stamp/watermark dialogs and the edit overlays use),
  clamped so it cannot be dragged fully out of view. Its position persists for the session (and is
  remembered per tab like the other floating surfaces).
- **Text-element move integrity**: moving a text element (drag) with the panel open must produce no
  artifacts - no ghost, no offset drift, no stale copy - because the panel no longer shifts the page
  geometry. This is explicitly verified (the DEF-232 class).
- **Motion + themes**: opening/closing uses the Phase-20 token motion (no un-animated appearance),
  honours the Phase-23 animation switch, and looks correct in all three themes.

**Success criteria**

1. The panel has no header/title bar; opening it does not move the page (frame-sampled: the page
   canvas rect and the scroller's scrollTop are unchanged across open/close), and it renders inside
   the page-view area only.
2. The panel can be dragged by its grip to any position inside the page view and stays where it is
   put; it cannot be dragged fully out of the visible page area.
3. With the panel open, dragging a text element (annotation textbox/callout/note and Edit-mode text
   box) moves it correctly with no ghost, offset drift or stale duplicate (verified live and after
   save/reopen).
4. No regression to the Phase-24 annotation text controls (all live) or the Phase-20/23 motion
   contracts; reduced motion and the animations-off setting behave as standard.

**Settings impact:** none.

## Phase 26 — Panel-driven text editing (double-click editors removed) + shape colour from the dropdown

**Features**

- **Double-click-to-edit is removed everywhere.** No text element opens an in-canvas editor on
  double-click, and no in-canvas text box appears when a text element is placed or clicked. The
  in-canvas editors for annotation textbox / callout / note (and the Edit-mode text-run editor's
  double-click path) are retired.
- **The panel gains a Text field** as the single text-editing surface for text-bearing tools. When a
  text element is PLACED or an existing one is CLICKED, the panel's text field becomes active and
  focused automatically, ready for typing. Editing the field updates the text element on the page
  LIVE (as the user types), with the per-doc undo stack intact.
- **Shape colour comes from the annotation dropdown**: the in-canvas colour palette that double-
  clicking a shape opened is removed. Shape (and text) colour is changed through the annotation
  toolbar's colour control (the existing `[data-ann-color]` swatch + picker popover).
- **Selection affordances stay**: clicking a text element still selects it (handles/selection chrome),
  the action bar keeps Confirm / Delete (Cancel where applicable), and the panel reflects the
  selected element's values.

**Success criteria**

1. Double-clicking any text element (annotation textbox/callout/note, Edit-mode text box/run) opens
   NO in-canvas editor; no in-canvas text box ever mounts for placing or clicking text (verified by
   DOM probe + screenshots).
2. Placing a text element or clicking an existing one focuses the panel's Text field automatically;
   typing there updates the page text live (verified mid-typing, not only on blur), and the change
   survives save/reopen.
3. Double-clicking a shape (rect/ellipse/arrow) opens no in-canvas colour palette; the annotation
   toolbar's colour control changes the selected shape's colour.
4. Existing actions still work: Confirm, Delete, undo/redo, and the panel's full style control set.
5. The Phase-24 annotation style contract and the Phase-21 text-box style contract are unchanged.

**Settings impact:** none.

## Phase 27 — Engine character spacing + a wider font set

**Features**

- **Character spacing (tracking)**: the `Tc` text-state operator is integrated into the engine's
  styled-text renderer, so the panel's character-spacing control is LIVE for TFlex-owned text boxes,
  edited text runs and annotation text objects (the control that has shipped disabled-with-tooltip
  since Phase 21/24 becomes functional). The value is validated (a bounded point range), baked into
  the appearance/content streams, and survives save/reopen.
- **More fonts**: the font set grows beyond the three StandardFont families. Bundled, offline,
  licence-clean font families ship in `assets/fonts/` and are embedded on demand (subset where the
  library allows), exposed through the panel's family dropdown and accepted by the engine's font
  validation. A font that cannot be embedded fails loud with a typed error (never a silent
  substitution).
- **Round-trip**: the chosen family (bundled or standard) is persisted with the text style and
  restored on reopen; a reopen in another viewer shows the embedded font's glyphs.

**Success criteria**

1. The character-spacing control is live for text boxes, edited runs and annotation text objects;
   changing it visibly changes the glyph spacing on the page and survives save/reopen (round-trip
   asserted in the baked stream by the `Tc` operator).
2. The font dropdown lists the bundled families in addition to the three standard families; each
   selected family renders on the page and survives save/reopen.
3. An unsupported/missing font file produces a typed `engine-error` naming the font (fail loud).
4. Character spacing and the new fonts compose with the existing style fields (bold/italic/size/
   colour/highlight/align/line-height/list/indent) with no regression.
5. Unit tests for the spacing validation + the `Tc` emission, the font allowlist/embedding, and the
   round-trip; e2e for a spacing change and a bundled-font change through the panel.

**Settings impact:** `editDefaultFont` widens to accept the new bundled family ids (existing field,
extended allow-list; preserve-if-valid / reject-if-invalid so an unknown id falls back to the current
default); no new AppSettings field.

## Phase 28 — Annotation interaction: arrow geometry, live edits, action-bar colour, comment threads

**Supersession note:** this phase supersedes (a) the confirm-before-apply editing model for annotation
shape/position/colour changes - edits now apply live and only Cancel reverts - and (b) the Phase-26
decision to take shape colour from the annotation toolbar dropdown: colour is picked from the
action-bar colour box, and the annotation dropdown colour is ignored for a selected annotation.

**Features**

- **Arrow geometry**: the arrow's leader line ends at the arrowhead's BASE, not at its tip, so the
  shaft never extends past or through the pointer. The head keeps its current wings; the shaft's
  visible line stops where the head begins (the invisible hit line may stay full-length).
- **Live edits (no Confirm required)**: moving a shape/arrow/text element, resizing it, and changing
  its colour all apply to the document IMMEDIATELY and stay applied. No Confirm click is required and
  no unconfirmed state exists. A Cancel action reverts the change (undo). Changing the colour after a
  move must work - it must never revert the move or be silently dropped.
- **Action-bar colour box**: in the in-canvas action bar, the "Edit" text button between Confirm and
  Delete is replaced by a COLOUR BOX (a swatch showing the current colour). A SINGLE click expands the
  colour picker (double-click is removed app-wide); picking a colour applies it live. The annotation
  toolbar's dropdown colour is ignored for a selected annotation (the action bar owns the colour).
- **Comment threads (Adobe-like)**: a comment affordance on annotations. Selecting an annotation shows
  its comment box (a text area for the comment plus a reply list with an "add reply" field). An
  annotation that HAS comments shows a small comment icon on the element itself; an annotation with NO
  comments shows NO icon. Comments and replies persist through save/reopen.
- **Icon behaviour**: the icon is an indicator only (a small badge on the annotation) - the comment box
  is the place to read/write; the icon must not intercept the annotation's own selection gestures.

**Success criteria**

1. An arrow's leader line visibly ends at the head's base in all three themes (frame/screenshot
   inspection) and the line never crosses or extends past the pointer; the hit target still covers the
   whole arrow.
2. Dragging a shape/arrow/text element applies the move immediately (no Confirm) and it stays; changing
   the colour right after a move applies live and does NOT revert or drop the move; Cancel reverts the
   change (undo). Verified live and after save/reopen.
3. The action bar shows a colour box in place of the Edit text, between Confirm and Delete; a single
   click opens the picker; picking a colour changes the selected annotation's colour; the annotation
   dropdown colour no longer changes a selected annotation's colour.
4. Selecting an annotation shows its comment box; adding a comment and a reply persists through
   save/reopen; an annotation with comments shows the small icon and one without shows none.
5. No regression to the Phase-26 live text field, the Phase-25 panel, or the annotation create/delete
   flows.

**Settings impact:** none.

## Phase 29 — Flush canvas (remove the empty space around the page view)

**Features**

- **No gutters**: the page view has no empty space around it - the `.document-content` 28px top/bottom
  padding and the `.document-scroller` right padding are removed (or set to 0) so the page area is
  flush with the app chrome on every side, in every theme (including the frosted duplicate rule).
- **Scroll math intact**: removing the padding must not break the page-jump/scroll-position math (the
  frosted `contentTopPadRef` path) or the page-slot alignment; page jumps still land correctly.
- **Interaction intact**: annotations, selection, the floating text panel and the tools palette keep
  working with the page flush (no clipped edges, no offset drift).

**Success criteria**

1. The page view is flush: measured 0 padding/gutter around `.document-content` and
   `.document-scroller` in all three themes (screenshots).
2. Page jumps (thumbnail click, page-nav) still land on the correct page and the scroll position is
   correct after the padding removal.
3. Placing/selecting/moving an annotation on the flush page maps to the correct page coordinates (no
   offset drift), and the floating text panel + tools palette still work.

**Settings impact:** none.

## Phase 30 — Print with advanced options (industry-standard)

**Research basis:** the option set and architecture below come from the print-dialog research (Adobe
Acrobat's print docs, Apple Preview, Chrome, Microsoft Learn's print stacks) and Electron's documented
print API (`webContents.print`, `getPrintersAsync`). Industry baseline = printer picker, copies +
collate, page range (all / current / custom syntax), the scaling quartet, duplex, colour mode, an
annotations toggle and a preview-first flow; the advanced tier = paper source by page size, N-up with
page order, odd/even/reverse, auto orientation, booklet/poster and presets.

**Features**

- **Print dialog (preview-first)**: opens from a Print icon in the title bar placed immediately LEFT of
  the preferences gear, from File > Print in the application menu, and from Ctrl+P. It shows a live
  PREVIEW of the selected page(s) with the current settings applied, and re-renders the preview as
  settings change.
- **Baseline options** (all wired to real print behaviour, never a silent no-op):
  - **Printer** picker populated from the OS printer list (`getPrintersAsync`), with the system default
    preselected; the value passed to Electron is the SYSTEM device name (not the friendly name).
  - **Copies** (1..99) + **Collate**.
  - **Page range**: All pages / Current page / Custom - accepting the industry syntax
    (`1-5, 8, 11-13`), validated with a clear in-dialog error for a malformed or out-of-range entry.
  - **Scaling**: Fit to page / Actual size / Shrink oversized pages / Custom % (1..500).
  - **Orientation**: Portrait / Landscape (plus Auto where the page aspect decides).
  - **Duplex**: Simplex / Long edge / Short edge.
  - **Colour**: Colour / Greyscale.
  - **Print annotations**: Document only / Document with annotations - the renderer produces the page
    images WITHOUT or WITH the annotation overlay layers accordingly.
- **Advanced options**:
  - **Pages per sheet (N-up)**: 1 / 2 / 4 / 6 / 9 / 16 with the page ORDER (horizontal / vertical and
    the reversed variants) applied to the preview and the composed print document.
  - **Odd/Even pages only** and **Reverse page order**.
  - **Paper source by page size** (tray selection) where the driver reports it.
  - **Print presets**: save the current dialog settings under a name and re-apply them (session-level).
- **Rendering architecture (the industry norm for Electron)**: the renderer renders each page in the
  selected range offscreen through the existing pdf.js pipeline at a print scale and hands the images to
  the main process, which composes a print document (one page per image, page-break separated) in a
  HIDDEN window and calls `webContents.print(options)` with the chosen options - page ranges, scale,
  N-up, orientation, duplex, colour and copies map onto Electron's documented keys. `printBackground` is
  enabled. The visible app window is never the print source (it is virtualized), and the renderer must
  not block while pages render for print.
- **Fail loud**: an option the platform/driver does not support (e.g. duplex on a driver that ignores it)
  must be REPORTED to the user - never silently dropped. A failed OS print call surfaces its
  `failureReason` in the dialog.

**Success criteria**

1. The Print icon renders immediately left of the preferences gear; clicking it, File > Print and Ctrl+P
   all open the same dialog.
2. The printer picker lists the OS printers with the default preselected; printing to "Microsoft Print to
   PDF" (or a real printer) with a custom page range produces a document containing exactly those pages
   (verified by inspecting the produced file).
3. Scaling, orientation, N-up and page order change the PREVIEW and the printed output accordingly
   (verified on at least: Fit vs Actual size, Portrait vs Landscape, 1-up vs 2-up, forward vs reverse).
4. The annotations toggle changes the printed output: "document only" prints without the annotation
   overlay, "with annotations" prints with it.
5. Copies/collate reach the print call; a malformed page range is rejected in-dialog with a clear error
   and nothing is sent to the printer.
6. An unavailable printer or a failed print surfaces the failure reason in the dialog (no silent no-op);
   the app stays responsive while pages render for print (no UI freeze on a 34-page document).
7. Unit tests cover the option model + the page-range parser + the option->Electron mapping; e2e covers
   opening the dialog from all three entry points, the preview reacting to the settings, the range
   validation error, and a print run against a PDF-capable destination.

**Settings impact:** none (print options are per-print; presets are session-level).

## Phase 31 — What's New in every release, shown in About

**Operator request (2026-09-21):** "From now on, add a What's New section in every OTA release and show
them in the About section."

**Research basis:** the industry norm (VS Code's release notes view, Chrome's "What's new" page, Windows
apps' About + changelog) is that a desktop app shows the notes of the version it is RUNNING without any
network call, and shows the INCOMING version's notes when an update is available. The OTA channel already
carries the notes for the incoming version (electron-updater parses the GitHub Release body into
`updateInfo.releaseNotes`), so both halves are available without adding a network dependency beyond the
existing updater.

**Features**

- **Single source of truth (bundled, offline)**: a structured changelog module in `src/shared/`
  (`whatsNew.ts` or equivalent) holding ordered entries `{ version, date?, highlights: string[] }`,
  newest first. It is bundled into the app, so the notes of the RUNNING version render with no network
  call. It is maintained as part of the release procedure: a version is not releasable without its entry.
- **About dialog — "What's New" section**: the existing About sheet gains a section that renders the
  running version's highlights (with the version label), plus the previous entries in a compact
  history, and - when the OTA feed reports an available or downloaded update - that INCOMING version's
  notes, clearly labelled with the incoming version and distinguished from the installed one's notes.
- **Updater plumbing**: `UpdateState`'s `available` and `downloaded` variants carry the incoming
  `releaseNotes`, normalised from electron-updater's `string | ReleaseNoteInfo[]` shape into a plain
  `string[]` of lines, so the renderer never parses provider-specific data.
- **Every OTA release carries its notes**: the GitHub Release body for a version is generated from that
  version's changelog entry, so the OTA feed (and therefore `releaseNotes` in the app) contains the same
  content the About dialog shows for the installed version.
- **Fail loud, render safe**: a running version with no changelog entry renders an explicit
  "No release notes for this version" state - never a blank section and never a crash. Notes content
  arriving from the feed (which may be HTML or markdown from GitHub) is rendered as PLAIN TEXT lines;
  markup must never be injected as HTML.

**Success criteria**

1. The About dialog renders a "What's New" section showing the RUNNING version's highlights, with the
   app offline (no network call is needed to see them), and its existing rows (version, Electron, Node,
   update status) and open/close behaviour are unchanged.
2. The bundled changelog is ordered newest-first and lookup is exact-version; unit tests cover the
   exact match, an unknown version (the explicit empty state), and the ordering.
3. With a simulated `available` / `downloaded` update state carrying notes, the About dialog shows the
   INCOMING version's notes labelled with that version; with no notes it shows the explicit empty state
   rather than a blank block.
4. A release gate exists in the test suite: the bundled changelog MUST contain an entry for the version
   in `package.json`, and the test fails when it does not (so no release can ship without its notes).
5. The GitHub Release body published for the release contains that version's What's New content,
   verified by inspecting the release in `tanzimtipu/tflex-releases`.
6. Notes content containing HTML/markdown markup is rendered as literal text in the About dialog
   (verified by a test that feeds tag-bearing notes and asserts no element is created from them).
7. `npm run verify` and the targeted unit tests pass; the About dialog's What's New section is captured
   in a screenshot for the release evidence.

**Settings impact:** none.

## Phase 32 — Multi Mode: two documents in one workspace

**Operator request (2026-09-21, verbatim):** "Implement loading multiple pdf files in one canvas. Up to two
for now. User should be able to view and interact with them in the same canvas. all the options like,
delete, insert etc options should available for the user to work on any window of the pdf. User should be
able to drag and drop pages from one pdf window to another. Thumbnail page view should be available for all
the files, resize them dynamically based on number of files loaded. The drag and drop should be allowed
within the thumbnail page view and also in the canvas. Plan and organizes the visual professionally, so that
it doesn't look poor or disjointed. Make sure to make it super smooth. No visible refresh or flicker should
be there. This feature will be called 'Multi Mode'. Add this to the bar with icon and also in the All tools
panel."

**Scope supersession:** this phase deliberately supersedes the earlier assumption that only one document is
visible in the workspace at a time. Tabs, single-document behaviour and every existing operation remain
unchanged when Multi Mode is off.

**Design decisions (fixed by this contract - do not re-invent them per chunk):**

- **Two panes, exactly.** Multi Mode shows TWO document panes side by side (the operator's "up to two for
  now"). There is no third pane: nothing may create one, and any attempt fails LOUD with a clear message,
  never a silent no-op. The same document must never occupy both panes (attempting it is refused with a
  message).
- **Opening a document while the mode is on** (Open, the pane's Open action, a dropped file, the sample
  cards): the document is assigned to the FOCUSED pane, replacing that pane's document - the previous
  document stays open as a tab and is one click away in the tab strip. A document must NEVER end up in a
  hidden tab with no visible effect. An assignment that cannot be honoured (the file is already shown in
  the other pane) is refused with a clear user-visible message. The pane pick list and the tab strip both
  honour the same guard.
- **Entry points.** A CommandBar control with an icon (`data-toolbar-multi-mode`, `aria-pressed` reflecting
  the mode) AND a ToolsPalette entry (the All tools panel; a tool id such as `multi-mode` with its group
  and search keyword). Both toggle the same mode; their state stays in sync.
- **Pane assignment.** Pane A holds the document that was active when the mode was switched on. Pane B
  starts empty with an explicit empty state offering (a) a pick from the currently open documents and
  (b) an Open action; it becomes a real pane the moment a document is assigned.
- **Focus model.** Exactly one pane is focused. Clicking anywhere in a pane (page, scrollbar area, its rail
  section, its header) focuses it. The focused pane carries a clear, non-jarring accent affordance plus a
  per-pane header (document name, page count, and a control to clear/replace its document). EVERY
  document-scoped action - the CommandBar and toolbar page operations (delete, rotate, reorder, insert
  blank/from-PDF, extract, optimize, OCR), annotations, undo/redo, Save/Save As, and every dialog-driven
  operation - acts on the FOCUSED pane only, never on both and never implicitly on the previously active
  tab.
- **Layout quality.** A single workspace split with an adjustable divider (a sensible minimum pane width,
  and both panes keep their own scroll position and zoom). The two panes must read as one deliberate
  composition: shared chrome height alignment, consistent spacing/typography with the rest of the app,
  one visual language - not two bolted-together viewers. All motion uses the existing motion tokens; no
  hardcoded durations/easings.
- **Thumbnails for all loaded files.** ONE shared thumbnail rail holds a labelled section per document
  (a header with the document name and page count), and the thumbnail width is computed DYNAMICALLY from
  the rail's available width and the number of loaded documents so both sets render at a legible size
  (a smaller width in Multi Mode than in single mode; still a comfortable hit target). Each section keeps
  its own scroll state; the focused pane's section is visually active; a page click in any section
  navigates that pane.
- **Page drag and drop, rail AND canvas.** A page can be dragged from one document to the other starting
  from its thumbnail OR from its page in the canvas. Both paths show the same clear drop affordance: the
  target pane/section highlights and an insertion-position indicator shows exactly where the page will
  land (before/after a target page, or at the end). Default is MOVE; holding Ctrl (or Alt) makes it a
  COPY. A completed drop is ONE atomic operation that cannot lose a page: the engine extracts the page
  from the source, inserts it into the target at the drop position, and (for a move) removes it from the
  source, as a single unit - a failure leaves BOTH documents exactly as they were. Intra-document page
  reordering keeps working exactly as today, in both the rail and the canvas.
- **Smoothness - no visible refresh or flicker (explicit).** Toggling Multi Mode, focusing a pane,
  assigning a document to a pane, changing the split, starting/hovering/dropping a drag, and completing a
  cross-document move must produce NO blank frame, NO white flash and NO re-raster of the unaffected pane.
  The DEF-274/DEF-222 rule applies everywhere a canvas can be re-rendered: never clear or resize a visible
  canvas before its replacement frame is ready (render offscreen, blit atomically). The drag preview is a
  lightweight clone (or a styled overlay), never a re-render of a pane. Pane state must be keyed stably so
  a focus change cannot remount a DocumentView.
- **Data safety.** Each pane's document keeps its own modified state; Save/Save As apply to the focused
  pane; the close/quit gate must account for the unsaved changes of BOTH panes (no silent data loss), and
  closing a tab whose document is in a pane must update that pane cleanly (empty state or another pick),
  never leave a stale pane.
- **Single mode untouched.** With Multi Mode off, the app behaves exactly as it does today - all existing
  e2e and unit suites must stay green, and the existing single-document flows must not regress.

**Features**

- Multi Mode toggle: CommandBar icon control + All tools panel entry, state-synced, persisted for the
  session.
- Two-pane workspace with an adjustable divider, per-pane headers, an explicit focus affordance, and a
  pane-B empty state with document pick/open.
- Full operation routing to the focused pane (page ops, annotations, undo/redo, save, dialogs).
- Shared thumbnail rail with one labelled, dynamically-sized section per loaded document.
- Cross-document page move/copy by drag and drop, from the rail and from the canvas, with a drop-position
  indicator, backed by one atomic engine operation.
- Close/quit safety across both panes.

**Success criteria**

1. The Multi Mode control is present in the CommandBar (with an icon) and in the All tools panel; both
   toggle the same mode and their states agree; the app returns cleanly to the single-pane layout when
   switched off.
2. With Multi Mode on, two different documents can be loaded and are both visible and interactive in the
   same workspace, each with its own page view, scroll position and zoom; opening another document assigns
   it to the focused pane with a visible effect (never a hidden tab, never a silent no-op), and assigning
   the document already shown in the other pane is refused with a clear message.
3. Every document-scoped operation acts on the FOCUSED pane only: deleting pages, rotating, reordering,
   inserting pages, and undo/redo each change the focused pane's document and leave the other pane's
   document untouched (page counts and content before/after per pane).
4. The shared thumbnail rail shows one labelled section per loaded document with a header (name + page
   count) and dynamically sized thumbnails that shrink when two documents are loaded; both sections render
   correctly and clicking a thumbnail navigates the correct pane.
5. Dragging a page from document A to document B moves it: the page appears at the indicated position in B
   and is gone from A (verified by page counts and content on both sides), from BOTH the rail and the
   canvas; holding Ctrl (or Alt) copies instead (B gains the page, A keeps it); a failed move leaves both
   documents unchanged.
6. No visible refresh or flicker: frame sampling across (a) toggling Multi Mode, (b) switching focus
   between panes, (c) starting and completing a cross-document drag, and (d) changing the split, shows no
   blank/white frame in either pane and no re-raster of the unfocused pane.
7. The app stays responsive with two documents loaded: scrolling, focusing and dragging cause no
   main-thread stall (the existing responsiveness probe, with both panes on 34-page documents), and the
   REQUIREMENTS performance budget items still hold.
8. The close/quit gate accounts for both panes' unsaved changes, and closing a tab whose document is in a
   pane updates the pane cleanly (verified in both directions).
9. With Multi Mode off, every existing behaviour is unchanged: the existing unit and e2e suites stay green.
10. Unit tests cover the pane/mode state model, the drag payload -> operation mapping (move vs copy,
    insertion index) and the cross-document move contract; e2e covers the two-pane layout, focused-pane
    routing, the rail sections, both drag paths, and the mode toggle round-trip.

**Settings impact:** none (the mode is session-level; persisting it across restarts is not requested).

## Phase 33 — Print and Multi Mode refinements (operator feedback)

**Operator request (2026-09-22, verbatim):**
"**Bug: For print** 1. Vertical and Horizontal page preview shows the same layout. 2. The print window
should be movable for the user.
**For Multi View:** 1. There shouldn't be two different tools bar for each window. There should be one
tool bar like 'Annotation' etc. User should be able to apply them to either of the windows. 2. The canvas
shouldn't have see through/transparent background. The background should be either light/dark. 3. The
thumbnail page view should be in the middle for multi view side by side for both files. Not in the same
row as the current implementation. In multi view, when the 2nd file is added, both thumbnail page view
will be in the middle side by side. The thumbnail for left window will be on its right and the thumbnail
for right window will be on tis left."

**Scope supersession:** this phase supersedes Phase 32's "ONE shared thumbnail rail holding a labelled
section per document" layout (item 3 below replaces it) and Phase 30's fixed, non-movable dialog shell
(item 1). Everything else in those phases stands.

**Features**

- **Movable print dialog.** The print dialog panel can be repositioned by the user: dragging its header
  (a visible drag affordance) moves the panel, clamped so it always stays fully inside the window. The
  move is smooth (no flicker, no layout thrash, transform-based), the dialog's controls keep working
  after a move, and a freshly opened dialog returns to its default centred position (the position is
  session-only, not persisted).
- **Print preview page order must be real.** "Vertical" and "Horizontal" page order must produce
  visibly DIFFERENT sheet layouts, matching the industry meaning (Acrobat's Page Order): Horizontal
  flows left-to-right (pages side by side), Vertical flows top-to-bottom (pages stacked). The effective
  sheet grid (columns/rows) AND the fill flow both follow the order - so at 2 pages per sheet, Horizontal
  is 2 columns x 1 row and Vertical is 1 column x 2 rows; at 6 per sheet the 3x2 grid becomes 2x3, and so
  on. The reversed variants reverse the flow within that grid. The PREVIEW and the composed PRINT
  DOCUMENT must agree for every pages-per-sheet value. (Phase 30 criterion 3 already promised this; this
  phase makes it true - the two orders currently render identically at 2-up because the grid dimensions
  never change.)
- **One shared toolbar in Multi Mode.** In Multi Mode the workspace has exactly ONE toolbar (the same
  toolbar the app shows in single mode - annotation tools, page tools, etc.), not one per pane. Its armed
  tools apply to whichever pane the user works in: arming a tool in the shared bar and then using it in a
  pane applies it to THAT pane (the interaction focuses that pane first). The per-pane toolbars are gone
  in Multi Mode; single mode keeps its existing toolbar unchanged.
- **Opaque canvas background in EVERY mode (operator follow-up: "Don't keep see-through for single
  mode").** The PDF canvas area - the pane surface and its scroller - must be an opaque surface colour of
  the active theme (light or dark) in BOTH single mode and Multi Mode, in every theme including frosted.
  Translucent chrome may stay glassy; the surface the pages sit on may not.
- **One All Tools badge in Multi Mode (operator follow-up: "All Tools badge shouldn't render twice").**
  The All Tools affordance must appear exactly ONCE in Multi Mode; an inactive pane must not render a
  duplicate of the workspace chrome (see the AGENTS_NOTES observation from the Phase 32 run).
- **Centred side-by-side thumbnail strips in Multi Mode.** When two documents are loaded, each pane's
  thumbnail strip sits at that pane's INNER edge, so the two strips meet in the MIDDLE of the workspace,
  side by side: pane A's strip immediately to the RIGHT of pane A's pages, pane B's strip immediately to
  the LEFT of pane B's pages, with the divider between the two strips. Each strip shows its own pane's
  document, thumbnails stay dynamically sized to the available width (still a comfortable hit target),
  clicking a thumbnail navigates its own pane, and drag and drop between the two strips and the canvas
  keeps working exactly as verified in Phase 32.

**Success criteria**

1. The print dialog can be dragged by its header to a new position and stays clamped inside the window at
   every drag extreme; the controls still work after a move (a print can be configured and started);
   frame sampling during the drag shows no blank/white frame or layout shift; reopening the dialog shows
   it centred again.
2. With 2 pages per sheet, Vertical and Horizontal produce visibly DIFFERENT preview layouts (stacked vs
   side by side - assert the cell geometry, not just the class); at 4 and 6 per sheet the arrangements
   differ in the expected direction; the reversed variants reverse the flow within the same grid; and for
   each order the composed PRINT DOCUMENT matches its preview (verified by inspecting produced PDFs - page
   count and the arrangement of the pages on the sheet).
3. In Multi Mode there is exactly ONE toolbar in the workspace (`[data-toolbar-*]` controls appear once,
   not once per pane); arming a tool in it and using it in pane A applies to A, and the same in pane B
   applies to B (verified by an actual operation on each side).
4. The canvas background is opaque in every theme (light / dark / frosted) in BOTH single mode and Multi
   Mode: pixel sampling of the canvas area returns an opaque colour, never the app background showing
   through, plus a screenshot for the visual record.
4b. The All Tools affordance renders EXACTLY ONCE in Multi Mode (a single badge in the workspace chrome,
   not one per mounted pane), while remaining reachable and functional.
5. With two documents loaded, pane A's thumbnail strip is to the RIGHT of pane A's pages and pane B's
   strip is to the LEFT of pane B's pages (assert the strips' horizontal positions relative to their own
   pane and to each other - both in the middle of the workspace, side by side); each strip shows its own
   document's thumbnails at a dynamically sized width; a thumbnail click navigates its own pane; and a
   cross-document drag from either strip still moves the page.
6. Single mode is unchanged apart from the now-required opaque canvas (one toolbar, the rail at its
   existing position and width, the existing suites green),
   and the previously verified Multi Mode behaviours still hold: focused-pane routing, the close/quit
   gate over both panes, and no visible refresh/flicker on mode toggle, focus switch, divider drag and
   drag-and-drop.

**Settings impact:** none.

## Phase 34 — Multi Mode round 2 (operator feedback)

**Operator request (2026-09-22, verbatim):**
"1. Expanding 'All tools' panel should resize both window equally. At this time, the left window resizes
with a blank space on its right, even though there's no all tools panel on the left window.
2. Multi view mode shouldn't open two tabs. It should put a divider in one tab and show both file names
on the two sides of the divider.
3. Make divider between the two windows more prominent. Currently it's not very visible.
4. When dragging and dropping a page, show a line between the pages where the page will be placed for
more clarity."

**Features**

- **The All Tools panel resizes BOTH panes equally.** Opening the All Tools palette must shrink the two
  panes by the SAME amount. Today the palette's reserved width (`--tf-tools-inset`) is consumed as a
  `margin-right` by EACH pane's `.document-scroller` (styles.css:3357-3361), so pane A - which the
  floating right-side panel does not even cover - reserves a full 344px inside itself and shows a blank
  strip on its right, beside its own thumbnail strip. The reserved width must instead come out of the
  WORKSPACE as a whole (consumed once at the stage level), so both panes lose half of it and neither
  pane carries an internal blank strip. The existing token-driven slide (registered
  `@property --tf-tools-inset`, the shared panel-slide duration/ease) must keep the panel and both panes
  moving together with no flicker, and single mode's panel behaviour must stay exactly as it is.
- **ONE tab for the Multi Mode workspace (not two).** While Multi Mode is on the tab strip shows exactly
  ONE tab representing the combined workspace, instead of the two individual document tabs. The
  underlying session model is unchanged (two engine documents, each with its own undo stack, modified
  flag and page state) - this is a presentation change over it:
  - the single tab's label names BOTH documents (truncated gracefully when long);
  - its modified indicator reflects EITHER document being modified;
  - closing it runs the existing modified-changes queue for EACH modified document before closing both;
  - switching Multi Mode off restores the individual tabs, with the focused pane's document active;
  - opening a document while the mode is on keeps the Phase 33 semantics (it is assigned to the focused
    pane, never a hidden tab).
- **Both file names flank the divider.** Each document's name and page count is displayed immediately
  ADJACENT to the divider - the left document's name on the divider's left side, the right document's
  name on its right side - so the two names read as the two sides of one split workspace. This replaces
  the current per-pane top headers. The names must update when a pane's document is replaced.
- **A prominent divider.** The divider between the panes must be clearly visible in every theme: a
  distinct surface colour with a visible grip affordance and a hover/active state, without becoming
  heavy or noisy. Its drag must keep tracking the pointer 1:1 (no transition declared on the geometry),
  keep the existing min-pane clamp, and keep working after a theme change.
- **A clear insertion line while dragging a page.** While a page is dragged, a clearly visible line
  spanning the page column is shown in the GAP where the page will land (in the canvas AND in the
  thumbnail rail), so the insertion point is unambiguous - stronger than the current 3px accent bar
  (`.page-drop-indicator`, styles.css:11818-11837). The line must sit between the two page slots (not
  overlay a page), move with the hovered slot, and disappear on drag end/cancel.

**Success criteria**

1. With the All Tools panel open in Multi Mode, measure both panes' page-area widths before and after:
   the two panes shrink by the SAME amount (equal deltas within a pixel), and neither pane contains a
   blank reserved strip on its inner/outer side beyond its normal gutter. In single mode the panel's
   behaviour is unchanged. Frame sampling across open/close shows no blank frame or flicker in either pane.
2. In Multi Mode the tab strip shows EXACTLY ONE tab; its label names both documents; its modified
   indicator is set when EITHER document is modified; closing it prompts for each modified document and
   closes both; switching the mode off restores the individual tabs with the focused pane's document
   active; opening a document while the mode is on still assigns it to the focused pane.
3. Both file names (with page counts) render adjacent to the divider - the left document's name on the
   divider's left, the right document's on its right (assert their horizontal positions relative to the
   divider's rect) - and they update when a pane's document is replaced.
4. The divider is clearly visible in all three themes: report its rendered width, colour and grip
   affordance plus its contrast against the neighbouring surfaces, with a screenshot for the visual
   record; dragging it still tracks the pointer 1:1 and re-splits both panes within the min-pane clamp.
5. During a page drag an insertion line spanning the page column is visible in the gap at the landing
   position: report its geometry (width, thickness, its position BETWEEN the two page slots) and that it
   follows the hovered slot, in BOTH the canvas and the rail.
6. No regressions: single mode unchanged, and the previously verified Multi Mode behaviours still hold -
   focused-pane routing, the close/quit gate over both panes, no visible refresh/flicker, drag-and-drop
   move/copy, one shared toolbar and one All Tools badge - with the existing suites green.

**Settings impact:** none.

## Phase 35 — Windows integration, printing and window behaviour

**Operator request (2026-09-22, verbatim, the non-Multi-View items):**
"1. App doesn't have default windows behaviour, like double clicking on the top bar or dragging it to the
top of the screen doesn't make it full screen. Also, dragging it to the left or right of the screen doesn't
place it in split windows mode. Make sure, app uses all the default windows behavior.
2. Hidden taskbar in windows doesn't pop-up on mouse hover.
3. Windows currently doesn't show the app as pdf reader. Selecting 'open with' doesn't show tflex. Also, not
able to set it as default pdf app.
7. For Print, 'Microsoft print to pdf' brings another windows print window. It should happen within the
tflex app.
8. Allow tflex print window independent of the app, so it can be taken and used outside of the tflex app
window."

**Features**

- **Standard Windows window behaviour.** The frameless window must behave like a normal Windows app:
  double-clicking the title bar toggles maximise/restore; dragging the window to the top edge maximises it;
  dragging it to the left/right edge snaps it to a half-screen split (Aero Snap / snap layouts); and a hidden
  (auto-hide) taskbar reveals on mouse hover at the screen edge. The custom caption keeps its look, but the
  DRAGGABLE REGION must cover the whole caption strip (today it is deliberately narrow - see the DEF-132 note
  in `styles.css` around `.titlebar-slot` / `.app-header`) so the OS gestures trigger everywhere on the bar.
  The window must not block the taskbar's reveal: default sizing/positioning should respect the display's
  WORK AREA (`screen.getPrimaryDisplay().workArea`), and the conflict with `transparent: true`
  (`src/main/window.ts:100` - a layered window, a known cause of swallowed taskbar hover) must be
  investigated and resolved while preserving the app's translucent look.
- **TFlex as a PDF handler in Windows.** The installer must register TFlex as a PDF handler
  (electron-builder `fileAssociations` for `.pdf` - there is none today), so TFlex appears in Explorer's
  "Open with" list and can be chosen as the default PDF app in Windows Settings. The app must accept a file
  from the OS: launching the exe with a PDF path argument opens that document, and a second launch while
  TFlex is running opens the document in the RUNNING instance (single-instance handling) rather than
  starting a second app. Setting the Windows default handler is a user action in Windows Settings - the app
  must be selectable there and must never misrepresent its own default status.
- **PDF output produced inside TFlex.** When the destination is a virtual PDF printer ("Microsoft Print to
  PDF" and similar), the flow must stay INSIDE TFlex: the app produces the PDF itself from the same composed
  print document and asks where to save it with the app's own save dialog - no Windows/Chromium print
  window, no OS print dialog. The produced file must match the preview and the settings (page range, N-up,
  page order, orientation, scaling) exactly as the direct-print path does.
- **The print window can live outside the app window.** The print UI must be usable as its own OS window:
  movable anywhere on the desktop, including beyond the TFlex window's bounds, while still driving the same
  print pipeline (settings, preview, print/save) and staying in sync with the app (closing it leaves the app
  usable; the app closing closes it; a document change is reflected). The in-app dialog may remain the
  default; the requirement is that the print window is not trapped inside the app window.

**Success criteria**

1. Double-clicking the caption strip toggles maximise/restore; dragging the window to the top edge maximises
   it; dragging it to the left and right edges snaps it to half the screen (report the measured window
   bounds before/after each gesture); a hit-test at several points across the caption strip shows it is
   draggable everywhere; and with an auto-hide taskbar the taskbar reveals on hover at the screen edge
   (a manual/observable check is acceptable where automation is impossible - state the method).
2. `.pdf` is registered by the installer: after a silent install the association is present and points at
   the installed executable, TFlex appears as a PDF handler, launching the exe with a PDF path argument opens
   that document, and a second launch while running opens the document in the running instance (no second
   process). Setting the Windows default is a user action - the app must be selectable and must not
   misreport its default status.
3. With "Microsoft Print to PDF" selected, printing from TFlex produces the PDF through TFlex's own save
   dialog with NO Windows print window appearing; the produced file's page count, page order and orientation
   match the preview and the settings (verified by inspecting the produced file).
4. The print UI can be moved outside the app window (its bounds can exceed the app window's bounds) and still
   works there: changing a setting updates the preview, the print/save action completes, closing the print
   window leaves the app usable, and closing the app closes the print window.
5. No regressions: the direct-print path to a real printer keeps its behaviour (silent with the mapped
   options); single mode and Multi Mode are unaffected except where the operator asked; the existing suites
   stay green.

**Settings impact:** none expected. If an implementation detail needs a persisted field (e.g. a print-window
preference or a remembered last-save directory), it must be added to `AppSettings` with validation in
`src/main/services/settings.ts` (preserve-if-valid, reject-if-invalid) and this line updated before any
renderer reads it.

## Phase 36 — TFlex STAGES: an object-first workspace (information-architecture restructuring)

**Operator request (2026-09-23):** restructure the information architecture into **TFlex STAGES** — an
object-first workspace organized by STAGE OF WORK (`PAGES · EDIT · REVIEW · DELIVER`) rather than by
feature list. Reference mockup supplied by the operator (`tflex-stages-concept.html`) and the accompanying
implementation prompt (`TFlex_Stages_Implementation_Prompt.txt`). This is a RESTRUCTURING task: the
existing animation system, design language, components and behaviours stay intact; surfaces are re-parented
and re-homed, never rewritten.

**Locked design decisions (operator-approved 2026-09-23 — do not re-litigate per chunk):**

- **The All-tools palette is RETIRED as a UI surface.** Its entries array becomes `toolsRegistry` (data:
  id, label, description, icon, shortcut, stage, action, availability) and its badge is retired. This
  SUPERSEDES the "also in the All tools panel" wording of Phases 13/30/32/33 and the single-badge
  requirement (DEF-284's UI half). Every tool that lived only in that panel must exist in the registry and
  be reachable from a stage surface and/or the palette.
- **Command palette**: `Ctrl+K` opens it (fuzzy search across every tool, recent file and view action) and
  it supersedes the All-tools panel as the browse-everything surface. `Ctrl+Shift+P` stays a legacy alias.
  **Pin a result to the dock with `Ctrl+Enter`.** `Ctrl+P` remains PRINT and must not be re-bound.
- **Stages**: `Ctrl+1..4` switch PAGES/EDIT/REVIEW/DELIVER. Stage state is per pane (Multi Mode tracks a
  stage per pane). The Stage Rail is 44px, full height, four icon+label buttons with the settings gear at
  its bottom, and collapses to icon-only below a 1100px window width.
- **One moving part**: switching stage swaps ONLY the left context panel, the dock contents and the
  inspector contents. The title bar, Stage Rail, canvas and floating pills never move.
- **Action Dock**: one component, four legal states (stage verbs / selection override / pinned / idle),
  floating at the bottom-centre of the canvas over the workspace chrome. Nothing else may occupy the
  bottom-centre of the canvas as WORKSPACE chrome - the object-level action bars (annotation place/confirm,
  `EditToolbar`) and the floating text panel keep their current behaviour and are exempt.
  Idle (fade to ~40%) must NEVER trigger while a tool is armed or a drag is in progress. Pins persist
  (`dockPins`, max 4, oldest overflow into a "..." chip); a pinned tool already present in the stage set is
  not duplicated.
- **Inspector**: the right panel (240-280px) showing live properties of the current selection with the
  actions that apply to it. It RE-PARENTS the existing text-properties, OCR-suspects and annotations
  components (never reimplements them) and reuses the existing panel-inset machinery - the Phase 33/34 and
  DEF-286/287 invariants stand: the panel shrinks BOTH panes equally, the page-area floor holds, the stored
  split fraction re-clamps on geometry change.
- **Annotations** live in the REVIEW stage: the dock's primary opens ONE expandable surface that hosts the
  existing `AnnotationToolbar` (select/ink/rect/ellipse/arrow/textbox/callout/note/highlight/underline/
  strikeout + colour/pen). It must NOT read as a duplicated tool set - the registry gives every tool
  exactly ONE canonical home and other surfaces only reference it.
- **Title bar**: keeps Print (icon + Ctrl+P), the update indicator, the theme picker, the preferences gear
  AND all three quick file actions (Open / Save / Save As). The hamburger becomes an explicit "File" menu
  label. A settings gear is ADDED to the Stage Rail bottom (the title-bar gear stays).
- **Multi Mode keeps its Phase 32-34 layout**: centred inner-edge thumbnail strips flanking the divider,
  ONE shared rail/dock/badge for the workspace, ONE composite tab, and the stage tracked PER PANE. The
  concept's left context panel applies to SINGLE mode only. The shared Multi Mode toolbar ROW is replaced
  by the shared floating dock; `--tf-multi-toolbar-h` and its offsets are re-derived while DEF-282's
  invariant (no overlap with the pane headers, offset applied pre-paint) is preserved by tests.
- **Motion**: express the concept's timings with the EXISTING motion tokens only (no new durations), and
  honour reduced motion and the Animations-off switch.
- **Theming**: the concept's hues are illustrative. The brand accent stays the existing accent token; only
  four NEW semantic stage tokens are introduced (`--tf-stage-pages`, `--tf-stage-edit`, `--tf-stage-review`,
  `--tf-stage-deliver`) with a value PER THEME (light / dark / frosted) meeting WCAG AA (4.5:1 text, 3:1
  icons/chips). Zero hardcoded colours anywhere (the conventions checker enforces this).
- **Shortcuts may be REASSIGNED** where they collide (the operator approved moving a collided binding to an
  alternate key); `Ctrl+P` (Print) and the existing document shortcuts (Ctrl+S / Ctrl+F / Ctrl+Shift+O /
  Ctrl+Shift+S / Ctrl+W / Ctrl+Z / Ctrl+Shift+Z / Ctrl+,) must keep working.
- **Every existing control is placed**: the registry is built from a grep-audit of the whole UI, not from
  the concept's 22-item table. Controls with no natural stage go to a GLOBAL bucket (palette + title bar /
  File menu). Nothing is removed, hidden or downgraded. Specific placements approved: the **Multi Mode
  toggle** moves to the title bar + palette; **Watermark** sits in REVIEW (and the palette); the **floating
  text panel** becomes an optional pop-out of the same Inspector component (one component, two mount
  points - never a second properties UI).
- **Test migration is part of every chunk**: the e2e suite is updated in the SAME chunk as the surface it
  describes, with a compatibility pass keeping key `data-*`/aria attributes on moved controls wherever
  possible. No chunk closes while its specs are red.

**Features**

- `toolsRegistry` as the single tool inventory (every existing command, each with exactly one canonical
  home) + the per-pane stage model.
- Stage Rail with the four stages, the gear, `Ctrl+1..4` and the narrow-width collapse.
- ContextPanel with four stage panels: PAGES (the existing live-thumbnail stack + inline hover verbs +
  right-click menu + merge entry + the outline section), EDIT (content outline + recognition), REVIEW
  (annotations + signatures), DELIVER (pre-flight + new document).
- ActionDock (four states, pins, idle, responsive overflow) replacing the toolbar row.
- Inspector replacing the All-tools palette, re-parenting the existing property/panel components.
- CommandPalette (`Ctrl+K`, fuzzy, frequency-boosted, `Ctrl+Enter` pin).
- Floating page + zoom pills replacing the toolbar's view controls.
- The four stage tokens per theme.

**Success criteria**

1. Every existing tool is reachable in <= 2 interactions (stage + dock/panel, or Ctrl+K) and the registry
   contains every control found in the inventory audit - nothing removed, hidden or downgraded.
2. No toolbar row remains; the canvas gains the reclaimed space; the concept's four states are the only
   workspace chrome at the bottom-centre of the canvas.
3. The PAGES panel shows LIVE-RENDERED page previews with today's rotation/deleted/reorder reflection,
   drag-reorder with its drop indicators, multi-select bulk ops, current-page highlight and scroll sync -
   verified side by side with the old rail before the old rail is retired.
4. Delete/Flatten never appear on persistent chrome; Rotate/Delete appear only on thumbnails, the PAGES
   dock and the right-click menu.
5. `Ctrl+1..4` switch stages; every pre-existing shortcut still works (`Ctrl+P` = Print unchanged).
6. The palette lists every registry tool with its stage tag, fuzzy-matches, boosts by usage, and pins with
   `Ctrl+Enter` (max 4, persisted, restart-surviving).
7. All four dock states render per spec; idle never triggers while a tool is armed or a drag is in
   progress; pins survive a restart.
8. Every new surface is verified in light, dark AND frosted with zero hardcoded colours (the only allowed
   literals are the new per-theme token definitions) and meets the contrast floors.
9. All pre-existing unit and e2e tests pass, with new tests for stage switching, dock state transitions,
   pin persistence, the registry audit, the palette and the inspector; the migrated specs keep asserting
   the same behaviours.
10. Multi Mode keeps its Phase 32-34 behaviour (centred strips, one shared dock/rail, one composite tab,
    per-pane stage) with the DEF-282/286/287 invariants intact, and each pane owns its stage, panel, dock
    and inspector contents.
11. The Phase 35 behaviours and the print pipeline are untouched: print dialog/window, the in-app PDF
    output, the OS open/drop paths and the window behaviour all keep working.

**Settings impact:** TWO new fields, both validated in `src/main/services/settings.ts` before any renderer
code reads them (preserve-if-valid, reject-if-invalid, mirroring the Phase-6 pattern):
- `dockPins?: string[]` - tool ids pinned to the Action Dock, capped at 4 (an over-long or invalid array is
  truncated/dropped per the validator's rule); unknown ids are dropped on read.
- `toolUsage?: Record<string, number>` - per-tool run counts for palette frequency ranking; non-finite,
  negative or non-number values are rejected/dropped.
`toolsPaletteLayout` is retained as a TOLERATED LEGACY key for one release (no UI writes it; the validator
must keep accepting it so an existing settings.json does not fail validation).

## Phase 37 — STAGES feedback round (22 operator items)

**Operator request (2026-09-24):** the 22 numbered items below (verbatim groupings). All of them are
refinements of the Phase 36 surfaces - the design language, the motion tokens and every existing behaviour
stay; nothing may be removed or hidden.

**Features (grouped; the ruling text IS the contract)**

**A. Inspector integration + chrome (items 1, 3, 5, 10, 22)**
- The text-manipulation panel is INTEGRATED INTO the Inspector for BOTH the annotate flow and the edit flow:
  the text manipulation sits at the TOP of the Inspector and the Inspector's existing content below it,
  separated by a subtle divider; the whole column scrolls when it is too long.
- The secondary panel that appears after choosing a tool from the dock (e.g. an annotation tool) renders as
  ONE ROW with NO header. It follows the same responsive behaviours as the dock (E below).
- The Inspector is FLUSH with the canvas top (no rounded left corner, no disjointed gaps) and gains an
  expand/collapse control.
- The Inspector's buttons are professional: a comfortable hit target and legible label size (no tiny text).
- Rails and panels gain SUBTLE SEPARATORS between distinct controls/rows/text blocks so items read as
  distinct elements, not a wall of plain text.

**B. Thumbnail panel + rail (items 4, 8, 9, 15, 16, 18, 19)**
- The panel's collapse/expand chevron must actually flip with the state (it currently never changes).
- The Stage Rail is NOT visible on the welcome (home) screen.
- The panel header's "Pages…" text is removed and the panel becomes narrower accordingly.
- The Outline section's bottom is flush with the panel bottom, with a separator between the thumbnail area
  and the Outline section.
- The Multi Mode thumbnail strips are narrower (they carry too much empty space).
- The Multi Mode strips get the SAME options as the single-mode panel, including the right-click menu.
- Placement audit: no control or label touches the window/canvas edge ("Settings" currently does); icons,
  panels and docks all get industry-standard padding and alignment.

**C. Edit text (items 11, 12, 13)**
- After selecting text, the action bar is `Confirm`, `Delete`, `Cancel` - the `Edit` option goes (selecting
  the text already brings the text-manipulation panel).
- Selecting text must NOT make it invisible - the selected text stays visible.
- The "Edit content" verb is removed from the EDIT dock: entering the EDIT stage ENABLES edit mode in the
  canvas (the stage is the switch).

**D. Labels (item 14)** - "Renumber pages" is renamed "Rename pages" everywhere.

**E. Action Dock behaviour (items 2, 6, 7, 21)**
- The dock is ALWAYS ONE ROW. It must never stack vertically.
- Responsive ladder as the window shrinks, in this exact order: (1) collapse the Inspector, (2) collapse the
  thumbnail panel, (3) hide the dock verbs' LABELS to fit, (4) if still too wide, shrink the dock and show
  left/right ARROW controls to scroll the verbs. Growing the window reverses the ladder.
- The dock renders CONSISTENTLY in every theme (same surface, spacing, contrast).
- The dock contains ALL the relevant tools for the stage BY DEFAULT, and a tool can be UNPINNED from it;
  a small hint line above the dock points at `Ctrl+K` for searching tools.

**F. Retirements (item 17)** - the in-app print dialog/window is REMOVED; the print entry points (title-bar
Print, File > Print, `Ctrl+P`) open the standalone print window directly.

**G. Bug (item 20)** - the `watermark` dock tool is greyed with "open a document first" even when a document
IS open. The availability gate must reflect the real state.

**Success criteria**

1. With a text object selected in the annotate flow AND in the edit flow, the Inspector shows the text
   manipulation at the top and its own content below, split by a subtle divider, and the column scrolls
   without clipping (verified for a long control set at 640 and 1440 widths).
2. The secondary tool panel (after picking a dock tool) renders one row, no header; at narrow widths it
   follows the dock's label-hiding/arrow behaviours (E).
3. The Inspector is flush with the canvas top (no rounded left corner, no gap), can be collapsed and
   expanded, and its expanded state matches the canvas geometry; its buttons meet a professional size
   (state the pixel targets).
4. Every rail/panel shows subtle separators between its distinct controls/rows (a screenshot per surface).
5. The thumbnail panel's chevron flips with the collapsed state; the "Pages…" header is gone and the panel is
   narrower; the Outline is flush at the panel's bottom with a separator above it.
6. The Stage Rail is absent on the welcome screen and present with a document open.
7. Multi Mode's strips are narrower, carry the same options as single mode (drag-reorder, hover verbs,
   right-click menu, multi-select) and look identical in behaviour.
8. Edit text: the action bar is `Confirm` / `Delete` / `Cancel` (no `Edit`); the selected text stays VISIBLE;
   and entering the EDIT stage enables edit mode in the canvas with no "Edit content" verb in the dock.
9. "Rename pages" is the label everywhere (the dock/panel/palette/menu title).
10. The dock is one row at every supported width and never stacks; the responsive ladder collapses the
    Inspector, then the thumbnail panel, then the labels, then shows the arrows - in that order, reversing
    when growing.
11. The dock looks identical in light, dark and frosted (the same surface/spacing/contrast).
12. The dock carries all the stage's tools by default, a tool can be unpinned, and the `Ctrl+K` hint appears
    above it.
13. The in-app print dialog is gone; the title-bar Print / File > Print / `Ctrl+P` open the standalone print
    window (verified on the installed build).
14. The watermark tool is enabled with a document open (the gate bug fixed) and disabled with none, with the
    correct reason.
15. No control or label touches a window/canvas edge (the placement audit), verified by measuring the edge
    gaps of the header controls, the rail, the panels and the dock.

**Settings impact:** one new field - `dockUnpinned?: string[]` (the tool ids the user removed from the dock;
validated like `dockPins`: an array of non-empty strings, de-duplicated, unknown ids dropped on read, a
cap to keep the file bounded). No other settings change.

## Phase 38 — Installation, legibility, the legacy text panel, edit fidelity and a multi-view glitch (5 operator items)

**Operator request (2026-09-25):** the five numbered items below (verbatim intent). Items 1 and 2 change the
product's packaging and visual language; items 3 and 4 retire a surface and correct the edit-text experience;
item 5 is a crash-class rendering bug on a real-world document that must be root-caused, not patched.

**Features**

**A. Standard Windows installation, 64-bit and 32-bit (item 1)**
- TFlex installs to the standard per-machine Program Files location, like any other Windows application:
  the 64-bit build to `C:\Program Files\TFlex` and the 32-bit build to `C:\Program Files (x86)\TFlex`
  (never the per-user `%LOCALAPPDATA%\Programs` location). The installer is a real per-machine install
  (the standard elevation prompt, an Add/Remove Programs entry, an uninstaller in the install folder).
- **Operator ruling (2026-09-25) - 32-bit is DEFERRED.** The pinned runtime (Electron 44) publishes no
  32-bit Windows binary upstream (`electron-v44.0.0-win32-ia32.zip` 404s; the local `checksums.json` lists
  only x64 and arm64 for win32), so an ia32 installer cannot be produced without repinning Electron -
  which would re-open validation of printToPDF, window behaviour and electron-updater. The operator chose
  x64-only for now. The release therefore ships ONE per-machine installer for x64 plus its portable build,
  with the architecture token kept in the artifact name so the updater's arch selection stays correct and
  an ia32 target can be added later without renaming anything. The ia32 target returns only if the runtime
  is deliberately repinned.
- Auto-update keeps working: the feed carries the x64 installer and the updater selects the entry whose
  URL matches the running architecture's token (`process.arch`); the mechanism is proven by the emitted
  metadata names and the updater's actual requested URL.
- **The installer removes the LEGACY per-user install** (operator ruling, 2026-09-25): the pre-1.30
  releases installed to `%LOCALAPPDATA%\Programs\TFlex` with a per-user uninstall entry and a per-user
  `.pdf` ProgID. A per-machine install must not leave that second copy behind - it removes the old install
  directory, its per-user uninstall registry entry and its per-user file-association ProgID.

**B. Rich, readable icons and text (item 2)**
- Icons and their labels are bigger, higher-contrast and colourful: the UI must read as rich, not as a wall
  of uniform grey. Tool families carry a distinct accent colour, while the icon shape and the label remain
  the primary differentiators (colour is never the only signal).
- Every interactive label and icon meets a legibility floor in ALL THREE themes (light, dark, frosted):
  text contrast at least 4.5:1 against its ACTUAL surface and icon/graphic contrast at least 3:1, with
  stated minimum sizes (no icon below 18px, no control label below 12px). Disabled states stay visibly
  distinct from enabled ones.

**C. The legacy text-manipulation panel is retired (items 3 and 4, second half)**
- The OLD floating text-manipulation panel - and its drag-to-move behaviour - is REMOVED from every flow.
  The Inspector-hosted text manipulation (Phase 37 item A) is the ONLY text-manipulation surface; it stays
  fixed in the Inspector and is not movable. No capability may lose its home in the retirement.

**D. Editing text looks like editing the original text (item 4, first half)**
- While a text object is being edited, the canvas editor renders the text at the SOURCE run's size and
  format (no visual shrink) and the original glyphs are FULLY covered - no ghost/duplicate of the old text
  may remain visible behind the edited text.
- Selecting a text object ACTIVATES the Inspector's text field (DOM focus), so the user can start typing
  immediately without first clicking the field.

**E. The multi-view page glitch on a real-world document (item 5)**
- `TanzimulIslamPaySlip20260930.pdf` (the operator's real payslip) opened as the SECOND document in Multi
  Mode glitches violently. The glitch is reproduced, ROOT-CAUSED with evidence (not guessed), filed as a
  defect, fixed, and the fix verified on that exact file plus the fixture corpus - no regression to single
  mode, to pane 1, or to the other fixtures.

**Success criteria**

1. After the installer runs on a 64-bit device, `TFlex.exe` lives under `C:\Program Files\TFlex` (measured
   path, not asserted from config), the install is per-machine (an Add/Remove Programs entry and an
   uninstaller exist), and no per-user `%LOCALAPPDATA%\Programs\TFlex` install remains.
2. The installed artifact's name carries its architecture (`-x64`) and that token is what the updater
   matches on; a 32-bit artifact is NOT produced while the runtime pin has no ia32 build - the deferral is
   recorded with its evidence (the upstream 404 and the checksums listing).
3. The published release carries the x64 installer, its blockmap, the x64 portable build and the feed
   metadata; the feed's entries and the updater's requested URL are reported as measured evidence.
   Installing over an existing legacy per-user install removes it: after the per-machine install there is
   NO `%LOCALAPPDATA%\Programs\TFlex` directory, no per-user uninstall entry and no per-user `.pdf`
   ProgID left behind.
4. Every interactive text label meets at least 4.5:1 contrast and every icon at least 3:1 against its real
   surface, in light, dark and frosted themes - measured by an automated sweep over the shipped controls,
   with the failing element named if any exists (zero failures required).
5. Icon and label sizes meet the stated floors (icon at least 18px, label at least 12px) across the dock,
   the stage rail, the panels, the Inspector and the header; the sizes are measured, not asserted from CSS.
6. Tool families are visually distinguishable by colour in all three themes (a screenshot per theme), and
   colour is never the only differentiator (shape/label carry the meaning).
7. The legacy text-manipulation panel is absent from the DOM in every flow (annotate and edit), its drag
   handle no longer exists, and exactly ONE text-manipulation surface renders - the Inspector's, fixed in
   place (a screenshot plus a DOM assertion for both flows).
8. No tool or capability lost its home in the retirement: the registry x surfaces sweep passes, and the
   Ctrl+K palette still reaches every text-manipulation control the retired panel offered.
9. While editing, the canvas editor's rendered text size equals the source run's size (within 0.5px) at
   several source sizes and zoom levels, and a pixel-difference of the edited region shows the original
   glyphs fully covered (no ghost text) - measured, with the numbers reported.
10. Selecting a text object focuses the Inspector's text field (`document.activeElement` is that input) and
    typing immediately changes its value without a manual click, verified in both the annotate and edit
    flows.
11. The payslip document opens as the second Multi Mode document and renders with NO violent glitch:
    painted-frame capture across opening in pane 2, focus switching, scrolling and zooming shows zero
    blank/garbled frames, and the defect record states the root cause with its evidence.
12. No regression: the full unit suite and the phase's e2e suite are green, the canonical installed spec
    passes against the Program Files install, and the previously released behaviours (Phase 36/37 surfaces,
    single mode, pane 1) are unchanged.

**Settings impact:** none - no new `AppSettings` field; the packaging change is build configuration and the
UI changes are tokens/styles, not user preferences.

## Phase 39 — Multi Mode consistency round (4 operator items)

**Operator request (2026-09-25):** the four numbered items below (verbatim intent). Three are concrete
defects seen with ONE document open in Multi Mode; the fourth asks for a DEEP SWEEP so Multi Mode's dock
behaves exactly like single mode. Multi Mode must not be a second-class surface.

**Features**

**A. The thumbnail preview must sit inside its page frame (item 1)**
- With ONE document open in Multi Mode, the page preview inside the thumbnail panel must render WITHIN its
  page border/box at every pane width and zoom - no part of the preview may spill outside the page frame
  or overlap the panel's edges.

**B. The pane's "Open a PDF" must open the file picker (item 2)**
- In Multi Mode, clicking the pane's "Open a PDF" affordance must open the standard OS file picker and open
  the chosen document into that pane. It must NOT resize the panes, move the divider or enlarge the left
  pane. This holds with one document and with two.

**C. The dock must exist and be correctly placed in Multi Mode (item 3)**
- With ONE document open in Multi Mode, the Action Dock must render and work exactly as in single mode -
  the same stage verb set, the same availability gates, the same pins.
- No control may overlap another panel: the page-rotate control that currently sits at the bottom of the
  thumbnail panel over other content must have ONE correct home (consistent with single mode) and must not
  intersect any other panel or control.

**D. Deep sweep: Multi Mode's dock must behave identically to single mode (item 4)**
- Every dock behaviour is compared between Multi Mode and single mode for each of the four stages: the
  default verb set and its curation, the availability gates, pins/unpins and their persistence, the
  responsive ladder (Inspector collapse, panel collapse, labels, arrows), the one-row guarantee, the
  hover/pressed/disabled/selected states, the right-click menu, the secondary row / annotations flyout,
  the Ctrl+K palette reach, and the Inspector's text integration. Every divergence is either FIXED or
  recorded as an operator-approved difference with a reason.

**Success criteria**

1. With ONE document in Multi Mode the thumbnail preview renders inside its page frame at the default
   window and at narrow/wide panes and several zoom levels (measured bounding boxes: the preview's box is
   inside the page's box; a screenshot per case).
2. Clicking the pane's "Open a PDF" in Multi Mode opens the OS file picker (the standard open flow) and the
   chosen document lands in that pane; the pane split and the divider position are UNCHANGED by the click
   (measured before/after). Verified with one and with two documents.
3. With ONE document in Multi Mode the Action Dock renders, and for every stage its verbs are reachable and
   identical to the single-mode set (a per-stage comparison with the single-mode baseline).
4. No control overlaps another: measured bounding boxes for the dock, the thumbnail panel, the rotate
   control, the pills and the Inspector show ZERO intersections in Multi Mode at the default and narrow
   widths, with one and with two documents.
5. The page-rotate (and every other page action) has exactly ONE home, the same one it has in single mode;
   no duplicate or floating page-action control remains anywhere.
6. A single-vs-multi comparison MATRIX is produced for all four stages covering every behaviour listed in
   feature D, with a verdict per row; every divergence is fixed or carries an operator-approved reason.
7. The dock's behaviour is identical in Multi Mode and single mode for the same stage and window width -
   the matrix has zero unexplained divergences.
8. No regression: single mode is unchanged, the Phase 38 criteria still hold (the legibility floors, the
   retired text panel, the edit fidelity, the pane first-fit), and `verify:full` plus the phase suites are
   green.

**Settings impact:** none - no new `AppSettings` field; this is behaviour parity and layout correction.

## Phase 40 — Chrome, dialogs, view modes and a professional design system (14 operator items)

**Operator request (2026-09-25):** the fourteen numbered items below (verbatim intent). This round mixes
concrete faults, three new affordances (a top-bar search icon pair, palette pin toggles, a single-view
page layout), one new capability (merge from scratch) and a design-system pass. The operator also ruled:
**no local install is required any more - they install through OTA** - so the release gate verifies the
PACKAGED build and the operator picks the update up over the air.

**Features**

**A. Multi Mode pill placement (item 1)**
- In Multi Mode the zoom control and the page-number control must be laid out HORIZONTALLY, one on each
  side of the individual canvas they belong to. No dock/pill group may ever be organised vertically at any
  window size - this supersedes the Phase 39 narrow-width stacked band.

**B. Readability and chrome (items 2, 13)**
- The "Open" button's label must be readable WITHOUT hover (its resting state must meet the Phase 38
  contrast floors - measured, not eyeballed).
- The top bar's Open/Save controls must lose their background box in EVERY theme (a borderless/ghost
  treatment that keeps the hover/focus affordance and the contrast floors).

**C. Dialogs (items 3, 4)**
- The "Create from images" window must resize with the application window (a responsive dialog that stays
  usable and inside the window at small and large sizes).
- "Merge PDF" must be startable FROM SCRATCH with no document open: the user selects multiple PDF files in
  one multi-select picker and combines them. This needs a new multi-file open dialog in the main process
  (a new IPC returning the picked paths) - the shared contract is extended for it.

**D. Header and palette affordances (items 5, 6, 8)**
- The top bar gains TWO distinct, intuitive icons: one for the Ctrl+K tool search and one for the Ctrl+F
  search. They must be visually unique from each other and self-explanatory.
- Every tool row in the Ctrl+K palette gains a PIN toggle beside it: clicking pins/unpins that tool, and
  the pin icon reflects the current state (pinned vs unpinned) - it must not be ambiguous.
- The Multi Mode toggle's hover tooltip must say "view/edit two ..." (the word "edit" added).

**E. Single-view page layouts (item 7)**
- The single-view canvas gains a page-layout control at its TOP-RIGHT offering three options: One page
  (the default), Two pages side by side, and Four pages in two rows. The chosen layout renders that many
  pages of the document at a time, with the icon reflecting the current layout.

**F. Retirements and panel layout (items 9, 10)**
- The page rotate/delete control that appears UNDER the page thumbnail when a page is selected is RETIRED
  in BOTH single and multi mode. The capabilities stay reachable through their other homes (the dock verbs
  and the page right-click menu) - no capability may lose its home.
- The Outline section must be flush to the bottom of the panel when EXPANDED as well (not only collapsed).

**G. Professional design system (items 11, 12)**
- Replace the ad-hoc per-family icon hues with a small, SEMANTIC palette: three to four set colours
  assigned by tool category/importance, applied consistently to icons and to application text. Colour is
  used methodically for separating lines and panel edges (not decoration), so the UI reads professional.
- The ContextPanel and the Inspector are the reference standard for organisation and typography; bring the
  other surfaces (the dock, the palette, the panels, the dialogs) to that standard of organisation.
- Research industry-standard practice where it helps; the outcome must be measurable (the palette is a
  named, finite token set; the contrast floors still hold in all three themes).

**Success criteria**

1. In Multi Mode the page and zoom controls render HORIZONTALLY, one on each side of their own canvas, at
   every supported window width (640 through 1920, one and two documents) - measured: the two controls'
   boxes are side by side, not stacked, and intersect nothing.
2. The "Open" button's resting label meets at least 4.5:1 against its real surface in all three themes
   (measured, with the failing ratio named if any).
3. The top bar's Open/Save controls have no background box in light, dark or frosted (measured: no
   background fill/border on the resting state), while their hover/focus affordance and contrast floors
   survive.
4. The "Create from images" dialog resizes with the window: at a small window it fits inside the viewport
   with no clipped control, and at a large window it uses the space (measured boxes + screenshots).
5. Merge PDF can be started with NO document open: the multi-select picker returns several files and the
   merge produces a combined document (report the picked paths and the resulting page count).
6. The top bar shows two distinct search icons (Ctrl+K and Ctrl+F); they are visually different from each
   other, each has an accessible name, and each activates its own surface (measured + screenshot).
7. Every Ctrl+K palette row has a pin toggle: clicking it pins the tool, clicking again unpins it, the icon
   changes with the state, and the pin persists across a restart (the existing pins store).
8. The Multi Mode toggle's tooltip reads "view/edit two ..." (the word "edit" present).
9. The single-view page-layout control offers exactly three options (one page, two side by side, four in
   two rows) and each renders that layout; one page is the default; the icon reflects the current layout.
10. The under-thumbnail rotate/delete control is GONE in both single and multi mode (DOM assertion), while
    rotate and delete remain reachable from the dock and the page right-click menu (verified by running
    them).
11. The Outline is flush with the panel's bottom in the EXPANDED state as well as collapsed (measured
    bottom offsets).
12. The icon/text palette is a named, finite set of three to four semantic colours assigned by category or
    importance, applied consistently to icons and text in all three themes, with the contrast floors still
    met (report the palette and the measured ratios).
13. Separators and panel edges use colour methodically (a stated rule), not decoration; the other surfaces
    match the ContextPanel/Inspector standard of organisation (screenshots per surface).
14. No regression: single mode, the Phase 36/37/38/39 behaviours (the dock ladder, the legibility floors,
    the retired text panel, edit fidelity, the pane fit and the Multi Mode parity) all still hold, and
    `verify:full` plus the phase suites are green.

**Settings impact:** none - no new `AppSettings` field. The page-layout choice (item 7) is a per-tab,
session-scoped view state, not a persisted preference; the palette pin toggles reuse the existing
`dockPins`. The ONE shared-contract change is a new multi-file open dialog IPC (item 4):
`openFilesDialog(kind?: OpenFileDialogKind): Promise<string[]>` - the main-process handler uses
`properties: ['openFile', 'multiSelections']` and returns the picked paths (an empty array on cancel).

## Phase 41 — Inspector surface, the legacy EDIT toolbar, selection styling and separators (4 operator items)

**Operator request (2026-09-26):** the four numbered items below (verbatim intent). All four are
refinements of the Phase 36-40 chrome; the design language, the four-role palette and every behaviour stay,
except where an item explicitly supersedes a rule.

**Features**

**A. The Inspector must be opaque and never overlapped (item 1)**
- In EDIT mode the Inspector renders with the SAME surface treatment as every other stage - no
  transparency - and no canvas content (page text, overlays, edit layers) may render behind or through it.
  The z-order and any clipping that lets content bleed over the panel are fixed.

**B. Retire the legacy EDIT toolbar (item 2)**
- The edit-mode toolbar at the top of the canvas is RETIRED. Before it goes, EVERY control it offers is
  audited and given a home in the dock, the Inspector or the Ctrl+K palette; anything without a home gets
  one first. No capability may be lost, and each must be reachable with a document open in EDIT.

**C. Professional selection styling (item 3)**
- The selected option in the text-manipulation panel's align/spacing controls, and the selected page in the
  thumbnail panel, get a professional selection treatment instead of the current blue highlight: a
  consistent, low-saturation selection style (a tinted fill with a border/glow and the accent reserved for
  the glyph), identical in geometry and timing across themes, meeting the contrast floors.

**D. Separators and the Inspector edge (item 4)**
- A separator line is added between the side rail and the ContextPanel.
- The BLUE line on the Inspector's edge is removed and replaced by a shadow/subtle glow separator. This
  supersedes the Phase 40 rule "the active panel edge takes `--sem-primary`" - the active/selected state is
  conveyed by the shadow/glow instead.

**Success criteria**

1. In EDIT the Inspector's computed background is opaque and of the same kind as the other stages (report
   the computed background per stage); a sample of the region across its edge in EDIT shows no canvas text
   or overlay bleeding through (screenshot with text hard against the panel).
2. No canvas content renders behind the Inspector in ANY stage (measured z-order/stacking plus a
   screenshot per stage).
3. The legacy edit toolbar is absent from the DOM in EDIT (assertion), and EVERY control it offered is
   accounted for in an audit table (control -> new home -> the proof it still runs); nothing is
   unreachable.
4. The text panel's selected align/spacing option and the thumbnail's selected page use the new treatment:
   no raw blue fill (measured computed styles), the same selection token in all three themes, and the
   contrast floors still met.
5. A 1px neutral separator exists between the side rail and the ContextPanel (measured; no gap and no
   overlap at 1440 and 900).
6. The Inspector's page-facing edge shows a shadow/subtle glow rather than the accent line (measured: no
   accent colour on the edge; the glow present), and an active selection is still visually distinguishable.
7. No regression: the Phase 36-40 behaviours (the dock ladder, the legibility floors, the retired text
   panel and edit-toolbar behaviour, the pane fit, the Multi Mode parity, the page layouts) all still hold,
   and `verify:full` plus the phase suites are green.

**Settings impact:** none - no new `AppSettings` field; this is surface styling, a retirement and an audit.

## Phase 42 — Tool icon identity and one home per tool (2 operator items)

**Operator request (2026-09-26):** the two items below (verbatim intent). The tool registry must give every
tool its OWN icon, and a tool must live in exactly one stage's dock.

**Features**

**A. One icon per tool (item 1)**
- No two registry entries may share an icon: every tool gets its own distinct, descriptive icon, so a user
  can tell two tools apart by their glyph alone. Every existing duplicate is found and fixed - not just the
  reported watermark/edit-text pair - and the invariant is enforced by a test so it can never regress.

**B. One home per tool (item 2)**
- The watermark tool currently appears in BOTH the EDIT and the REVIEW dock. It must appear in exactly ONE
  stage's dock (the stage the registry designates), must no longer leak into the other, and must stay
  reachable through the Ctrl+K palette. No capability may be lost.

**Success criteria**

1. An automated assertion over the tool registry reports ZERO duplicate icons (report the before state: the
   duplicate groups found, and the after state: the count of entries vs the count of distinct icons).
2. Every fixed duplicate receives a distinct icon that describes its tool; report id -> old icon -> new icon
   for each, and confirm each renders at the standard glyph size with the corrected contrast floors.
3. The watermark tool appears in exactly ONE stage's dock; report which stage, and the measured per-stage
   dock verb lists showing watermark present exactly once across PAGES/EDIT/REVIEW/DELIVER.
4. The watermark capability is not lost: it is reachable from the Ctrl+K palette and RUNS from there
   (verified by running it, not by reading the registry).
5. No other tool lost or gained a home: the registry x surfaces sweep still accounts for every entry, and
   every other stage's dock set is unchanged unless the item required it (report any change).
6. No regression: the dock's one-row/ladder behaviour, the Phase 41 styling and the earlier phases all hold,
   and `verify:full` plus the phase suites are green.

**Settings impact:** none - no new `AppSettings` field; this is registry data (icons) and one stage mapping.

## Phase 43 — Animation completeness and app-wide icon identity (2 operator items)

**Operator request (2026-09-26):** the two items below (verbatim intent). The Phase 15 animation system is
the contract for item 1 ("every element should have animation"); the Phase 42 uniqueness rule is extended
app-wide by item 2.

**Features**

**A. Animation completeness (item 1)**
- The single-view page-layout transition (one <-> two <-> four pages) must ANIMATE through the centralised
  motion system - the page slots move/fade with the layout change instead of snapping - respecting
  `prefers-reduced-motion` (immediate switch) and the Phase 15 rule that PDF page CONTENT is never
  recoloured or cross-faded (the layout/box animates, the page's own pixels do not).
- A full AUDIT of the application finds every element that lacks an animation and fixes it: every
  interactive surface (dialogs, popovers/menus, the palette, the dock, the panels/rail, the tabs, the
  flyout, the pills, the toasts, the context menus, the thumbnail selection, the layout control, the
  collapse/expand controls) must use a motion token - no hardcoded durations/easings - or carry a stated
  reason it must not animate.

**B. No two elements share an icon (item 2)**
- The Multi Mode toggle and the two-page layout option currently share the same icon. No two elements of
  DIFFERENT actions may share an icon anywhere in the app - not just in the tool registry. One universal
  action repeated verbatim (the close affordance) counts as ONE action; everything else gets its own glyph.
- The uniqueness invariant is extended to cover the app's icon usages (registry + header controls + the
  layout control + the dock/palette/panels/dialogs/pills) so it cannot regress.

**Success criteria**

1. Switching the page layout (one/two/four) animates: frame capture shows a transition on the page slots
   using the motion tokens (report the token, the duration and the captured frames); with reduced motion
   enabled the switch is immediate; the page CONTENT's pixels are not recoloured during the transition.
2. An animation audit table is produced listing every interactive surface/element, its animation and the
   token used - and every entry is either token-animated or carries a one-line reason it must stay static
   (the table is part of the report; keep it where the team can read it).
3. Every element the audit found without animation is fixed, with the token named per element.
4. No two DIFFERENT actions share an icon anywhere in the app: the Multi Mode toggle and the two-page layout
   option are distinct, and a sweep of all icon usages finds no other duplicate (report the before/after
   duplicate list; an automated assertion covers it so it cannot regress).
5. The changed/new icons render at the standard sizes with the contrast floors met in all three themes, and
   each still describes its control.
6. No regression: the Phase 15 motion rules (tokens only, identical timing across themes, transform/opacity
   only, reduced-motion fallback, PDF content protected), the Phase 42 registry invariant, and the earlier
   phases all hold; `verify:full` plus the phase suites are green.

**Settings impact:** none - no new `AppSettings` field; motion tokens are CSS/JS constants, and the icon
change is presentational.

## Standing standards (operator rulings, apply to every phase from now on)

**Animation - HARD RULE (operator, 2026-09-26).** Every element that appears, disappears, moves, changes
state or responds to input must animate through the CENTRALISED motion system: `src/renderer/hooks/motionTokens.ts`
plus the `src/renderer/styles/animations.css` tokens and the `AnimatedDialog`/`AnimatedPanel`/`AnimatedTab`
wrappers. No hardcoded durations or easings; transform/opacity only (never width/height/margin); identical
timing in light, dark and frosted; a `prefers-reduced-motion` fallback; and PDF page content is never
recoloured or cross-faded. Every phase that adds or changes a surface must state that surface's animation
and the token it uses, and the animation guard test must cover it. A new or changed element with no
token-based animation is a DEFECT, not a polish item.

**Icon identity (operator, 2026-09-26).** No two elements of different actions may share an icon anywhere in
the app. One universal action repeated verbatim (the close affordance) counts as one action; the same action
mirrored on two surfaces is allowed and must be allow-listed with a written reason. The icon guard test must
cover every surface.

**Test discipline (operator, 2026-09-26).** Targeted tests per change; the full suite only at a release gate
or when the human explicitly asks. Do not run the full suite "to be safe".

**To-do discipline (operator, 2026-09-26).** The orchestrator maintains a live to-do list for the run and
reports pending / in-progress / done in every dispatch summary.

**Version numbering - STANDING RULE (operator, 2026-09-27).** A release of BUG FIXES takes a **PATCH** bump
(1.39.0 -> 1.39.1). A **MINOR** bump is for new features/capabilities. A **MAJOR** bump is only for a breaking
change. Never bump a minor for a fix batch. (The operator corrected 1.39.0 -> 1.40.0, which should have been
1.39.1.)

## Phase 44 — Accounts and cloud sync on Neon (operator request 2026-09-26)

**Operator request (verbatim intent):** the app gets a **Sign in / Sign up** option on the top bar; users can
register or sign in with **email or Google**; **email registration requires verification**; registered users
are stored in **Neon**; the account also stores the user's **app settings and signatures** so that signing in
on any device restores them; **account deletion and data export** are included; the whole feature ships
**behind a flag** until battle-tested; **OTA stays on GitHub** (this database is NOT used for updates).
Operator rulings that shape it: the Neon project is `twilight-tooth-46220295` ("RealTflex", `aws-ap-southeast-1`),
the email sender is Neon's **shared** provider, and the free **0.5 GB** storage limit must be respected.

**SUPERSESSION (recorded deliberately).** The v1 contract says "No network calls in product code. v1 is fully
offline." Phase 44 deliberately supersedes that for the accounts and sync paths ONLY: the app must remain
fully usable **offline and signed-out**, with local data authoritative while signed out, and every network
path must degrade gracefully (never block the UI, never lose local work).

**Prerequisites that are NOT code (see "Unowned paths" below) - both are required before implementation can
land:**
- **P1 - the conventions gate must be amended.** `scripts/check-conventions.mjs` scans `src/` and fails on
  `fetch(`, `XMLHttpRequest`, `http/https/net/dns` imports and ANY non-localhost URL literal, so the accounts
  transport cannot exist in `src/` under the current rule. The amendment is NARROW: keep the rule for
  everything, add an explicit allowlist naming the ONE accounts/sync module path (e.g.
  `src/main/services/accounts/**`) and the permitted hosts (`*.neon.tech` only), with the reason recorded in
  the script. No other file and no other host becomes permitted; the check must still fail for a network call
  anywhere else.
- **P2 - the Neon infrastructure files** (`neon.ts` body, the Function source) live at the repo root and are
  writable by no role today. They are needed only for the Neon FUNCTION and the declared-bucket wiring; Auth,
  the Data API, the schema, RLS and the `tflex` bucket are already live, so the accounts/sync feature does NOT
  depend on P2.

**Features**

**A. The account section in the top bar (operator amendment, 2026-09-27).** The top-RIGHT of the top bar
carries the account, properly:
- **Signed out:** a sign-in entry that opens the sign-in / sign-up surface (email + password, **Continue with
  Google**).
- **Signed in:** a **round avatar** control. It shows the user's profile IMAGE when one is set; otherwise it
  shows their **INITIALS** (first name + last name; a single name yields one letter; with no name at all it
  falls back to the first letter of the email). It carries an accessible name (the user's name, else the
  email).
- **Clicking it EXPANDS a panel** anchored to the avatar showing the user's profile (avatar, name, email) and
  offering **Update profile** and **Sign out** (plus **Sync now** and the live sync status). **Update
  profile** opens a form for the fields the identity provider actually allows the user to change (the
  Managed provider permits the display name; it does NOT permit changing the email or password - the UI must
  state that rather than offering a control that cannot work).
- **There is NO beta toggle.** Accounts are simply ON: the `accountsEnabled` setting remains an internal
  escape hatch with a default of true, but it is NOT exposed as a Preferences row (the operator removed
  that), so the account section is always present.
Everything obeys the standing animation and icon rules.

**B. Email verification.** A registration with email must be verified with the **OTP code** Neon emails
(Neon's shared sender; production may move to custom SMTP later). The UI must handle: code sent, wrong code,
expired code, resend, and the verified-signed-in state.

**C. Settings sync.** The signed-in user's app settings are stored in `public.user_settings` (one row per user,
JSONB) and restored on any device. **Device-local fields are EXCLUDED** and never synced: window geometry, the
recent-files list, and any path-bearing field. Conflict rule: **last-write-wins per record** on `updated_at`
with a `revision` counter; the FIRST link of a device to an existing account makes the **cloud authoritative**,
after which the newest write wins. Sync is debounced and must never block or slow the UI.

**D. Signature sync.** The user's signatures live in `public.user_signatures` (metadata: label, kind
`drawn|typed|image`, payload for vector/typed data, `storage_key` for images) with the **image bytes in the
private `tflex` bucket**, never base64 in the database. Deletes are SOFT (`deleted_at`) so a second device
converges.

**E. Storage discipline (the operator's 0.5 GB cap).** Settings stay a few KB per user; signature images go to
the bucket; per-signature and per-user caps are enforced in the app so a user cannot fill the branch limit;
no counters, logs or analytics tables are added.

**F. Offline and signed-out behaviour.** No network call on startup; the app never waits on the network to
become usable; a failed sync surfaces a non-blocking message and retries later; signing out leaves all local
data intact.

**G. Security.** The **JWT is the only credential** the app holds; it is stored with Electron `safeStorage`,
never in `settings.json`, never logged, never committed. The **Data API's RLS is the per-row boundary**
(`auth.user_id() = user_id`) with `authenticated`-role grants and NO `anonymous` privileges; the app must never
be trusted to filter rows. The client secret exists only in Neon's server-side config.

**H. Flag, deletion and export.** The whole feature is hidden behind an `AppSettings` flag (default OFF) until
battle-tested. **Delete my account** erases the user's `user_settings` row, their signatures and their bucket
objects, then the auth user. **Export my data** writes a JSON (plus the images) the user chooses a location for.

**Success criteria**

1. With the flag OFF, no account surface is reachable anywhere and the app behaves exactly as today (verified
   by the existing suites plus a targeted assertion).
2. With the flag ON, the top bar offers Sign in / Sign up; email registration sends an OTP; entering the code
   verifies and signs the user in; a wrong or expired code shows a clear, non-blocking error; resend works.
3. Google sign-in completes on a real machine through the system browser and returns to the app signed in
   (the redirect URI `https://ep-fragrant-pond-b3gqd6cf.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth/callback/google`
   is registered in the operator's Google project).
4. Signing in on a second device (or a fresh profile) restores that user's settings and signatures.
5. Device-local fields (window geometry, recent files, paths) are NEVER overwritten by a sync (verified by
   syncing after locally moving/resizing the window and reopening a file).
6. Two devices editing settings resolve by last-write-wins on `updated_at`, with no data loss of the newer
   write.
7. Signature images land in the `tflex` bucket and the database holds only metadata (verified by inspecting
   both); a soft-deleted signature disappears on the other device after a sync.
8. Signing out restores local-only behaviour with all local data intact; sync failures never block the UI
   (verified with the network unreachable).
9. The JWT is never in `settings.json`, never in a log, never in the repo (grep assertion + a manual check of
   the storage location).
10. **Adversarial: a signed-in user cannot read or write another user's rows or objects** - attempts through
    the Data API and the bucket are denied by RLS/policies, and the attempt is recorded as a release blocker
    if it succeeds.
11. Delete my account removes the rows, the signature objects and the auth user (verified from the Neon side).
12. Export my data produces a readable JSON plus images at the user's chosen location.
13. Sync is debounced and small: the measured payload per sync and the row sizes are reported, and the
    projected per-user storage stays far below the 0.5 GB branch limit.
14. No regression: the standing standards (animation, icon identity), the earlier phases and `verify:full`
    all stay green; the measured startup time is unchanged with the flag both off and on.

**Settings impact:** three new `AppSettings` fields, all validated in `src/main/services/settings.ts`
(preserve-if-valid, reject-if-invalid) before any renderer reads them: `accountsEnabled?: boolean` (default
false - the feature flag), `syncDeviceId?: string` (a generated install id used for conflict notes; non-empty
string, capped length) and `lastSyncedAt?: string` (an ISO timestamp for display only). **The session/JWT is
NOT a settings field** - it is stored via Electron `safeStorage` in the main process.

## Phase 45 — Account surface rebuild + seven UI corrections (operator report, 2026-09-27)

**Operator report (verbatim intent).** The account surface "is too barebone and looks totally disjointed from
the app", has "empty spaces on the right for no reason", no Google icon, no forgot-password option, and it
DOES NOT WORK: "Clicking continue with google or email returns 'You appear to be offline. Check your
connection and try again.'" Plus seven numbered UI defects. The operator's standing demand: **do not ship
half-done surfaces.**

**ROOT CAUSE OF THE BROKEN DIALOG (diagnosed, not guessed):** `src/renderer/index.html` sets
`connect-src 'self' blob: data:`, so the renderer is FORBIDDEN from making ANY network request. The Neon auth
SDK's call is blocked by the CSP and the failure surfaces as a false "offline" error. Phase 44 added the
Google avatar host to `img-src` but never touched `connect-src`.

**Features**

**A. The account surface, rebuilt (operator complaint).**
- **The CSP must permit the app's own backend hosts**, narrowly: `connect-src` gains the provider domain
  (e.g. `https://*.neon.tech` - one trusted provider, which covers the auth host, the Data API host and the
  Function host on every branch). Nothing else is opened, and the reason is commented in place.
- **The surface must look like part of TFlex**, not a bare form: a branded header, a purposeful layout with
  **no dead space**, sensible widths/heights, the app's own controls and spacing, and the standing animation
  and icon rules.
- **A real Google button** with the Google mark (not a text-only button), and a **Forgot password?** flow
  (request a reset + complete it).
- Correct, honest states: loading, wrong credentials, unverified email, the OTP step, and "offline" ONLY when
  the app is actually offline.

**B. Create from images: the clipboard and the preview (item 1).** "Create from clipboard" must accept a
COPIED IMAGE and must NOT treat plain text as an image; the image preview must render inside that dialog.

**C. Distinct tab colours (item 2).** Each open document tab carries its own colour, visibly distinct from
its neighbours (in every theme).

**D. The Multi Mode activation animation (item 3).** Entering and leaving Multi Mode animates through the
centralised motion system (it currently does not).

**E. The EDIT dock highlight (item 4).** With "Edit mode off" active, NO other edit verb may appear selected;
and "Edit mode off" sits at the FAR LEFT of the edit group.

**F. The thumbnail/Undo overlap (item 5).** The first page preview must not overlap the "Undo last change"
control.

**G. Dialog proportions (item 6).** Tool windows (Watermark and the other long ones) are too tall: make the
dialogs as SQUARE as practical and re-lay out their contents to fit the new shape.

**H. Watermark custom position (item 7).** The Watermark dialog gains a tick for a CUSTOM X/Y position;
ticking it DISABLES the predefined position choices.

**Success criteria**

1. With the app online, email sign-in and Google sign-in both COMPLETE (no false offline error) - verified on
   a real machine with a real account; the CSP change is limited to the provider domain and the reason is
   commented.
2. The account surface matches the app's design language: branded, no dead space (measured: the panel's
   content fills its box at 1440 and at the minimum window), with a Google button carrying the Google mark
   and a working Forgot-password flow.
3. The states are honest: a wrong password says so, an unverified account says so, the OTP step works, and
   "offline" appears only when the app is genuinely offline (verified by blocking the network).
4. "Create from clipboard" inserts a copied IMAGE (verified with a real clipboard image) and refuses plain
   text with a clear message; the image preview renders in that dialog.
5. Every open tab has a distinct colour; two adjacent tabs are always visually distinguishable in all three
   themes.
6. Entering and leaving Multi Mode animates (frame capture), token-driven, reduced-motion safe.
7. In EDIT, selecting "Edit mode off" leaves no other edit verb looking selected, and it is the LEFTMOST verb.
8. The first thumbnail's preview does not intersect "Undo last change" (measured boxes, zero intersection).
9. The named long dialogs are re-shaped to a squarer box (report each dialog's before/after aspect ratio) and
   every control still fits with no clipping or scrolling loss.
10. The Watermark dialog's custom tick disables the predefined positions while ticked and restores them when
    unticked, and the chosen X/Y are applied to the produced watermark.
11. No regression: the standing standards (animation, icon identity), the console gate, and `verify:full`
    plus the phase suites stay green.

**Settings impact:** none - no new `AppSettings` field; the dialog shapes, the tab colours and the watermark
position toggle are view state, not preferences.

## Phase 48 - Deleted signatures must actually leave the cloud + three annotation corrections

**Operator report (verbatim intent, 2026-09-27).**
1. "After the initial sync, if I delete signatures and sync again, it doesn't delete them in the neon
   user_signature table. The table still contains the previous signatures. Check why are those signatures
   still kept in the table when it syncs correctly in the app."
2. **PROCESS RULE (standing):** "For bug fixes, never bump like major update like 1.39.0 to 1.40.0, it
   should have been 1.39.1."
3. "Adding rectangle under annotation shows the delete icon outside of the view. See if it is widespread."
4. "Placing text/comments brings the comment popup with it. Comment dialog box should only appear if user
   selects the annotation later like rectangle."

**Features**

**A. A deleted signature must leave the cloud (item 1).**
- Deleting a signature locally and syncing must remove it from `public.user_signatures` - the row must not
  linger. The sync must keep working in both directions (a delete on one device must not be resurrected by a
  stale pull from another), so the fix must state HOW convergence is preserved now that rows are actually
  removed.

**B. Version numbering rule (item 2) - STANDING.**
- Bug fixes take a **PATCH** bump (1.39.0 -> 1.39.1); a MINOR bump is for new features/capabilities; a MAJOR
  bump only for a breaking change. This release's work is a set of fixes, so it ships as the next PATCH.

**C. No annotation control may render outside the view (item 3).**
- The operator saw a rectangle annotation's delete control positioned outside the visible area. Audit EVERY
  annotation type and control (rectangle, ellipse, arrow, highlight, ink, text box, comment/note, stamp,
  signature, image, and the box/text property bars): with the annotation at any page edge and at any zoom,
  every control must stay inside the visible canvas/viewport, clamped (the codebase already has a clamp
  pattern for panels - reuse it). Report the audit table and fix each offender.

**D. The comment box opens on SELECTION, not on creation (item 4).**
- Placing text or a comment must NOT immediately open the comment dialog: the annotation is created, and the
  comment box appears only when the user later SELECTS that annotation - the same behaviour a rectangle has.

**Success criteria**

1. Delete a signature locally -> sync -> the row is GONE from `public.user_signatures` (verified by querying
   the table before/after, and the app's own list agrees). A second device that syncs afterwards does NOT
   resurrect it.
2. The release carrying these fixes uses a PATCH version bump (state the version), and the rule is recorded
   in the standing standards.
3. An audit table lists every annotation type x control with its position at the page's four edges and at
   several zoom levels; every control stays inside the visible area (measured boxes, zero out-of-view
   offenders) - before/after per fixed offender.
4. Placing text/comment creates the annotation WITHOUT opening the comment box; selecting it afterwards opens
   the box (verified for both text and comment); a rectangle behaves as before; and the action bar (Confirm/
   Delete/Cancel) still appears on creation as it does for other annotations.
5. No regression: the earlier annotation behaviour, the standing animation/icon rules, `verify:full` and the
   phase suites stay green.

**Settings impact:** none - no new `AppSettings` field; the delete policy and the annotation behaviours are
code behaviour, not preferences.

## Phase 49 - Rebrand: the product is JOVREL (the project stays TFlex)

**Operator request (2026-09-27, verbatim intent):** "The Final product name for this pdf app is Jovrel. TFlex is
still our project name. Make necessary changes accordingly." The brand assets live in the operator's
`jovrel-brand` folder (a blue squircle with a white triple-stroke **J**, `#60A5FA -> #1E3A8A`; a wordmark in
two background variants; a PDF file-type icon; the app `.ico`). They have been placed as:
`assets/brand/` (SHIPPED: `jovrel.ico`, `jovrel-pdf.ico`, the mark PNGs + SVG, the PDF-file PNGs + SVG, both
wordmark PNGs) and `docs/brand/website/` (NOT shipped: `favicon.ico`, the preview sheet) - the repo's app
assets go under `assets/`, website artwork is documentation.

**THE SPLIT (both halves are contract):**
- **JOVREL is the PRODUCT**: everything a user SEES or a Windows surface reads.
- **TFlex stays the PROJECT**: the repository name, the npm package name `tflex`, the `tflex` config block and
  its keys, the `TFlexApi`/`tflex:` IPC identifiers, the source layout, the docs, the agent tooling - all
  unchanged. `tflex-releases` (the OTA releases repo) also stays: renaming it would break the updater and the
  published feed.

**Features**

**A. Packaging (backend-dev).**
- `productName: Jovrel`; the app icon and the installer/uninstaller icons from `assets/brand/jovrel.ico`; the
  `.pdf` association gets `jovrel-pdf.ico` as its per-extension icon, the ProgID becomes `Jovrel.pdf` and its
  description names Jovrel.
- Artifact names become `Jovrel-Setup-${version}-${arch}.${ext}` and `Jovrel-${version}-portable-${arch}.${ext}`
  (the release procedure, the OTA upload list and the e2e asset checks all follow).
- **`appId` STAYS `com.tflex.app`** (an internal identity): it keeps the NSIS upgrade GUID, so the installer
  properly replaces an existing TFlex install instead of creating a second one. Say so in the config comment.
- **The userData directory MUST be migrated**: with the product name changed, Electron's userData path moves
  from `%APPDATA%\tflex` to `%APPDATA%\Jovrel`; on first run, if the new directory has no
  settings, COPY the operator's existing per-user state across (settings.json, the signature store and its
  images, the encrypted session) - one-time, idempotent, never destructive (the old directory is left alone).
  Report exactly what you migrate and how it is gated.
- The PDF metadata the app writes (Producer/Creator) becomes Jovrel; the window title, the print window's
  title and the menus read Jovrel.

**B. In-app branding (frontend-dev).**
- The brand MARK and WORDMARK are implemented as INLINE React SVG components built from `assets/brand/jovrel-mark.svg`
  (exact geometry and the `#60A5FA -> #1E3A8A` gradient) - not as file references, so the packaged app cannot
  lose them. Where the dark/light wordmark variants differ, pick per theme (the mark itself is
  gradient-on-transparent and safe on both).
- Apply them: the title bar (replacing the current TFlex wordmark treatment), the Welcome/home screen, the
  About dialog, the account sheet header, and the print window. Any user-visible "TFlex" string in those
  surfaces becomes "Jovrel". Do NOT touch internal identifiers, IPC names, the config keys, or historical
  What's New entries.

**C. Pipeline + verification (qa + git-agent).**
- The release procedure, the four-asset upload list, the canonical installed spec's paths
  (`C:\Program Files\Jovrel\...`) and any e2e that asserts the product name or artifact names are updated.

**Success criteria**

1. The installed product is Jovrel: `C:\Program Files\Jovrel\Jovrel.exe`, an ARP entry named Jovrel, Start-menu
   and desktop shortcuts named Jovrel, and an Explorer `.pdf` association whose ProgID is `Jovrel.pdf` with the
   Jovrel PDF icon (report the measured paths and the registry values).
2. Upgrading an existing TFlex install replaces it in place (the same appId/GUID) rather than adding a second
   product - verified by the install gate.
3. The user's existing per-user state survives the rename: after first launch of the Jovrel build, the previous
   settings, signatures and session are present (report the migration evidence, including that the old
   directory was left intact).
4. The window title, the About dialog, the Welcome screen, the title-bar wordmark, the account sheet and the
   print window all show Jovrel with the brand mark; no user-visible "TFlex" remains in those surfaces
   (a grep-based assertion plus screenshots).
5. The mark renders correctly in all three themes (light/dark/frosted) and at the small sizes used in the
   title bar (state the sizes).
6. PDFs produced by the app carry Jovrel in their metadata (Producer/Creator), verified by reading the
   produced file's info dictionary.
7. The brand assets are committed in `assets/brand/` (shipped) with the website set in `docs/brand/website/`
   (not shipped, not referenced by the app).
8. No regression: the standing animation/icon rules and `verify:full` plus the phase suites stay green; the
   release ships as a MINOR bump (a product identity change, not a fix).

**Settings impact:** none - no new `AppSettings` field. The userData MIGRATION is a path-level one-time move of
existing files, not a settings-shape change.

## Phase 50 - Sign in from the BROWSER, and a "set as default PDF app" affordance

**Operator request (2026-09-28, verbatim intent):** "d of pop up login window, have the user login from
browser." i.e. instead of an in-app popup window, Google sign-in must open in the user's DEFAULT BROWSER and
complete there, returning the user to the app already signed in.

**Features**

**A. Browser-based sign-in (replaces the in-app popup).**
- Clicking **Continue with Google** opens the provider URL in the OPERATING SYSTEM'S DEFAULT BROWSER (not an
  in-app popup/child window). The user completes Google in their own browser, the browser lands on the app's
  loopback return address, and the app finishes the sign-in in the background (it already captures the
  verifier and completes the exchange) - so the user comes back to an app that is signed in.
- The in-app copy must say so: the sign-in surface tells the user the browser was opened and to finish there;
  the loopback page tells them they can close the browser tab and return to the app.
- The URL opened externally must be VALIDATED (only the configured auth host over https) - the app must never
  hand an arbitrary URL to the OS.
- The existing deny-by-default popup rule stays (it is a security net); the auth flow simply no longer needs
  the popup.

**B. Set as the default PDF app (the icon affordance).**
- The app gains a clear affordance (e.g. in Preferences or About) that opens Windows' Default-apps settings so
  the user can make Jovrel the default PDF handler - which is what makes Explorer show the Jovrel icon and
  type name. The app must state WHY (Windows does not let an installer do it silently), and must not claim it
  changed the default itself.

**Success criteria**

1. Continue with Google opens the provider in the default browser (verify the URL was handed to the OS, and
   that no in-app popup window is created), and the flow completes: the browser lands on the loopback, the app
   signs in and shows the account with the real name/avatar.
2. The URL handed to the OS is validated: an auth-host https URL is opened; any other URL (another host,
   http, malformed) is REFUSED and reported, with a test for each case.
3. The user-facing copy in the sign-in surface and on the loopback page names the browser (not "the window"),
   and the app is usable while the browser is open (no modal block).
4. A visible affordance opens Windows' Default-apps settings (verified: the OS call is made; the app does not
   claim to have changed the default) and explains that Jovrel must be chosen there for the PDF icon/type.
5. No regression: the sign-in error surfacing, the verifier handling (single-use, never logged), the leak-free
   diagnostics, the standing animation/icon rules, `verify:full` and the phase suites stay green.

**Settings impact:** none - no new `AppSettings` field; both changes are behaviour and an OS call.

## Phase 51 - Sign-in completion, automatic sync, and the annotation/OCR correction round (16 operator items)

**Operator report (verbatim intent, 2026-09-28):** the sixteen numbered items below. TWO of them (3 and 4) are
RE-REPORTS of things previously claimed fixed - they are treated as regressions until proven otherwise, and
the fixes must be verified from the operator's own viewpoint (their screenshots), not from our assertions.

**Features**

**A. Google sign-in completion (item 1).** The browser flow now fails at the session lookup:
`HTTP 400 Session challenge cookie not found ... cookies=__Secure-neon-auth.session_challange,
__Secure-neon-auth.session_challenge verifier=present`. The app must present the challenge the provider
requires: investigate the cookie attributes (name spelling, domain, PATH, sameSite, expiry) in the app's own
session against what the provider's route expects, and make the exchange succeed. If the provider's
cookie-based challenge makes the external-browser flow impossible, SAY SO with the evidence and recommend the
mechanism that does work (the in-app window completed in the app's own session, which is where the challenge
lives) - the operator decides between UX and a working sign-in.

**B. Automatic sync (item 2).** Syncing must happen automatically: on sign-in, after adding or deleting a
signature, and after any settings change - not only on demand. The manual control stays as a BACKUP (a sync
icon/button), and the live status makes clear when a sync is running/finished.

**C. The thumbnail / Undo overlap (item 3, re-report).** The first thumbnail's selection border still overlaps
behind the "Undo last change" bar. Fix it so nothing of the thumbnail (including its selection ring) intrudes
into the Undo row, at the panel's normal and narrow widths - and verify it in the running app the way the
operator saw it.

**D. The rectangle's delete control clipping (item 4, re-report).** In the context panel, a rectangle's delete
icon still renders outside/at the edge. Fix it, and AUDIT the same class across every context-panel row type
(annotation rows, stamp, signature, text, image) so no control can be clipped - with measured boxes.

**E. Bright tab colours (item 5).** The PDF tab colours read as a pale wash of the original colour. Make them
BRIGHT (the full-strength colour), while keeping the active/inactive distinction and the text contrast floors.

**F. Edit-text behaviour (items 6, 7, 12, 13, 14, 15, 16).** One coherent area with seven faults:
- selecting text in the canvas must ARM/FOCUS the Inspector's Text field (item 6) and the text must be
  editable in BOTH the canvas box and the Inspector field (item 12);
- the selection must LOOK selected (item 7);
- dragging must move the text (not just the blue box) and must not leave a ghost (items 7, 15: moving twice
  shows the text duplicated at the original position);
- Confirm must not create a duplicate text (item 7);
- applying a format (Bold/Italic) after moving must NOT move the box back to its original position (item 13);
- with no text box selected, no formatting control may look active (item 14);
- superscript/subscript must not show a second copy of the text behind the box (item 16).
The "Add a text box" tool already had several of these fixed - mirror that behaviour for the text-run editing
path.

**G. OCR (items 9, 10).** Cancelling an OCR scan must actually stop it; and the OCR suspects panel must be
moved OUT of the context panel INTO the Inspector with proper formatting (the operator's screenshot shows a
scattered, overlapping layout) - the context panel is reorganised accordingly.

**H. Text boxes' border style (item 11).** Every text box uses a thicker border with ROUNDED corners (not a
thin blue line). Applies to all text boxes (canvas boxes, text annotations, comments).

**I. Opening a PDF fails (item 8).** `C:\Users\tanzi\OneDrive\Desktop\Parent visa\956.pdf` fails to open. The
error dialog shows `([object Object])` - the error text is being stringified wrongly, which must be fixed in
the same pass so any future failure is readable. Root-cause the open failure on that file (a real-world PDF).

**Success criteria**

1. Google sign-in completes from the operator's own attempt (or, if the mechanism cannot work in the browser,
   the app uses the mechanism that does and the decision is recorded) - and the failure text, if any, names
   the exact step/status/cookies.
2. Syncs happen automatically on sign-in, on signature add/delete and on a settings change (verified by
   observing the network/sync status without touching the manual control), the manual control still works, and
   the status is truthful.
3. The first thumbnail's selection border does not overlap the Undo row at any panel width (measured boxes,
   zero intersection) - verified in the running app with a screenshot matching the operator's view.
4. No context-panel control is clipped or rendered outside its panel, for every row type (measured boxes).
5. Tab colours are the full-strength colour (measured, not a washed tint), adjacent tabs differ, and the text
   contrast floors hold in all three themes.
6. The edit-text cluster: selection arms the Inspector field; the canvas text is visibly selected; dragging
   moves the text; Confirm creates no duplicate; a format change after a move does not reposition the box; no
   formatting looks active with nothing selected; superscript/subscript shows no second copy - each verified
   with a focused test and, where visual, a screenshot.
7. OCR cancel stops the scan (verified by the engine state and the UI), and the suspects UI lives in the
   Inspector with a clean, non-overlapping layout (screenshot).
8. All text boxes render a thicker, rounded-corner border (measured computed style + screenshot).
9. The named PDF opens, or the failure is explained with a readable message (no `[object Object]`) and the
   root cause is recorded.
10. No regression: the standing animation/icon rules, `verify:full` and the phase suites stay green; fixes
    ship per the version rule (fixes = PATCH).

**Settings impact:** none - no new `AppSettings` field; the sync triggers, the annotation behaviour and the
panel reorganisation are code behaviour.

## Phase 52 - Encrypted PDF support (open with a password, and create encrypted PDFs)

**Operator request (2026-09-28):** "Implement encrypted pdf feature. First have scout agent research all the
industry standard implementation of it." The scout's research (recorded in `docs/FEATURE-BACKLOG.md` as
FEA-017) is the design input; its key findings:
- **`pdfjs-dist` 4.x ALREADY decrypts** for DISPLAY: `getDocument({ password })`, `onPassword(callback, reason)`
  with NEED_PASSWORD / INCORRECT_PASSWORD, and its core `crypto.js` implements R2-R6 (RC4-40/128, AES-128,
  AES-256 R5/R6). The failing real-world file (RC4-128, V4, empty user password) renders today.
- **`pdf-lib` cannot decrypt and must not be used to work around encryption** (`ignoreEncryption` is
  explicitly unsafe per its own README), so the EDIT path needs a decrypting loader.
- **`@cantoo/pdf-lib`** is a MIT-licensed, API-compatible fork (drop-in): it loads with `{ password }`
  (an EMPTY password is explicitly supported), handles indirect crypt filters, and can WRITE AES-256 R6
  (default), AES-128 and RC4 (behind an explicit weak-crypto flag) with permission flags.
- Alternatives rejected for the first cut: `muhammara` (native C++ addon, Electron 44 prebuilt unverified) and
  a bundled `qpdf` binary (an unsigned exe in the installer, plus an unmaintained wrapper).
- Industry norm (qpdf manual, Sejda): readers try the EMPTY user password first, so owner-restricted files
  open WITHOUT a prompt; permission flags are surface-level ("some PDF readers will ignore these
  permissions"), and RC4 stays readable for legacy files.

**ORCHESTRATOR RULINGS (chosen to match the industry norm; the operator may veto any):**
1. **Permission flags are DISPLAY-ONLY** - the app shows an honest "protected / limited permissions" banner
   listing what the document asks, and does not pretend to enforce it (the spec cannot enforce it; the
   research quote is explicit). No pretending, no silent ignoring.
2. **No explicit "Remove protection" action** in this phase: saving an opened encrypted document writes a
   DECRYPTED file, and the UI must SAY SO in the save confirmation.
3. **Creating uses AES-256 (R6) by default, AES-128 optional; RC4 is NOT offered for writing** (legacy RC4
   files remain OPENABLE). No weak crypto is produced.
4. **Adopt `@cantoo/pdf-lib`** as the edit-path dependency (MIT, drop-in, no binary). The fork risk is
   accepted and recorded.
5. **No password persistence**: a password lives in renderer memory for the session only - never in
   `settings.json`, never logged, never synced.

**Features**

**A. Open a password-protected PDF.** Opening an encrypted file prompts for the password when needed
(NEED_PASSWORD), retries on a wrong one (INCORRECT_PASSWORD) with a clear message, and cancels back to the
library. A file whose user password is EMPTY (owner-restricted) opens WITHOUT a prompt.

**B. A truthful protection state.** The UI shows what the document's encryption says (algorithm/revision and
the permission flags read from the file) as an honest banner - display-only.

**C. The entire edit path works on an encrypted document.** Every tool (rotate, delete, merge, annotate, edit
text, forms, optimize, export) operates on a document opened with a password, because the engine now loads it
with that password. Saving writes a DECRYPTED copy and the confirmation says so.

**D. Create an encrypted PDF.** A dialog to encrypt the current document: a user password, an optional owner
password, the algorithm (AES-256 default / AES-128), and permission checkboxes (print, high-res print, copy,
accessibility copy, modify, comment, assemble, fill forms); the produced file must open with the password in
another reader.

**Success criteria**

1. The operator's real-world file (RC4-128, V4, empty user password) opens with NO prompt and is fully
   editable (report the file's `/R`, `/V`, `/CFM` read from it).
2. A file with a real user password prompts once, opens with the right password, and retries with a clear
   message on a wrong one; cancelling leaves the app in its previous state (no half-open tab).
3. An AES-256 (R6) file prompts and opens; an AES-128 file opens (report the fixtures used - SYNTHETIC
   fixtures only, never the operator's documents).
4. The protection banner shows the real algorithm/revision and permission flags, and does not claim to
   enforce them.
5. Editing + saving an opened encrypted document produces a plain (decrypted) file, and the save confirmation
   says the protection was removed; the produced file opens everywhere without a password.
6. Creating an encrypted PDF with AES-256 (and with AES-128) yields a file that PROMPTS for the password in an
   independent reader (verify with a parser/pdf.js, not just our own app), and whose permission flags read back
   correctly.
7. Passwords never touch `settings.json`, the logs, the sync payloads or any trace; a wrong-password attempt
   does not leak the attempted password.
8. No regression: the unencrypted open/edit/save paths, the standing animation/icon rules, `verify:full` and
   the phase suites stay green; the dependency swap does not change behaviour for unencrypted files.

**Settings impact:** one new field - `encryptDefaults?: { algorithm: 'aes-256' | 'aes-128'; permissions: { print: boolean; highResPrint: boolean; copy: boolean; accessibleCopy: boolean; modify: boolean; comment: boolean; assemble: boolean; fillForms: boolean } }` (the Create-encrypted dialog's remembered defaults; validated in `src/main/services/settings.ts` - preserve-if-valid, reject-if-invalid, unknown keys dropped, a missing field resolving to AES-256 with all permissions allowed). **No password is ever a setting.**

---

## Phase 53 — Universal file handling I: DocumentConversionService foundation, text/markup/technical import

**Operator request (2026-09-29):** implement a robust file-handling architecture giving the app a
comprehensive import/export format matrix for office workers, developers, creative professionals,
legal and casual readers. This is too large for one phase; the orchestrator has tabled it as the
**five-phase program Phases 53–57**, in dependency order:

| Phase | Scope | Depends on |
| --- | --- | --- |
| 53 | `DocumentConversionService` foundation + `.txt` `.md` `.rtf` `.csv` `.html`/`.htm`/`.xhtml` import | — |
| 54 | Imaging and print graphics: `.png` `.jpg`/`.jpeg` `.tiff`/`.tif` `.svg`, PDF/A + PDF/X validation, image export | 53 |
| 55 | Office conversion engine, bidirectional: `.docx` `.doc` `.odt` `.xlsx` `.xls` `.ods` `.pptx` `.ppt` | 53 |
| 56 | Digital publishing and reading: `.epub` `.mobi`/`.azw` `.cbz`/`.cbt` | 53, 55 |
| 57 | `.pdf/E` layers + CAD metadata, `.fdf`/`.xfdf` form-data interchange, full matrix regression, packaging gate | 53–56 |

Each phase opens only when the previous one's success criteria are demonstrably met. Phases 54–57
are contract now so the shared shapes in Phase 53 are designed for them, not retrofitted.

**Architectural rulings (orchestrator; these bind every phase in the program):**

1. **One document model, no forked pipeline.** Every import produces PDF bytes and then enters the
   EXISTING engine open path. No second document model, no "incoming format" type that survives
   past the conversion boundary. Editing, annotation, forms, optimize, print and save keep working
   on an imported document with zero changes.
2. **`DocumentConversionService` + isolated adapters.** One service owns a registry of per-format
   adapters (`id`, `label`, `extensions`, `capabilities`, `sniff(path, head)`, `convert(ctx)`).
   Adding a format is adding an adapter, never editing the service. Each adapter is a separate
   module resolved by `await import()` at use time, so an unused format costs nothing at cold start
   (the 3-second budget is contract).
3. **Fidelity is declared, never implied.** Every conversion returns `fidelity: 'native' |
   'layout' | 'degraded'` plus `warnings[]`. The UI shows both. A degraded conversion says which
   capability was lost and why. Silent approximation is a defect.
4. **Graceful degradation is the default, not an exception.** A failed sub-format never throws
   across IPC: it returns a typed `ConvertError` (code + human message) and, where the bytes allow
   it, attempts a generic text/image extraction with a `generic-fallback` warning. Obscure formats
   are allowed to be unsupported; they are never allowed to crash or to no-op silently.
5. **The layout engine is Electron itself.** HTML/CSS and Markdown render through an offscreen
   hidden `BrowserWindow` + `webContents.printToPDF` — the only true CSS layout engine available
   offline, and no new dependency. That window runs with JavaScript disabled and every non-`file:`
   network request cancelled at the session, so it is also the sanitizer.
6. **Conversion never blocks the renderer.** All decode/convert work happens in the main process
   (and its offscreen window). The renderer only sends a path and receives progress, warnings and
   an engine `docId`.
7. **Streaming over buffering.** `CONVERT_LIMITS` names every ceiling (bytes per input, decoded
   frames, rows per sheet). Formats that allow streaming (text, CSV, TIFF frames, spreadsheet
   sheets, EPUB chapters, PDF pages) are read incrementally; a format that forces a full buffer
   must have its ceiling enforced with a typed `too-large` error, never an OOM.
8. **Pure JavaScript only.** No native addons and no prebuilt binaries in the installer: the
   packaging and portable-build guarantees stay intact.
9. **No DRM circumvention, ever.** Encrypted/protected e-books and DRM'd `.azw` are refused with a
   readable message. The app does not decrypt what it is not licensed to decrypt.

**Library selection (chosen before implementation, per the operator's instruction):**

| Category | Library | Why |
| --- | --- | --- |
| PDF read/edit (existing) | `pdfjs-dist`, `@cantoo/pdf-lib` | Already the v1 engine; Phase 52's decrypting loader is reused |
| HTML/CSS layout | Electron offscreen `printToPDF` | Real CSS layout, offline, already shipped, zero new bytes |
| Markdown | `marked` | Small, standard AST/HTML output |
| DOCX read | `mammoth` | Standard DOCX to semantic HTML |
| XLSX/XLS/ODS read+write | `xlsx` (SheetJS) | One library for all three spreadsheet formats, read and write |
| Containers (ODT/PPTX/EPUB/CBZ, DOCX fallback) | `fflate` | Tiny, fast, streaming-capable ZIP |
| RTF | hand-rolled parser | No maintained pure-JS RTF layout parser; the subset needed is small and testable |
| CSV | hand-rolled RFC 4180 parser | ~80 lines, fully unit-testable, RFC edge cases owned by us |
| TIFF | `utif` (with a second decoder if a fixture compression is unsupported) | Pure JS, multi-page, baseline/LZW/Deflate/PackBits/CCITT |
| SVG | hand-rolled SVG-to-pdf-lib vector translation, Chromium raster fallback | Native vector ops where possible; honest raster where not |
| Images | `pdf-lib` embed + `pngjs` | Already present; DPI-aware page sizing |
| DOCX write | `docx` | Pure JS DOCX generation |
| PPTX write | `pptxgenjs` | Pure JS PPTX generation |
| Text encodings | `iconv-lite` | UTF-8/UTF-16/CP1252/Latin-1 decoding for text, RTF and legacy formats |
| TAR (CBT) | hand-rolled 512-byte header reader | Small, no dependency, fully testable |
| MOBI/AZW | hand-rolled PalmDOC/LZ77 + KF8 record parser | No maintained library exists; text/images only, DRM refused |

**Features**

**A. The contract.** New `src/shared/convert.ts` holding every type in the program:
`ConvertFormatId`, `ConvertFidelity`, `ConvertWarning { code; message; detail? }`,
`ConvertSourceInfo`, `ConvertOptions`, `ConvertResult { bytes; pageCount; sourceFormat; fidelity;
warnings; title }`, `ConvertError { code; message }`, `ConvertProgress`, `CONVERT_LIMITS`,
`DEFAULT_CONVERT_OPTIONS`, and the shape identifiers for Phases 54–57 (image, office, publishing,
validation options) so those phases consume a stable surface. New IPC channel block plus a
`convert` member on `TFlexApi`: `convertSourceInfo(path)`, `convertToPdf(path, options)`,
`convertCancel(jobId)`, `convertFormMapping(...)` (Phase 53 CSV path), and a
`convert:progress` event.

**B. The service and registry.** `src/main/services/convert/` — `index.ts`
(`DocumentConversionService`), `registry.ts` (register/resolve/sniff, extension plus content
sniffing so a mislabelled file routes by content), `errors.ts` (codes and the Result mapping),
`limits.ts`, `adapters/text.ts`. Service API: `sourceInfo`, `convertToPdf`, `cancel`, and an
internal progress emitter. `src/main/index.ts` wires the channels; `src/preload/preload.ts` exposes
them; `src/main/open-path.ts` routes non-PDF extensions into the convert pipeline while `.pdf`
keeps its existing path byte-for-byte.

**C. Settings.** The `convertDefaults` field (below) is validated in
`src/main/services/settings.ts` BEFORE any adapter reads it, mirroring the Phase 6/52 pattern:
preserve-if-valid, reject-if-invalid, unknown keys dropped, missing field resolves to the
documented defaults.

**D. `.txt` import.** Encoding sniff (BOM, then UTF-8 validation, then CP1252/Latin-1 fallback),
line-wrapped into a PDF at the configured page size, margins, font family and point size, with a
page-number footer off by default. Streamed line by line so a 64 MB text file converts without
buffering the whole file twice.

**E. `.md` import.** `marked` to HTML, pre-styled template (H1–H6, bold, italic, links, ordered and
unordered lists, tables, blockquotes, code blocks, horizontal rules) with a bundled print
stylesheet, rendered through the offscreen print engine. Links are printed as text (no live
annotation in this phase) and that is stated in a warning.

**F. `.rtf` import.** Parser for the RTF subset: character formatting (bold, italic, underline,
strike), font size, foreground colour, paragraph alignment, indents and margins, `\par` and page
breaks, and the special-character escapes. Mapped to pdf-lib text runs at the configured page size.

**G. `.csv` import, two modes.** (1) Table mode: RFC 4180 parser (quoted fields, escaped quotes,
embedded newlines, delimiter sniffing, BOM) into a scale-to-fit paginated table PDF with a repeated
header row. (2) Form-data mode: when the open document has AcroForm fields, map CSV header keys to
field names and fill them, reporting matched and unmatched names — reusing the existing forms/FDF
services rather than a parallel writer.

**H. `.html`/`.htm`/`.xhtml` import.** The offscreen print engine: a pooled hidden window loading a
sanitized temporary copy of the document with JavaScript disabled and all non-`file:` requests
cancelled; multi-page print-ready PDF at the configured page size; each blocked subresource raises a
warning naming it. The temp file is always deleted, including on cancel, timeout and crash.

**I. Renderer surface.** Open dialog gains grouped filters ("Documents", "Text and markup",
"Spreadsheets", "All supported files") and the unsupported-extension case is handled by content
sniffing, not by the filter. An import runs with visible progress and a cancel affordance; the
result opens in a tab with a dismissible **conversion card** stating source format, fidelity label
and every warning. A failed import shows a readable message and leaves the previously open tab
exactly as it was.

**Success criteria**

1. From the real Open dialog, `.txt`, `.md`, `.rtf`, `.csv` and `.html` files each import into an
   open tab with the expected content; a screenshot of each result is captured and inspected.
2. The Markdown fixture's H1–H6, bold, italic, ordered/unordered lists, table and blockquote are
   all visibly distinct in the output PDF (text extraction unit test plus inspected screenshot).
3. The CSV fixture containing quoted fields, escaped quotes and embedded newlines parses to the
   correct cell grid (unit test); a 50,000-row CSV converts within the performance budget and
   reports its row-count warning.
4. CSV-to-form mapping fills the matching fields of the form fixture, reports unmatched headers by
   name, and the saved file's field values are verifiable with a parser (not by our own UI).
5. A corrupt fixture, an empty file, a zero-byte file with a supported extension, and an unknown
   extension each produce a readable typed error or a `generic-fallback` warning — no crash, no
   unhandled rejection, no silent no-op — and the app stays on its previous tab.
6. Every `ConvertError` code has a unit test and a human-readable message; `convertToPdf` never
   throws across IPC (`Result.err` only).
7. HTML import makes no network call: a fixture with `<img src="http(s)://...">`, a `<script>` and
   an `@import` produces warnings naming the blocked resources while the offscreen session records
   zero outbound requests (asserted in a unit test over the request log).
8. `convertSourceInfo` on a supported file reports the format, page count (where cheaply knowable)
   and fidelity BEFORE conversion; on an unsupported file it returns `unsupported-format`.
9. Registry resolution is content-aware: a `.txt` file whose bytes are Markdown routes to the
   Markdown adapter, verified by a unit test.
10. Import of a Markdown or HTML file whose output is very long (the 500-page equivalent) keeps the
    app interactive: the renderer responds to input throughout the conversion (measured, recorded).
11. Unit tests for the registry, sniffer, error layer, limits, `.txt`/`.md`/`.rtf`/`.csv` adapters
    and the offscreen print engine pass; the e2e suite opens all five formats from the real Open
    dialog; `npm run verify` is green; no regression in the existing PDF open/edit/save suites.
12. Cold start remains under the performance budget with the new adapters present (measured and
    recorded), proving the lazy-`import()` rule held.

**Settings impact:** one new field -
`convertDefaults?: { pageSize: 'a4' | 'letter'; marginMm: number; textFontFamily: string; textFontSizePt: number; csvDelimiter: 'auto' | ',' | ';' | '\t'; csvFormMapping: boolean; htmlPrintBackgrounds: boolean }`
(the import defaults surfaced in Preferences; validated in `src/main/services/settings.ts` -
preserve-if-valid, reject-if-invalid, unknown keys dropped; a missing field resolves to
`{ pageSize: 'a4', marginMm: 20, textFontFamily: 'Inter', textFontSizePt: 11, csvDelimiter: 'auto',
csvFormMapping: true, htmlPrintBackgrounds: true }`). `marginMm` must be finite and within 5–50,
`textFontSizePt` finite and within 6–48, and `textFontFamily` a member of the bundled font set;
anything else is rejected and the previous value kept.

## Phase 54 — Universal file handling II: imaging, print graphics, PDF/A and PDF/X validation

**Features**

**A. Raster images.** `.png`, `.jpg`/`.jpeg`: DPI-aware page sizing (an image carrying 300 DPI
metadata becomes a correctly sized page, not a 96-DPI guess), rotation, multi-image selection into
one document, and page order matching selection order.

**B. Multi-page TIFF.** `.tiff`/`.tif`: pure-JS decode, one PDF page per frame, decoded frame by
frame so a 200-frame legal/healthcare stack does not buffer the whole stack at once. A frame that
cannot be decoded becomes a placeholder page carrying the frame index and a warning; the remaining
frames still convert. Baseline, LZW, Deflate, PackBits and CCITT G3/G4 are all required to decode.

**C. SVG.** `.svg`: native vector translation of the static subset — `path` (via pdf-lib's SVG path
support), `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `g`, `transform`
(matrix/translate/scale/rotate), `viewBox` scaling, fill/stroke/opacity/stroke-width, and gradients
approximated as their dominant solid colour with a warning. Constructs outside the subset (filters,
masks, `foreignObject`, embedded images, animation beyond the first frame) are handed to the
offscreen print engine (Chromium) rather than translated natively, and the warning names exactly
which constructs were not translated natively. **Amended before implementation (orchestrator,
2026-09-29):** this originally promised a "300 DPI raster" fallback; Chromium's `printToPDF`
preserves vector content, so the engine-rendered fallback is a BETTER result than a raster and the
phase must not claim to have rasterised what it in fact kept as vector. The fidelity label is
`layout` for the engine-rendered path, `native` for the pure-vector path.

**D. PDF/A validation and preservation.** `.pdf/A` 1, 2 and 3 (a/b/u variants): read the XMP
`pdfaid` identification, the output intent, font embedding, encryption state, transparency and
JavaScript; report the declared level and every violation found. Export path enforcement: producing
a PDF/A-marked file when the document violates the level is refused with the violation list, and
the export of features forbidden by the level (encryption, transparency, non-embedded fonts,
JavaScript, external content) is blocked or flagged per the documented rule. The validation is
reported as "declared level plus violations", never as a certification claim.

**E. PDF/X validation and enforcement.** X-1a, X-3 and X-4: output intent and ICC presence, CMYK
only for X-1a, font embedding, transparency prohibition for X-1a; report and refuse to claim
conformance when the document does not meet it. CMYK conversion of untagged RGB is NOT performed
silently — it is refused with a readable reason or performed only on explicit user choice.

**F. Image export.** A page or page range to PNG or JPEG at a chosen DPI (72/150/300/600), using
the existing render path, so exported pixels match what the reader shows.

**Success criteria**

1. A 3-image selection of mixed PNG/JPEG produces a 3-page PDF whose page dimensions match each
   image's own DPI metadata (unit-test assertion on the produced media box), with a screenshot.
2. A 200-frame TIFF converts to a 200-page document with peak process memory recorded and inside
   the recorded ceiling; a TIFF with one deliberately corrupt frame yields that frame's placeholder
   page plus its warning while the other frames render.
3. The CCITT G4 fixture decodes and renders legibly (inspected screenshot).
4. A static SVG fixture (paths, curves, transforms, fills, strokes, opacity) renders crisp at 400%
   zoom with NO fallback warning; a fixture using a filter and a mask produces the engine-rendered
   fallback with a warning naming each construct that was not translated natively (and the report
   states which path each fixture took).
5. The PDF/A-1b fixture reports conformance and its violation-free status; a deliberately
   non-conforming fixture reports each violation with its rule name; asking to export it as PDF/A
   is refused with that list (not silently produced).
6. The PDF/X-1a fixture reports the output intent and passes its CMYK/embedding checks; an RGB-only
   fixture is reported non-conforming and is never silently converted or silently marked.
7. Image export at 300 DPI produces a PNG whose pixel dimensions match the page size in inches
   times 300 (unit-test assertion).
8. No regression: the Phase 53 suites, the existing print/export paths, `verify:full`, and the
   packaged build stay green.

**Settings impact:** two new fields -
`imageImportDefaults?: { pageSizeMode: 'image' | 'fixed'; fixedPageSize: 'a4' | 'letter'; fit: 'contain' | 'cover' | 'actual'; rotationDeg: 0 | 90 | 180 | 270 }`
and `pdfValidationDefaults?: { target: 'none' | 'pdfa-1b' | 'pdfa-2b' | 'pdfa-3b' | 'pdfx-1a' | 'pdfx-3' | 'pdfx-4'; onViolation: 'warn' | 'block' }`,
both validated in `src/main/services/settings.ts` with the preserve-if-valid, reject-if-invalid rule
and unknown keys dropped; a missing field resolves to
`{ pageSizeMode: 'image', fixedPageSize: 'a4', fit: 'contain', rotationDeg: 0 }` and
`{ target: 'none', onViolation: 'warn' }`.

## Phase 55 — Universal file handling III: bidirectional office conversion

**Features**

**A. Word and OpenDocument import.** `.docx` through `mammoth` to semantic HTML and then the
offscreen print engine: headings, paragraphs, character styles, tables, lists, images, inline
alignment. `.odt` through the ZIP container's `content.xml` mapped to the same HTML intermediate so
one styling path serves both. Legacy `.doc` (binary Word) has no faithful pure-JS layout reader:
it degrades to extracted text plus a `legacy-format-degraded` warning naming what was lost, and
never pretends to be a faithful conversion.

**B. Spreadsheet import.** `.xlsx`, `.xls`, `.ods` through `xlsx`: sheet-by-sheet pagination that
repeats the header row on every page, scale-to-fit column widths, page size and orientation chosen
to fit the used range, number/date formatting read from the cell formats, formula values read as
their cached results, and a sheet list where each sheet starts on a new page. Gridline and
fit-to-width options come from settings.

**C. Presentation import.** `.pptx`: read slide dimensions from the presentation XML so each slide
becomes a PDF page of exactly that aspect ratio; text boxes, images and basic shapes mapped with
their positions and sizes; slide notes appended as a following page when the option is on.
Transitions and animation are not rendered — a warning says so. Legacy `.ppt` degrades to text.

**D. Export back out.** PDF to `.txt` (text layer, reading order), `.docx`, `.xlsx` and `.pptx`.
**Amended during implementation (orchestrator, 2026-09-29):** `.txt` export and a TEXT-FIRST editable
`.docx` export already existed from Phase 9 (`engine.exportText` and `engine.createDocxFromDoc` /
DEF-060, with a per-page-image fallback for pages that carry no extractable text), so this phase REUSES
them rather than rebuilding them, and the `.docx` promise is corrected here: headings are **not**
detected by font size and tables are **not** reconstructed from layout in this phase, because the
engine's text extractor returns no per-line font metrics or weights — a styled, heading-aware DOCX
export needs a metric-aware extractor and is recorded as **FEA-024**, not silently promised. The
settings key `docxHeadingDetection` is therefore REMOVED from this phase's Settings impact rather than
shipped as a knob that changes nothing (a stored-but-ignored setting is a fail-loud violation).
`.xlsx` (detected tables and text runs, one sheet per page plus a full-text sheet) and `.pptx` (each
page rendered as a slide sized to the page box) are new in this phase. Every export carries a mandatory
fidelity warning in the UI and writes a `conversion-fidelity` note into the produced file's metadata
where the format allows. Two honest limits of the new writers, recorded because the fidelity notes must
state them: SheetJS's community build has no cell-anchored image API, so exported page images live as
base64 in a separate images sheet; and a presentation has a single slide size, so when pages differ the
first page box wins and the note says so.

**E. Round-trip verification, not round-trip promises.** Exports are verified by parsing the
produced file with the independent reader for that format and by re-importing it through our own
adapter, and the two must agree on the extracted text.

**Success criteria**

1. The DOCX fixture (headings, styled paragraphs, a table, a list, an image) converts to a PDF whose
   text extraction contains every heading and table cell, with the heading levels preserved as
   distinct sizes; screenshot inspected.
2. The ODT fixture with equivalent content produces an equivalent PDF (same extracted text set).
3. A legacy `.doc` fixture imports as text with the `legacy-format-degraded` warning, naming the
   lost capabilities, and the app does not crash.
4. The XLSX fixture (3 sheets, a formula, a date, a wide table) produces a PDF with one page group
   per sheet, the header row repeated on every page of that group, formula results as values, and
   the date rendered in the cell's own format.
5. A 20,000-row single-sheet XLSX converts within the recorded performance budget and reports no
   memory ceiling breach.
6. The PPTX fixture produces one PDF page per slide with the slide aspect ratio preserved
   (unit-test assertion on each page's media box) and the notes page when the option is on.
7. Each of the four exports produces a file that (a) opens in the independent parser for that
   format and (b) re-imports through our adapter yielding the same extracted text as the source
   PDF's text layer, with the fidelity warning present in the UI.
8. Export of an empty or image-only page still produces a valid file (never a zero-byte or
   corrupt one) and says which pages carried no extractable content.
9. No regression: Phase 53/54 suites, the existing export/print paths and `verify:full` stay green;
   the packaging budgets still hold.

**Settings impact:** one new field -
`officeConvertDefaults?: { spreadsheets: { gridlines: boolean; fitToWidth: boolean; orientation: 'auto' | 'portrait' | 'landscape' }; presentations: { includeNotes: boolean }; exports: { includeImages: boolean } }`
validated in `src/main/services/settings.ts` per the standing rule, unknown keys dropped; a missing
field resolves to
`{ spreadsheets: { gridlines: true, fitToWidth: true, orientation: 'auto' }, presentations: { includeNotes: false }, exports: { includeImages: true } }`.
(`docxHeadingDetection` was in this line when the phase was written and was REMOVED during
implementation — see feature D's amendment; the work is FEA-024.)

## Phase 56 — Universal file handling IV: digital publishing and reading modes

**Features**

**A. EPUB.** `.epub` (2 and 3): ZIP container, `container.xml` to the OPF, spine order honoured,
XHTML chapters sanitized and rendered through the offscreen print engine to a paginated PDF that
keeps chapter order, plus the extracted chapter XHTML returned over IPC so the renderer can offer a
genuine **Reading view**: reflowable paginated chapters with font size, line spacing, page width and
theme controls, independent of the PDF's fixed layout. Cover image becomes the first page.

**B. MOBI and AZW.** PalmDOC decompression and LZ77 record decoding for legacy Mobipocket, and KF8
container parsing for `.azw3`, extracting text, headings and images in spine order with a
`legacy-format-degraded` warning stating what is lost (no CSS fidelity, no positioned layout). DRM
evidence (an encrypted/`EBOK` protection record) produces a hard, readable `drm-protected` refusal:
the app never attempts to decrypt protected e-books.

**C. Comics and archives.** `.cbz` (ZIP) and `.cbt` (TAR): entries sorted by natural order (so
`p2` precedes `p10`), each image a PDF page, plus a **Comic viewport** reading mode: single or
double page, fit-width or fit-height, right-to-left toggle for manga, and keyboard/click page turn.
Non-image entries (metadata, `ComicInfo.xml`) are skipped without failing the conversion and are
reported in a warning.

**D. Reading-mode plumbing.** One shared reading-view shell used by EPUB and comic modes (page
navigation, progress, theme), so the app gains one reading surface rather than two.

**Success criteria**

1. The EPUB fixture (multi-chapter, images, a heading hierarchy) converts to a PDF whose extracted
   text follows the spine order and whose first page is the cover, with a screenshot.
2. The Reading view opens the same EPUB, paginates chapters, and honours a font-size change and a
   theme change, all evidenced by screenshots in two themes.
3. The unprotected MOBI fixture extracts text and images in order with the degraded warning visible;
   a DRM fixture is refused with the `drm-protected` message and never partially parsed.
4. The CBZ fixture with 12 images and the CBT fixture with the same 12 images each produce a
   12-page document; a fixture with `p1..p12` orders correctly (p10 after p9) under natural sort
   (unit test).
5. The comic viewport turns pages, switches single/double page, and produces screenshots in both
   single and double page modes in at least one theme.
6. A CBZ containing one corrupt image converts the remaining pages and warns about the damaged one.
7. A `.cbt` whose TAR records are truncated produces a typed error and no crash (unit test).
8. No regression: Phase 53/54/55 suites and `verify:full` stay green.

**Settings impact:** one new field -
`readingDefaults?: { epub: { fontSizePt: number; lineHeight: number; theme: 'light' | 'dark' | 'sepia' }; comics: { layout: 'single' | 'double'; fit: 'width' | 'height'; rightToLeft: boolean } }`
validated in `src/main/services/settings.ts` per the standing rule, unknown keys dropped; a missing
field resolves to `{ epub: { fontSizePt: 16, lineHeight: 1.5, theme: 'light' }, comics: { layout: 'single', fit: 'height', rightToLeft: false } }`.
`fontSizePt` must be within 10–32 and `lineHeight` within 1.0–2.5.

## Phase 57 — Universal file handling V: PDF/E, form-data interchange, matrix regression, packaging

**Features**

**A. `.pdf/E` engineering documents.** Import and render through the existing PDF.js path with the
document's optional content groups (layers) enumerated and surfaced in an **Engineering layers**
panel with visibility toggles, and the XMP CAD/engineering metadata (`pdfe` identification,
measurement and geospatial entries where present) shown in the document info surface. 3D
annotations, CAD-native structural data and 3D structural rendering are **explicitly out of scope**:
the app must detect 3D content, announce that it cannot render it, and still render the page's other
content — a blank page with no explanation is a defect. The reason is recorded in
`docs/FEATURE-BACKLOG.md`.

**B. `.fdf` / `.xfdf` form-data interchange.** Export the open document's form values to XFDF (XML)
and to FDF, and import XFDF/FDF into the fields of the open document, reusing and extending the
existing `src/main/services/fdf.ts` rather than writing a second FDF engine. The import reports
which field names matched, which did not exist in the document, and which fields received no data.

**C. Matrix regression.** One automated matrix suite that enumerates every extension the program
supports and, for each, asserts that `convertSourceInfo` + `convertToPdf` yield either a valid PDF
or a typed, readable error — never an unhandled rejection, never a crash, never a zero-byte result.
The same matrix runs against the packaged build.

**D. Packaging and budgets.** The installer and portable build ship every new dependency and remain
within the installer-size budget; the cold-start, 500-page-open and idle-memory budgets are
re-measured and recorded in `PERFORMANCE.md` alongside the new format-support matrix; the Open
dialog's advertised extensions match exactly what the registry actually supports (a guard test, so
the UI can never advertise a format the app cannot handle).

**Success criteria**

1. The engineering fixture's layers are listed with correct names and count and toggling one changes
   the rendered page (before/after screenshots).
2. A fixture containing a 3D annotation renders its page content and shows the announced limitation
   naming the page and the 3D object — verified by screenshot and by the visible message.
3. XFDF export of a filled form fixture then import into a blank copy of that form reproduces every
   value, verified by a parser; FDF export/import does the same.
4. Importing an XFDF entry whose field name does not exist in the document is reported in the
   unmatched list and does not create a stray field (asserted by re-parsing the document's field
   list).
5. The matrix suite covers every advertised extension with zero crashes and zero zero-byte outputs;
   the guard test proves the dialog's filter list equals the registry's supported list.
6. The packaged build passes the same matrix smoke walkthrough, and the recorded installer size,
   cold start, 500-page-open and idle-memory numbers are inside the budgets in this document.
7. Every capability the program claims in Phases 53–56 has either a passing test or a documented,
   readable degradation; every entry the program refuses has a written reason in
   `docs/FEATURE-BACKLOG.md`.
8. All DEF/ADV entries opened by Phases 53–57 are CLOSED or REJECTED with a written reason;
   `verify:full` is green on the final tree.

**G. Catalog round-trip completeness (added by the orchestrator 2026-09-29, from the DEF-378
investigation).** The Phase 54 fix made `serializeDoc` carry `/Metadata`, `/OutputIntents`,
`/MarkInfo`, `/Lang`, `/ViewerPreferences`, `/OCProperties`, `/Collection`, `/AF` and the
`/Names /JavaScript` subtree, and proved with a page-tree safety test that cloning `/Names`
wholesale would drag page-referencing named destinations into the destination context. What
remains dropped is silent data loss on every save, and this feature closes the safe part of it:
carry `/Dests` (named destinations) and `/OpenAction` (the initial view) across the rebuild by
REMAPING their page references through the page map `serializeDoc` already builds, so an internal
link or an initial-view setting survives a save. **`/StructTreeRoot` (tagged-PDF structure) stays
out of scope with a written reason:** its structure elements reference page objects and re-tagging
them correctly is its own program — recorded as FEA-023. Every entry that remains dropped must be
either carried or named in the serializer's block comment with the reason, and a test must assert
the carried ones survive and that a destination-free document still serializes byte-stably.

**Settings impact:** none.

## Phase 58 — Tab design and behaviour, customizable docks, and the home tool row (operator request 2026-09-30)

**Operator request (verbatim intent, 2026-09-30):** four numbered items, with one reference image
(a folder-style tab: rounded top corners, straight sides, a small outward curve at the bottom-right,
an orange-to-magenta fill, white bold label — "CSS left tab").

1. **Tab design.** The file tabs "don't look good at all" with the reflective colour, and the FIRST
   tab's size differs from the others. Implement the tabs like the reference image: coloured, with NO
   3D or reflection effect. In Settings, let the user toggle between **standard tabs** and **colourful
   CSS-styled tabs**.
2. **Tab behaviour.** Tabs must be movable left/right (reorder). Tab title text must be selectable so
   it can be copied. A tab dragged out of the bar and released must open in a NEW app window; the user
   must be able to drag it back into the previous window like a browser.
3. **Tool dock editing.** Add a small edit (pen) icon at the top-right of the dock. Clicking it starts
   a "vibration" animation, shows a minus badge on each existing dock icon and a plus icon at the right.
   The plus opens a picker of all tools relevant to that dock plus the global tools; picking one adds it
   to the dock and the plus returns to the right. Removing and adding must both work and the dock's size
   must adjust dynamically with animation.
4. **Home page editing.** The same edit affordance on the Home (Welcome) page's tool row: a pen button
   enters edit mode (vibration + minus per tile + a plus at the right); plus shows all tools usable from
   the home page (for example, annotate cannot work there); picking adds the tool to the right of the
   existing tiles and the plus returns to the right. Removing and adding must work and the row must
   resize with animation. **"Open file" cannot be removed from the home page.** A maximum of **14**
   tools may be added excluding "Open file". Tiles use the SAME icon and colour as the dock's icons but
   keep the SHAPE of the current home-page icon boxes.

**ORCHESTRATOR RULINGS (confirmed with the operator 2026-09-30; the operator may veto any later):**

1. **The "Home page" is the Welcome/start surface** (`src/renderer/components/Welcome.tsx`); its current
   "icon boxes" are the `.welcome-actions` buttons (Open PDF / Create from images / Merge PDFs). The
   editable row replaces that action row.
2. **Default tab style is `colorful`** when no preference is stored; the Settings toggle allows
   reverting to `standard`.
3. **The "colourful" tab is flat and gradient-only — no bevel, no inner highlight, no reflection.** Each
   tab keeps its Phase-45 per-tab palette identity (adjacent tabs differ), painted as a two-stop
   gradient of that tab's own palette colour in the reference's tab silhouette.
4. **Added dock tools are not capped in the UI** (the dock overflows/scrolls as today). Persistence is
   capped at a generous safety limit (`DOCK_PINS_CAP` raised; the number recorded in code) so a
   settings file can never grow without bound — the operator's "unlimited" is honoured in behaviour.
5. **Tear-out uses a real second app window's renderer**, reusing the print-window precedent (an
   independent top-level `BrowserWindow`). The tab's document moves (not a copy) and the origin tab is
   removed once the new window reports the document ready; a drag back performs the reverse. No
   document bytes are duplicated in settings or on disk by a tear-out.

**Features**

**A. Tab visual design: standard vs colourful, and one uniform tab size.**

- A new setting `tabStyle` (`'standard' | 'colorful'`, default `'colorful'`) with a labelled control in
  the Preferences sheet on the existing Settings surface, persisted through the settings IPC.
- `standard` renders the current tab appearance unchanged. `colorful` renders the reference tab
  silhouette: equal-height tabs (identical box height and minimum width for EVERY tab, first to last,
  active or not — the current first-tab size difference is a defect), rounded top corners, straight
  vertical sides, and the reference's small outward bottom-right curve; flat fill / two-stop gradient of
  the tab's own palette colour; NO inset shadow, emboss, gloss or reflection; active vs inactive still
  distinguished without relying on the bevel (the active tab keeps its raised surface + accent cue and
  its text-contrast floor).
- The visual change is renderer-only; the setting is read via the existing settings load path.

**B. Tab behaviour: reorder, copyable title, and browser-style tear-out / drag-back.**

- **Reorder:** a tab can be dragged left/right within the strip and dropped into a new order; the tab
  order state is the single source of truth and the active tab and its document are unaffected by a
  reorder. The reorder works by pointer drag with a visible drop indicator, and must not break the
  existing mousedown-activation and close contracts (DEF-034) or the cross-bubbling rules in AGENTS.md.
- **Selectable title:** the tab's title text must be selectable with the mouse so it can be copied
  (standard text-selection cursor and selection highlight); clicking the tab still activates it, so a
  selection gesture must not be mistaken for an activation or a drag.
- **Tear-out to a new window:** dragging a tab out of the tab bar and releasing outside it opens the
  tab's document in a NEW app window. The document MOVES: the origin tab is removed once the new window
  has loaded it, so the document is never open twice. If the document has unsaved changes, the tear-out
  is refused with a clear reason (the close-with-unsaved-edits gate is the precedent) OR the new window
  inherits the same unsaved state — one behaviour, chosen and documented; no silent data loss.
- **Drag back:** a tab in the detached window can be dragged back into the original app window and is
  re-adopted there (the reverse move), leaving the detached window and closing it if it is then empty.
  This is the browser round-trip; it must be demonstrated in both directions.
- New IPC (shared contract, approved by the orchestrator this phase): a `window:detachTab` request and
  a `window:adoptTab` / drag-handoff pair with typed payloads in `src/shared/ipc.ts`, mounted following
  the `print:openWindow` precedent.

**C. Dock editing: pen → vibration → minus/plus → add/remove with animated resize.**

- A small edit (pen) icon sits at the dock's top-right. Clicking it enters EDIT mode: the dock plays a
  short vibration animation and every existing verb shows a minus badge, with a single plus control at
  the right end of the row.
- Clicking a minus removes that tool from THIS dock (per stage) and persists the removal;
  clicking the plus opens a picker listing all tools relevant to the dock plus the global tools;
  picking one appends it (and the plus control returns to the right end), persisted.
- The dock's width/height adjust dynamically with the shared animation system (motion tokens; instant
  path under reduced motion / Animations OFF). Removing every verb leaves a coherent empty/edit state,
  never a broken row.
- Persistence reuses `dockPins` (added tools) and `dockUnpinned` (removed default tools) with the
  raised cap from ruling 4; the edit UI is the new front end for those two lists.

**D. Home tool row editing.**

- The Welcome page's action row gains the same pen edit affordance and the same vibration / minus / plus
  interaction as feature C.
- The plus picker lists only the tools that can actually run from the home surface (no document open —
  for example, annotations are excluded), plus the global tools that make sense with no document.
- "Open file" is the fixed first tile and CANNOT be removed (its minus control is absent/disabled).
- The user may add up to 14 tools (excluding Open file) in addition to the shipped defaults; adding
  beyond that is refused with a visible reason (fail-loud, not a silent no-op).
- Tiles use the dock registry's icon and colour identity, but keep the current home icon-box SHAPE.
- The list persists in a new `homeTools` setting field (ordered ids, excluding the fixed tile).
- The row resizes with animation as tiles are added/removed (shared motion system).

**Success criteria**

1. With no stored preference, tabs render `colorful`; the Preferences toggle switches to `standard` and
   back, the choice survives a restart, and `standard` reproduces the pre-phase tab appearance (before/
   after screenshots in all three themes).
2. Every tab — first, middle, last, active or inactive — has identical computed height and minimum
   width (measured boxes, zero variance); the first-tab size difference is gone (screenshot).
3. The `colorful` tab matches the reference silhouette (rounded top corners, straight sides, the
   bottom-right curve) and carries NO bevel/reflection: the computed style shows no inset box-shadow and
   no highlight band; the fill is the tab's palette colour. Adjacent tabs differ, and the text-contrast
   floor holds in all three themes (measured + screenshots).
4. A tab can be dragged left/right and the order changes; after a reorder the active document is
   unchanged and the previous tab order is restored by dragging back (asserted by DOM order + a run).
5. Tab title text is selectable: a drag-select over the label produces a visible text selection whose
   contents equal the title, and a plain click still activates the tab.
6. Dragging a tab out of the strip and releasing opens its document in a new app window and the origin
   tab is gone (document moved, not copied) — verified with a real second window and a count assertion.
7. Dragging that tab back into the original window re-adopts it and the detached window closes when
   empty — verified in the running app, round-trip both directions.
8. With unsaved changes, a tear-out follows the one documented behaviour (refusal with a readable
   reason, or an inherited dirty state) and never loses edits.
9. The dock pen icon enters edit mode with the vibration animation, minus badges on every verb and a
   plus at the right (screenshot); removing a verb and adding a tool both change the dock and persist
   across a restart (asserted by settings + dock contents).
10. The dock's size changes with animation when tools are added/removed, and is instant under reduced
    motion / Animations OFF (measured resize + screenshots).
11. The home row pen enters edit mode with the same interaction; the plus lists only home-usable tools
    (annotate excluded); adding a tool appends it right of the existing tiles and the plus returns to
    the right; "Open file" shows no active minus and cannot be removed; a 15th non-Open-file tool is
    refused with a visible reason (screenshot + assertion).
12. Home tiles use the dock icon/colour identity while keeping the current box shape, and the row
    resizes with animation — verified by computed style and screenshots.
13. No regression: the standing animation/icon rules, the cross-bubbling rules, `verify` and the
    phase suites stay green; the packaged installer and portable build still produce and launch.
14. All DEF/ADV entries opened by Phase 58 are CLOSED or REJECTED with a written reason.

**Settings impact:** TWO new `AppSettings` fields, both validated in
`src/main/services/settings.ts` before any renderer code reads them, mirroring the Phase-6 pattern
(preserve-if-valid, reject-if-invalid):

- **`tabStyle?: 'standard' | 'colorful'`** — default `'colorful'` (consumer default when absent).
  Validation: a present value must be a string in the allowlist, else the field is rejected (absent ->
  consumer default). Transported by the existing settings load/save IPC (`settings:load` /
  `settings:save`).
- **`homeTools?: string[]`** — the ordered home-row tool ids EXCLUDING the fixed "Open file" tile; a
  missing field means the shipped default row (Create from images, Merge PDFs). Validation mirrors
  `normalizeDockPins` (shape only: non-empty strings, dedupe first-wins, preserve order, truncate to
  `HOME_TOOLS_CAP = 14`; a non-array rejects the field). Unknown ids are dropped by the renderer, which
  owns the tools registry. Transported by the existing settings load/save IPC.

Dock add/remove reuses the existing `dockPins` / `dockUnpinned` fields; `DOCK_PINS_CAP` is raised per
ruling 4 (a constant change, not a new field). No password or document bytes are added to settings.

## Phase 59 — Operator correction round: tab behaviour, protection notice, dock animation, native form filling, outline, default zoom, palette gating, preferences redesign, panel buttons and tab overflow (10 operator items)

**Operator request (verbatim intent, 2026-09-30):** the ten numbered items below. Item 4 explicitly
authorises online research into how peer products fill forms natively.

1. **Tab text must NOT be selectable** and **a tab must drag from ANY area of the tab** (not just the
   colour chip). This SUPERSEDES Phase 58 feature B's "selectable title" and its DEF-413 behaviour: the
   selectable-title requirement is withdrawn, and the whole tab becomes the drag surface.
2. **Document-protected notice redesign.** The protection message at the top must appear as a rounded
   box with an entrance animation, stay ~10 seconds, then COLLAPSE into a small "i" (info) icon pinned
   at the top-left of the canvas. The user can expand and collapse it again at will, and the state
   persists for the document's session.
3. **Dock edit icon is outside the dock.** Move the pen control INSIDE the dock (resizing the dock if
   needed), and give ADDING and REMOVING a dock tool a visible animation. "Everything in this app should
   have animation."
4. **Native form filling (not a layer patch).** Opening `C:\Users\tanzi\OneDrive\Desktop\Parent
   visa\956.pdf` triggers a flow that draws field values as a layer and MISSES several fields. The app
   must instead fill the document's AcroForm fields NATIVELY (set the field values and regenerate the
   widget appearances, the way Adobe does), so every fillable field is set, the values are part of the
   form (not a painted overlay), and the result opens correctly with those values in an independent
   reader. Missing/unfillable fields must be reported, never silently skipped. Online research into the
   industry implementation is required (see the research requirement below).
5. **Outline panel bottom.** When the outline panel is expanded, its bottom must be FLUSH with the
   panel's bottom edge — the last outline row sits on the bottom line, with no leftover gap.
6. **Fit page by default.** Opening ANY PDF opens it at "Fit page" zoom, regardless of the previous
   document's zoom.
7. **Ctrl+K palette gating + pruning.** Tools that are usable on the current panel are GREYED OUT in the
   Command Palette (Ctrl+K) — e.g. "Page thumbnails" and "Bookmarks" are disabled while the Pages panel
   is showing. Every entry whose action is available must be ENABLED; every entry that cannot act in the
   current context is either enabled correctly or REMOVED from the palette. The palette must not offer a
   dead or wrongly-disabled row.
8. **Preferences redesign.** The Preferences window is disorganised (labels collide with the control
   column). Rebuild it as a professional layout with **vertical category tabs** (Adobe-style): labels
   and controls in their own aligned columns, one category per tab, no overlap, and the window resized
   as needed.
9. **Panel button identity.** Buttons and text look identical in the Context and Inspector panels.
   Give buttons a DISTINCT look from body text, and remove the trailing "..." from button labels.
10. **Tab overflow.** When the tabs no longer fit the tab bar, they resize with animation and partially
    STACK on top of one another (browser-style), rather than only scrolling.

**ORCHESTRATOR RULINGS:**

1. **Item 1 supersedes Phase 58.** Tab titles become `user-select: none` (not copyable) and the whole
   tab (except the close control) is the reorder/tear-out drag surface. The DEF-413 deferred-activation
   behaviour introduced for selectable titles is REMOVED with the feature.
2. **Item 4 is research-first.** A research step (online, into AcroForm filling in Adobe/PDF.js/pdf-lib
   and peers) plus an analysis of the operator's file must produce the chosen mechanism BEFORE code:
   the requirement is native field filling with regenerated widget appearances, not an overlay.
   The operator's real document is inspected for field types and count, but is NEVER modified in place
   and never committed; any fixture derived from it is synthetic or an anonymised copy.
3. **Item 6 is a behaviour default, not a setting.** Fit-page is applied on open; the user may still
   change the zoom afterwards. No new `AppSettings` field.
4. **Item 7's pruning is bounded to the palette's OWN rows**: an entry is removed only when no context
   can ever make it actionable; a context-dependent entry is kept and enabled/disabled correctly.
5. **Item 3's animation and item 10's resize/stack use the shared motion system** (motion tokens, the
   instant path under reduced motion / Animations OFF) — no hardcoded durations, no un-animated change.

**Features**

**A. Tabs: non-selectable titles, whole-tab drag (item 1).** The tab title renders with
`user-select: none`; the tab's title text cannot be selected or copied. A pointer drag starting anywhere
on the tab (title, chip, padding, gap) reorders it, and a downward drag tears it out to a new window as
in Phase 58 — the chip is no longer the only drag origin. Clicking still activates; the close button
still closes.

**B. Protection notice: animated rounded box that collapses to an "i" (item 2).** The document
protection banner renders as a rounded box with an entrance animation; after ~10 seconds it animates
closed into a compact "i" icon at the canvas's top-left. Clicking the "i" re-expands it; the expanded
state can be collapsed again by the user. The collapse timer resets on expand. The banner never covers
the page or a control, and the collapsed icon is always reachable.

**C. Dock edit control inside the dock + add/remove animation (item 3).** The pen control lives INSIDE
the dock chrome (the dock grows/shrinks to keep it inside its own bounds, never overlapping the canvas
edge). Adding a tool animates the new verb into the row (and the dock resizes); removing animates the
verb out before the row settles. Both ride the shared motion system.

**D. Native AcroForm filling (item 4).** Filling a form sets the AcroForm FIELD VALUES and regenerates
each widget's appearance so the value is carried by the field (not painted on the page). The flow
reports how many fields were filled, and names any field it could not fill and why. A saved result opens
in an independent reader with the values visible in the fields. The operator's `956.pdf` fills its
fillable fields completely (no missed fields). Flattening remains an explicit separate action.

**E. Outline panel flush bottom (item 5).** When expanded, the outline list's last row sits flush with
the panel's bottom edge (measured: zero gap), at the panel's normal widths.

**F. Fit-page on open (item 6).** Every document opens at Fit page, independent of the previous
document's zoom; the user's subsequent zoom change is honoured until the next open.

**G. Command Palette correctness (item 7).** With the Pages panel showing, "Page thumbnails" and
"Bookmarks" (and every other entry whose action IS available) are ENABLED and execute; an entry that
genuinely cannot act in any context is removed from the palette. The palette contains no
wrongly-disabled row and no dead row.

**H. Preferences redesign (item 8).** The Preferences sheet is rebuilt with vertical category tabs
(e.g. General / Appearance / Editing / Conversion / Accounts, exact set chosen during the work), one
category visible at a time; labels and controls occupy their own aligned columns with no overlap at the
window's normal and minimum sizes; the sheet is resized to fit the content. Every existing preference
is preserved (nothing lost in the rebuild) and every control still persists.

**I. Panel button identity (item 9).** In the Context and Inspector panels, interactive buttons are
visually distinct from body text (button surface/border/tone), and no button label ends with "..." —
labels are the bare action name.

**J. Tab overflow: animated resize and partial stacking (item 10).** When the open tabs exceed the bar's
width, the tabs shrink (with animation) down to a floor and partially STACK on top of each other, so the
strip stays one row and the active tab remains identifiable and clickable. No scrolling-only behaviour
and no clipping of the active tab.

**Research requirement (item 4).** Before implementation, an online research pass must document how
Adobe and the open-source ecosystem fill AcroForm fields natively (field value `/V`, widget appearance
`/AP` regeneration, `NeedAppearances`, the pdf-lib / `@cantoo/pdf-lib` capabilities and their limits,
and the JS-free path), and must analyse the operator's `956.pdf` (field count and types, why fields are
missed today). The findings and the chosen mechanism are recorded before the code is dispatched.

**Success criteria**

1. Tab titles are NOT selectable (a drag-select over a title produces no text selection) and a drag from
   the tab's title, chip or padding both reorders and tears out (screenshots + DOM assertions).
2. The protection notice animates in as a rounded box, collapses to the "i" icon after ~10s (measured),
   re-expands on click and collapses again on demand, and the collapsed icon never overlaps the page.
3. The dock's pen control is INSIDE the dock's bounds (measured boxes) at the normal and narrow widths,
   and adding/removing a dock tool animates (a transition/layout animation is observed; instant under
   Animations OFF).
4. The operator's `956.pdf`: every fillable field is filled, the values are read back from the FIELD
   VALUES by a parser, the saved file shows them in an independent reader, and the report names any
   field not filled (with the reason). No layer overlay is used.
5. The outline's last row is flush with the panel bottom when expanded (measured gap 0).
6. Opening any PDF starts at Fit page (measured zoom mode), including a second document after zooming
   the first.
7. With Pages showing, "Page thumbnails" and "Bookmarks" are enabled and their actions run; the palette
   has no wrongly-disabled row (a sweep) and no dead row.
8. Preferences: vertical categories switch correctly; no label overlaps a control at the normal and
   minimum sheet sizes (measured boxes); every previously existing preference is still present and
   persists across a restart (a checklist of the pre-rebuild set).
9. Context/Inspector buttons are visually distinct from body text (computed style differs) and no button
   label contains "...".
10. With many tabs open, tabs shrink with animation and partially overlap while the active tab stays
    fully visible and clickable (measured boxes + screenshots).
11. No regression: the standing animation/icon/cross-bubbling rules, `verify` and the phase suites stay
    green; the installer and portable still produce and launch.
12. All DEF/ADV entries opened by Phase 59 are CLOSED or REJECTED with a written reason.

**Settings impact:** none — no new `AppSettings` field. Item 6 (Fit page on open) is a behaviour default
per ruling 3; items 1, 2, 3, 5, 7, 8, 9 and 10 are UI/behaviour changes; item 4 changes the form-fill
engine path only.

## Phase 60 — Live tab drag: the tab follows the pointer and the strip reflows with animation (operator request via TFL-43, 2026-10-01)

**Operator request (verbatim intent, 2026-10-01):** "When dragging a file tab, the tab doesn't move
live with the mouse, instead a line moves. Make sure, the tab moves live with the mouse and other tabs
move to make space for the moved tab with animation."

**Current-scope supersession:** Phase 58 feature B specified the reorder affordance as "a visible drop
indicator" (the 2px `.tab-drop-marker` line) with the strip otherwise static. This phase supersedes that
PRESENTATION only: the dragged tab itself tracks the pointer, and the neighbouring tabs animate to open a
gap at the computed insertion slot. The reorder semantics, the tear-out / drag-back behaviour, the
non-selectable title (Phase 59 item 1), the active-document preservation (DEF-411) and the overflow
shrink/stack plan (Phase 59 item 10) are all unchanged.

**Features**

**A. The dragged tab follows the pointer live.**
- From the moment the drag arms (the existing 6px total-movement threshold), the dragged tab is visually
  detached from its slot in the row and tracks the pointer's X, instead of only rendering the static
  `.tab-drop-marker` line.
- The dragged tab renders ABOVE the other tabs (raised z-order plus a lifted shadow/scale per the shared
  motion system) and keeps its own colour identity and width while dragging.
- The live follow uses `transform` only (no layout thrash); the tab settles into the committed slot on
  release.

**B. The neighbouring tabs animate to make space.**
- While the drag is live, the other tabs shift to open a gap the width of the dragged tab at the computed
  insertion slot; the gap moves as the pointer crosses slot midpoints.
- The reflow is animated with the shared motion system (tokens from `src/renderer/hooks/motionTokens.ts` /
  `src/renderer/styles/animations.css`; transform or margin only), so it moves smoothly rather than
  snapping; it is instant under `prefers-reduced-motion` and Animations OFF.
- The `.tab-drop-marker` line is retired as the primary affordance: with the tab itself following the
  pointer and the gap opening in the row, no standalone insertion line is shown.

**C. Behaviour preserved.**
- Release commits the order at the slot the gap was showing (existing `onMoveTab`); the active document
  and its displayed page are unchanged; dragging back restores the order.
- A downward release past the tear-out threshold still detaches to a new window; the drag-back / adopt
  round trip is unchanged.
- DEF-034 (activation on mousedown, close button closes) and the AGENTS.md cross-bubbling rules are
  untouched.
- The Phase 59 item 10 overflow plan still applies: a squeezed/stacked strip must reflow live without
  clipping the active tab.

**Success criteria**

1. During a horizontal drag, the dragged tab's own rendered box tracks the pointer: its bounding-box left
   changes with the pointer X across several sampled pointer positions, and a standalone drop line is no
   longer the only motion feedback (measured + a mid-drag screenshot).
2. While dragging, the other tabs open a gap at the computed slot and the gap moves when the pointer
   crosses a midpoint; the change is animated (a computed transition/animation on the reflow is observed;
   instant under reduced motion / Animations OFF) (measured + screenshots).
3. On release the committed DOM order equals the slot the gap was showing; the active tab id and the
   displayed document are unchanged, and dragging back restores the original order (asserted by DOM order
   plus a run).
4. A downward release past the tear-out threshold still detaches, and the drag-back round trip still
   re-adopts (Phase 58 criteria 6-8 do not regress).
5. A plain click activates the tab and the close button closes it (DEF-034 intact); no cross-bubbling
   regression.
6. With many tabs (squeezed/stacked strip), the live follow and animated reflow still work and the active
   tab is never clipped (measured + screenshot).
7. With a SINGLE tab, the drag still arms (DEF-412) and detaches as before; a non-tear-out release is a
   harmless no-op.
8. No regression: `verify`, the Phase 58/59 tab suites and the standing animation / cross-bubbling rules
   stay green.
9. All DEF/ADV entries opened by this phase are CLOSED or REJECTED with a written reason.

**Settings impact:** none — no new `AppSettings` field. This is a renderer-only interaction/animation
change; no IPC or shared-contract change.

## Phase 61 — Tab tear-out drag: the tab tracks the pointer outside the bar and goes translucent (operator request via TFL-44, 2026-10-01)

**Operator request (verbatim intent, 2026-10-01):** "When file tab is moved outside of the bar, the tab
should move live with the mouse and the tab should be transparent at this time. Releasing the mouse
button will open another window as it is now. The user should be able to restore the tab back by dragging
and dropping to original app window."

**Current-scope supersession:** Phase 60 made the dragged tab follow the pointer for the in-strip REORDER.
This phase extends the SAME direct-manipulation presentation to the TEAR-OUT phase: once the pointer
leaves the strip, the dragged tab itself leaves the row, tracks the pointer on both axes, and renders
translucent. It supersedes only the tear-out PRESENTATION (today a dashed `outline` on `.tab-list`, driven
by `data-tab-tearout`). The detach semantics (release past the threshold opens a new window), the
drag-back / adopt round trip, DEF-411 active-document preservation, DEF-034 activation/close, the
Phase-59 item 10 overflow plan and the AGENTS.md cross-bubbling rules are unchanged.

**Features**

**A. The dragged tab follows the pointer outside the bar.**
- Once the drag arms, the dragged tab tracks the pointer on BOTH axes (X and Y) as a floating element, so
  when the pointer leaves the tab strip the tab visibly leaves the bar with it - not just a strip
  highlight.
- While the pointer is past the tear-out threshold (below the strip's bottom edge), the tab renders in a
  "tear-out" visual state: it tracks the pointer freely, is drawn above all other UI (raised z-order) and
  is not clipped by the strip.
- The live follow uses `transform` only (no layout thrash); the strip keeps its Phase-60 reorder reflow
  for the in-strip case.

**B. The tab is translucent while it is outside the bar.**
- While the drag is in the tear-out state, the dragged tab renders semi-transparent (a measured
  `opacity` below 1), so the surface behind it is visible; it returns to full opacity on release or when
  the drag returns inside the strip.
- The translucency rides the shared motion system (token-driven) and is instant under
  `prefers-reduced-motion`.
- Only the dragged tab is translucent; the other tabs are unaffected.

**C. Release still detaches; drag-back still restores.**
- Releasing the pointer outside the strip (past the existing tear-out threshold) still opens the
  document in a new app window and removes the origin tab once adopted (Phase 58 feature B, unchanged).
- A tab in the detached window can still be dragged out of its bar and is re-adopted by the origin
  window, the detached window closing when empty (Phase 58 criterion 7, re-verified this phase).
- No document bytes are duplicated; the move semantics are unchanged.

**Success criteria**

1. During a drag whose pointer leaves the strip, the dragged tab's own rendered box follows the pointer
   on BOTH axes: its bounding-box left AND top change with sampled pointer X/Y (measured + a mid-drag
   screenshot taken with the pointer outside the bar).
2. While the pointer is outside the strip, the dragged tab is translucent: its computed opacity is
   measurably below 1 and below the non-dragged tabs' opacity, and it returns to 1 after release
   (measured).
3. The dragged tab is not clipped by the strip and renders above the other tabs while outside the bar
   (z-order / overflow measured + screenshot).
4. Releasing past the tear-out threshold still opens the new app window and MOVES the document (origin
   tab gone after adopt; a real second `#detached` window with the document loaded) - Phase 58 criterion
   6 unchanged.
5. The round trip still works: dragging the detached window's tab out of its bar re-adopts it into the
   origin window and closes the detached window when empty (Phase 58 criterion 7 unchanged; run in both
   directions).
6. The in-strip reorder behaviour of Phase 60 is unchanged: a horizontal drag inside the strip reorders
   with the tab following and the strip reflowing, and a non-tear-out release never detaches (Phase 60
   criteria 1-3 still hold).
7. A plain click still activates the tab and the close button still closes it (DEF-034); no
   cross-bubbling regression.
8. With unsaved changes, the tear-out still follows the documented behaviour (refusal with a readable
   reason OR an inherited dirty state) and never loses edits (Phase 58 criterion 8 unchanged).
9. No regression: `verify`, the Phase 58/59/60 tab suites and the standing animation / cross-bubbling
   rules stay green.
10. All DEF/ADV entries opened by this phase are CLOSED or REJECTED with a written reason.

**Settings impact:** none - no new `AppSettings` field. This is a renderer-only interaction/animation
change; no IPC or shared-contract change.

## Phase 62 — Colorful tab restyle: compact height, four rounded corners, and the selected tab merged into the canvas (operator request via TFL-45, 2026-10-01)

**Operator request (verbatim, 2026-10-01):** "The file tab doesn't look good. Make them smaller in height
with rounded corners on all 4 corners. The selected tab should engulf the canvas."

**ORCHESTRATOR RULINGS (the operator may veto or adjust any of these):**

1. **Scope = the default `colorful` tab style.** `tabStyle` defaults to `'colorful'`, which is the tab the
   operator sees and is reacting to. The `standard` style is left unchanged, so Phase 58 criterion 1
   ("standard reproduces the pre-phase tab appearance") stays true. Applying the same restyle to
   `standard` would be a follow-up if the operator asks.
2. **Compact height = 26px.** The colorful tab box drops from 34px to 26px. The label, colour chip and
   close control stay vertically centred.
3. **All four corners rounded** on the colorful tab's body fill, with the SAME radius on every corner
   (one existing radius token, used for all four). The Phase 58 / DEF-409 outward bottom-right flare is
   retired.
4. **"The selected tab should engulf the canvas"** - the active colorful tab is attached to the document
   canvas: its foot sits flush against the canvas top with no visible separator (the header's 1px bottom
   border does not paint beneath it, and the active tab's ink underline does not draw a separating band),
   its two BOTTOM corners are square while its two top corners stay rounded, and its fill is continuous
   with the document surface so the tab and the canvas read as ONE surface (the canvas appears to rise
   into the selected tab). The inactive tabs keep all four corners rounded and stay visually separate from
   the canvas. The active tab remains distinguishable from the inactive ones (bolder label and/or its
   brighter fill treatment, as today).

**Current-scope supersession:** this phase supersedes only the Phase 58 COLORFUL tab silhouette - the
DEF-409 square bottom plus outward `.tab-flare`, and the "rounded top / square bottom" body. The `standard`
style, the per-tab palette identity (Phase 45 / 51), the active-tab distinguishability requirement, every
tab BEHAVIOUR (reorder, tear-out / drag-back, DEF-034 activation / close, DEF-411 / DEF-412, the Phase 59
item 10 overflow plan), the standing animation / cross-bubbling rules and the `tabStyle` preference are all
unchanged. The e2e silhouette oracle `e2e/phase58_tab_style.spec.cjs` (the square-foot / flare assertions)
is repointed by qa to the Phase 62 silhouette.

**Features**

**A. Compact, four-corner-rounded colorful tab.**
- The colorful tab box is 26px high.
- Every colorful tab's body fill carries one uniform, non-zero corner radius on all four corners.
- No outward bottom-right flare is painted.

**B. The selected tab is merged into the canvas.**
- The active colorful tab's foot is flush with the canvas top; no separator (header border / active
  underline) is visible between the active tab and the canvas.
- The active tab's bottom corners are square (top corners rounded); the inactive tabs keep all four corners
  rounded.

**C. Supersession of the Phase 58 colorful silhouette and its oracle.**
- The `standard` style is untouched.
- `e2e/phase58_tab_style.spec.cjs` is repointed by qa to assert the Phase 62 silhouette (one uniform corner
  radius on the fill, the 26px height, no `.tab-flare` paint, and the active tab flush with the canvas).

**Success criteria**

1. Every colorful tab measures 26px high (measured boxes, zero variance across tabs) and the four
   `border-*-radius` computed values on its fill are non-zero and equal (measured + a zoomed screenshot).
2. No colorful tab paints the DEF-409 outward flare: no `.tab-flare` radial-gradient fill is computed and no
   flare box extends past the tab's right edge (measured).
3. The active colorful tab is flush with the canvas: the gap between the active tab's bottom and the canvas
   top is <= 1px, no separator line is painted between them, and the active tab's bottom corners are square
   while an inactive tab's are rounded (measured + a zoomed screenshot in light and dark).
4. The tab strip stays aligned to the header bottom after the height change; the rest of the app chrome does
   not shift or clip (before / after screenshot).
5. `standard` still reproduces the pre-phase tab appearance (Phase 58 criterion 1 unchanged) - screenshot.
6. No behaviour regression: mousedown activation and close (DEF-034), reorder (Phase 58), tear-out /
   drag-back (Phase 58), the Phase 59 item 10 overflow shrink / stack, and the Phase 58 / 59 / 60 tab suites
   stay green after the oracle repoint.
7. `npm run verify` and the targeted unit test for this phase pass.
8. All DEF / ADV entries opened by this phase are CLOSED or REJECTED with a written reason.

**CONTROL-INDEX:** none - this phase introduces no new control; it restyles existing tab surfaces (nothing is
added, removed or re-bound).

**Settings impact:** none - no new `AppSettings` field. This is a renderer-only styling change; no IPC or
shared-contract change.

## Phase 63 — Dock edit icon identity: the dock's edit pen carries the EDIT stage colour (operator request via TFL-47, 2026-10-01)

**Operator request (verbatim intent, 2026-10-01):** "The edit icon on the dock should have its distinct
color."

**ORCHESTRATOR RULING (the operator may veto or adjust):** "the dock" is the bottom Action Dock
(`[data-action-dock]`, `src/renderer/components/ActionDock.tsx`); "the edit icon" on it is the dock's own
edit-mode pen toggle `[data-dock-edit-toggle]` (`.action-dock-edit`, the `Pencil` at
`ActionDock.tsx:1158-1170`). Its distinct colour is the EDIT stage hue `--tf-stage-edit` (which resolves to
`--sem-primary` in every theme) - the SAME token the Stage Rail's edit-stage icon
(`.stage-rail-btn[data-stage="edit"] .stage-rail-icon`) and the command palette's edit-stage rows
(`.command-palette-row[data-stage='edit']`) already carry. Today the pen rests at `--fg-muted`, so it reads
as every other neutral control; it must instead read as the edit-stage identity.

**Features**

**A. The dock's edit pen carries the EDIT stage hue at rest.**
- In `src/renderer/styles.css`, the `.action-dock-edit` base rule's resting `color` changes from
  `var(--fg-muted)` to `var(--tf-stage-edit)`; the glyph and no other property change.
- The hover ink (`--fg-strong`) and the armed/pressed ink (`--accent`) keep their existing rules, so the
  control's state affordances are unchanged.
- No new token, palette, component or IPC is introduced: this is one declaration using the app's existing
  four-stage identity palette (the "one palette, not two" standard).

**Success criteria**

1. The resting computed `color` of `[data-dock-edit-toggle]` resolves to `--tf-stage-edit` (=
   `--sem-primary`) in all three themes (light / dark / frosted), and is distinct from the dock's neutral
   verb ink (`--sem-neutral`) - asserted by the new unit guard and a rendered computed-style probe.
2. The `--tf-stage-edit` ink clears the 4.5:1 label floor on the pen's `--bg-elevated` surface in all three
   themes (the Phase 40 semantic-palette floor already holds for `--sem-primary` on `--bg-elevated`).
3. No dock behaviour changes: the pen still toggles EDIT mode (vibration, minus badges, plus picker) and
   Escape still exits; `phase58DockEdit.test.tsx` stays green, including its Phase 59 "pen is contained"
   rules (display / flex / no offsets unchanged).
4. `npm run verify` and the new targeted unit guard pass.

**CONTROL-INDEX:** none - this phase introduces no control and re-binds nothing; it recolours the existing
dock edit pen (`.action-dock-edit`).

**Settings impact:** none - no new `AppSettings` field. This is a renderer-only styling change; no IPC or
shared-contract change.

## Phase 64 — Square Outline panel corner: remove the rounded bottom-right corner (operator request via TFL-50, 2026-10-01)

**Operator request (verbatim intent, 2026-10-01):** "The Outline panel has rounded corner on the bottom
right. Remove the rounded corner."

**ORCHESTRATOR RULING (the operator may veto or adjust):** "the Outline panel" is the left Pages panel
root `.context-panel` (`src/renderer/components/ContextPanel.tsx:684`) which hosts the Outline section
(`ContextPanel.tsx:397` / `:417`). The panel root carried `border-radius: 0 0 var(--panel-radius) 0;`,
rounding only its bottom-right corner while its other three corners are square. The correction removes
that declaration so the bottom-right corner is square like the rest of the panel.

**Features**

**A. The `.context-panel` root declares no border-radius.**
- In `src/renderer/styles.css`, the `border-radius: 0 0 var(--panel-radius) 0;` declaration is removed
  from the `.context-panel` rule; every other declaration in that rule is unchanged.
- No new token, palette, component or IPC is introduced: this is one declaration removed from an
  existing rule.

**Success criteria**

1. The `.context-panel` rule body contains no `border-radius` declaration - asserted by the static-CSS
   guard `test/unit/renderer/tfl50_contextPanelSquareCorner.test.ts` (mirrors the `def294` flush
   header-corner guard).
2. The rendered computed `border-bottom-right-radius` of the context panel resolves to `0px` - asserted
   by the rendered oracle `e2e/tfl50_outline_corner.spec.cjs` with a before/after screenshot.
3. No blast radius: the neighbouring `def294_flushThumbHeaderCorner.test.ts` stays green and `npm run
   verify` (conventions + typecheck) passes.

**CONTROL-INDEX:** none - this phase introduces no control and re-binds nothing; it removes a single CSS
declaration from the existing `.context-panel` rule.

**Settings impact:** none - no new `AppSettings` field. This is a renderer-only styling change; no IPC or
shared-contract change.

## Phase 65 — Adobe-grade form field rendering: one complete, faithful field layer (operator request via TFL-49, 2026-09-30)

**Operator request (verbatim):** "There are issues when opening files like
`C:\Users\tanzi\OneDrive\Desktop\Parent visa\956.pdf`. The app tries to place fields as layer on the
form. It misses several fields in the process. The overlapping layers can be seen. Make sure to implement
cleanly like adobe. Make engine level changes if necessary. It looks very unpolished."

**Relationship to Phase 59 item 4.** Phase 59 item 4 fixed the *fill mechanism* (values written to the
AcroForm `/V` and widget appearances regenerated, not painted). Phase 65 fixes the *rendering* of the
interactive field layer itself: today pdf.js paints the document's own widget appearances onto the page
canvas AND `FormsOverlay` paints a second set of HTML editors over them, so a field appears twice and the
two layers visibly disagree ("overlapping layers"); fields whose editor is transparent or mis-placed read
as "missed". This phase makes the on-screen field layer single, complete and faithful, the way Adobe
renders a form.

**ORCHESTRATOR RULINGS:**

1. **Research-first.** Before any code is dispatched, a research/characterisation pass must (a) document
   how Adobe and the open-source ecosystem render AcroForm widgets without double-drawing (pdf.js
   `annotationMode`, the annotation layer vs the canvas `beginAnnotation` path, Adobe's in-place widget
   rendering), and (b) analyse the operator's `956.pdf` — exact field and widget counts, per-page
   distribution, any field whose editor is missing or mis-placed today, and why. Findings are recorded in
   the child-issue thread before the fix briefs are written.
2. **The operator's file is inspected, never modified in place and never committed.** Any fixture derived
   from it is synthetic or an anonymised copy placed under `test-fixtures/` (Phase 59 ruling 2 carries
   forward).
3. **One authoritative field layer.** A field must be drawn exactly once on screen. The page canvas and
   the interactive controls must not both paint the same widget.
4. **No fill regression.** The Phase 59 native-fill path (field `/V`, regenerated widget appearances,
   fill report) stays exactly as it is; this phase changes only what is *visible* and *hit-testable*.
5. **Engine changes are in scope only if the research proves the engine's geometry/enumeration is
   incomplete.** Otherwise the fix is renderer-only; the contract in `src/shared/` is not broadened
   speculatively.
6. **Read-only and signature widgets are canvases, not editors** (CTO ruling, chunk 2, 2026-10-01). A
   widget that pdf.js always paints on the canvas under `AnnotationMode.ENABLE_FORMS` — every read-only
   widget (`hasOwnCanvas = readOnly && !noHTML`) and every signature widget — is rendered by that one
   canvas appearance and gets NO overlay control; its "truthful non-editable state" (feature C) IS the
   document's own appearance. Consequently criterion 3's "interactive control count equals widget count"
   is scoped to FILLABLE widgets; read-only/signature widgets are represented exactly once by their
   canvas paint (zero overlay controls). An engine-orphan widget (id `orphan-…`) is exempt from this
   suppression and keeps its single `NonFillableView` surface. Editable fields are unchanged: overlay
   control only, and the canvas paints no `/AP` box under them.

7. **Correction to ruling 6 (CTO ruling, 2026-10-01, ADV-134 / DEF-444).** Ruling 6's
   `hasOwnCanvas = readOnly && !noHTML` is true only for `TextWidgetAnnotation`. The checkbox/radio branch
   of `ButtonWidgetAnnotation` and `ChoiceWidgetAnnotation` never set `hasOwnCanvas`, so under
   `AnnotationMode.ENABLE_FORMS` pdf.js paints NO canvas appearance for those widgets (empty op list,
   `separateForm: true`). A read-only checkbox/radio/dropdown/listbox is therefore NOT canvas-painted and
   must render its one truthful non-editable surface as a disabled `FormsOverlay` control (with the
   read-only reason). The suppression gate applies only to widgets pdf.js actually canvas-paints:
   signature widgets and read-only TEXT widgets. Ruling 7 supersedes ruling 6 where they differ; criterion
   3's control count is scoped to widgets that are NOT canvas-painted.

8. **Push buttons are canvas-painted too (CTO ruling, 2026-10-01, ADV-134 secondary / DEF-445).** pdf.js's
   push-button branch of `ButtonWidgetAnnotation` sets `hasOwnCanvas` (`pdf.worker.mjs:55363`), so a push
   button IS canvas-painted under `AnnotationMode.ENABLE_FORMS`. `formFieldKind`
   (`src/main/services/forms.ts:152-169`) currently misclassifies a `PDFButton` as `text`, so the overlay
   mounts an editable text editor over the painted button (a double surface). The engine therefore reports
   a non-breaking optional `pushButton?: boolean` on `FormField` (true for a `PDFButton`), and the
   renderer's single suppression gate suppresses the overlay for `field.pushButton === true`. A push button
   then has exactly one surface — its native canvas appearance — consistent with rulings 3 and 7, and its
   overlay control count is zero. No fill-path change.

**Features**

**A. Single-layer field rendering.** Opening a form-bearing PDF does not show a field twice. The
document's widget appearances are not painted on the page canvas beneath the interactive editors; the
editor is the field. Non-form page content (text, vector, images, the printed form artwork) is unchanged.

**B. Complete field coverage.** Every AcroForm field and every widget on a visible page has exactly one
interactive control, at that widget's own geometry: text fields, single check boxes, every widget of a
multi-widget button group (e.g. `mg.title` with 4 widgets, `mg.reason ex` with 6), dropdowns, list boxes
and multi-select lists. No field is silently dropped and no field is stacked into a fallback column when
its widget geometry is known.

**C. Faithful geometry and appearance.** Each control's on-screen box matches the widget `/Rect` (x, y,
width, height) in page points at every zoom level and page rotation, including rotated pages; the text
size, baseline and alignment inside a text field read like the field's own appearance; check boxes and
radio swatches are drawn inside their widget box; a read-only or signature field shows its truthful
non-editable state and never looks editable.

**D. Encrypted-form parity.** An encrypted PDF whose user password is empty (the operator's `956.pdf`)
opens without a spurious password failure and renders its full field set; an encrypted PDF that does
require a password keeps working through the Phase 52 password flow.

**E. Native filling preserved.** Editing a control still dispatches `fillFormField`; values survive a
save and read back from the field `/V`; the Phase 59 fill report still names any field not filled and
why; flatten still works.

**Research requirement.** Before implementation, record: how pdf.js 4.10.38 decides to paint an annotation
appearance onto the canvas versus into an annotation layer (`AnnotationMode`, `beginAnnotation`,
`hasOwnCanvas`), what Adobe does for an empty-user-password encrypted form, and the `956.pdf` field facts
(field count, widget count, per-kind and per-page counts, multi-widget groups, and the currently
missing/mis-placed editors). The chosen mechanism is recorded before the code is dispatched.

**Success criteria**

1. The characterisation records the `956.pdf` field facts and the missing/mis-placed editor list, and is
   reproducible by a named script/spec that runs on the anonymised fixture.
2. With the fixture open, no field appears twice: for a sample of fields on a visible page, the pixel
   region of a widget shows one control, and the canvas under it does not paint a duplicate field box
   (before/after screenshot evidence).
3. Enumeration parity: the number of interactive controls on a page equals the number of widget boxes
   the engine reports for that page (counted for the whole fixture); zero fields missing, zero extras.
   The multi-widget groups render one control per widget.
4. Geometry parity: for a sample of fields, the control's measured box equals the widget `/Rect` mapped
   through the page scale within a small tolerance, at 100% and at a non-100% zoom, on a rotated page.
5. The operator's `956.pdf` (empty-user-password encrypted) opens with its full field set and no
   spurious password error; a password-required encrypted form still prompts and opens.
6. No fill regression: editing a control fills the field, a save/reopen shows the value from the field
   `/V` (independent-reader evidence), and the fill report still fires.
7. No visual regression to non-form content: text selection/search highlights, the annotation layer,
   signatures, stamps and the printed form artwork are unchanged (blast-radius checks).
8. `npm run verify` (conventions + typecheck) is green and the phase's targeted unit/e2e specs pass; the
   installer and portable still build and launch.
9. All DEF/ADV entries opened by Phase 65 are CLOSED or REJECTED with a written reason.

**CONTROL-INDEX:** the interactive controls are the existing `FormsOverlay` editors
(`.form-editor`, `.form-checkbox`, `.form-radio`, `.form-listbox`) whose promised actions are unchanged
from Phase 59 — this phase changes their placement/drawing fidelity, not their action. Each kind's e2e
proof is the per-page control-count and geometry assertions in criterion 3 and 4.

**Settings impact:** none - no new `AppSettings` field. This is a rendering-fidelity change to the form
layer; any engine change is limited to field/widget geometry already carried by `FormField` /
`FormFieldWidget`.

## Phase 66 — Book View: the comic viewport becomes an in-canvas read-only book mode (operator request via TFL-64, 2026-10-01)

**Operator request (verbatim):** "Make changes to the comic view. It should not open a separate
window. Rename it as "Book View" and place the icon on the top left of canvas. It should work for all
file formats. Clicking the icon should activate the book view. Enabling this should collapse both
context and inspector panel as well as the dock should be hidden as this is a read only mode. Only
annotation should be available for users to mark pages in this mode. The book view should have a book
like crease in the middle. Clicking on the right hand side page should show the next page on the right
and previous page on the left with smooth page flip animation. Clicking on the left page should do the
opposite. Allow multiple view like single/double page with icons on the top right. Single page should
also have the page flip animation."

**Relationship to Phase 56.** Phase 56 feature C shipped the Comic viewport as a full-window overlay
(`.reading-view` is `position: fixed; inset: 0`) offered only for `.cbz` / `.cbt`, with its trigger
(`.reading-open-button`) sitting above the page area. This phase evolves that viewport into **Book
View**: an in-canvas, read-only book mode available for every open document. The EPUB reflowable
chapter Reading view (Phase 56 feature A) is unchanged and keeps its own trigger and behaviour; Book
View presents page content, including the converted pages of an EPUB.

**ORCHESTRATOR RULINGS:**

1. **Same window.** Book View never opens a second Electron window; it mounts inside the existing
   document canvas region. `BrowserWindow.getAllWindows().length` must not change when it opens.
2. **One entry, all formats.** One canvas top-left icon toggles Book View and is present for every
   open document (PDF and every converted format), not only `.cbz` / `.cbt`.
3. **Read-only.** Entering Book View collapses the PAGES context rail and the Inspector and removes
   the Action Dock; only annotation tools (for marking pages) remain. Exiting restores the
   workspace's prior panel and dock state.
4. **Reuse, do not duplicate.** Pages render through the existing `PageView`; annotation marking uses
   the existing annotation model and handlers (`Annotation`, `AnnotationPatch`, `createAnnotation`,
   `editAnnotation`, `deleteAnnotation`, `addComment`). No second PDF renderer and no second
   annotation engine.
5. **Motion tokens only** (`src/renderer/hooks/motionTokens.ts` / `styles/animations.css`), the
   `prefers-reduced-motion` fallback is honoured, and PDF content is never recoloured or re-laid-out.
6. **No regression to the EPUB Reading view or the surviving comic controls;** the phase-56 specs are
   updated where a trigger label changed (qa owns `e2e/`).

**Features**

**A. Book View entry.** A canvas top-left control (`aria-label="Book View"`) is present for every
open document and toggles Book View on and off.

**B. Read-only mode.** While Book View is on, the PAGES rail is collapsed, the Inspector is collapsed
and the Action Dock is not rendered; a clear exit control (`aria-label="Close book view"`) returns the
workspace to its prior rail / Inspector / dock state.

**C. Book spread and page turn.** A double-page spread with a book-like centre crease; clicking the
right-hand page advances (next page appears on the right, previous on the left) and clicking the
left-hand page reverses, both with a smooth page-flip animation.

**D. Layout toggle.** Single/double toggle icons at the canvas top-right. Single-page mode also uses
the page-flip animation. The initial layout seeds from the existing validated
`readingDefaults.comics.layout`.

**E. Annotation marking.** In Book View the user can add annotations to pages with the existing
annotation tools and colours; page-content editing, forms and signatures are not offered.

**Research requirement.** Before implementation, record how the page flip is implemented with CSS 3D
transforms over the existing `PageView` canvas (no WebGL/3D dependency) and confirm the motion-token
and reduced-motion pattern; findings recorded in the child-issue thread.

**Success criteria**

1. For a plain PDF and for a `.cbz` document, the canvas top-left shows `[aria-label="Book View"]`;
   clicking it opens Book View in the SAME window (`BrowserWindow.getAllWindows().length` unchanged)
   and the exit control closes it (screenshots for both formats).
2. While Book View is on, the PAGES rail is collapsed, the Inspector is collapsed and no Action Dock
   is present (DOM-asserted), and on exit the prior rail / Inspector / dock state is restored.
3. Double-page Book View shows two pages with a visible centre crease (screenshot); a click on the
   right page shows the next spread (next on the right, previous on the left) and a click on the left
   page reverses; the flip animates and respects `prefers-reduced-motion`.
4. Single-page Book View shows one page, exposes the top-right single/double toggle pair, and its page
   turn uses the same flip animation.
5. In Book View a highlight/ink annotation can be placed on a page, survives leaving and re-entering
   Book View, and survives a save then reopen.
6. No regression: the Phase 56 reading specs (updated for the renamed trigger),
   `test/unit/renderer/readingView.test.tsx` and the phase's new unit/e2e specs pass; `npm run verify`
   is green.
7. All DEF/ADV entries opened by Phase 66 are CLOSED or REJECTED with a written reason.

**CONTROL-INDEX**

- `[aria-label="Book View"]` (canvas top-left) -> toggles Book View -> criterion 1.
- `[aria-label="Close book view"]` -> exits Book View -> criterion 2.
- `[aria-label="Book single page"]` / `[aria-label="Book double page"]` (canvas top-right) -> switch
  layout -> criterion 4.
- left/right page click surfaces (`[data-book-page-side="left"|"right"]`) -> turn the spread ->
  criterion 3.
- the existing annotation toolbar entries -> mark pages -> criterion 5.

**Settings impact:** none. No new `AppSettings` field; Book View seeds its default layout / fit from
the existing validated `readingDefaults.comics.layout` / `readingDefaults.comics.fit`.

## Phase 67 — Top-of-canvas notices adopt the collapse-to-"i" behaviour (operator request via TFL-104, 2026-10-01)

**Operator request (verbatim):** "Similar to TFL-46, do this for all the messages that appear on the
top after opening certain files."

**Relationship to Phase 59 feature B / TFL-46.** TFL-46 delivered the collapse behaviour for the
document-protection notice only ("The Document protected Message ... should show up on the top in a
rounded box with animation and then collapse into a 'i' icon on the top left of the canvas after 10
seconds. User should be able to expand and collapse it."). This phase extends the SAME presentation
contract (rounded animated box -> auto-collapse after ~10 s into a small "i" pinned at the canvas
top-left -> user expand/collapse with the dwell resetting on expand) to the OTHER notices that appear
above the canvas after OPENING a file.

The open-triggered top-of-canvas messages are exactly two (the protected-document one is already
done): the conversion/import card shown after a non-PDF is imported (Phase 53, `ConversionNotice`)
and the 3D-content notice shown after a PDF carrying 3D annotations is opened (Phase 57,
`Pdf3dNotice`).

**ORCHESTRATOR RULINGS:**

1. **The protection notice IS the reference pattern and is NOT changed.** Phase 59 feature B /
   `ProtectionNotice.tsx` / DEF-435 stay exactly as they are; its behaviour is the template to
   mirror, not a file to edit.
2. **Scope is precisely the two remaining open-triggered top notices:** `ConversionNotice` (Phase 53)
   and `Pdf3dNotice` (Phase 57). `ValidationNotice` (Phase 54) is EXPLICITLY OUT OF SCOPE: it is not
   produced by opening a file (it appears after a validation run or a blocked/warned save), so it is
   not one of "the messages that appear on the top after opening certain files". `Toasts` are
   bottom-right, not top. `ExportPagesWithoutTextNotice` lives inside export dialogs, not above the
   canvas. Neither is touched.
3. **No information is lost.** The collapsed "i" is always present and re-expands the notice; after
   re-expanding a conversion card its full warning set (message + detail) is readable again, and after
   re-expanding the 3D notice every page/object entry is readable again.
4. **Same dwell, same instant path.** The auto-collapse is the same ~10 s reading pause as the
   protection notice; it resets on every expand. Under reduced motion / Animations OFF the collapse
   and re-expand take the instant path (no exit animation), exactly as `ProtectionNotice` does.
5. **Motion tokens only** (`src/renderer/hooks/motionTokens.ts` / `styles/animations.css`); the only
   named constant is the ~10 s dwell.
6. **Collapsed icons never collide.** When more than one notice is collapsed at once the "i" icons are
   laid out in a ROW at the canvas top-left so no two share a pixel, and no "i" covers a canvas
   control or the page.
7. **The conversion card's dismiss "X" is replaced by the collapse control** (as the protection
   notice's was), so the card stays available through its "i". Its existing `data-*` hooks and its
   Phase 53 `--tf-tools-inset` reservation rule are preserved.

**Features**

**A. Conversion/import notice collapses to an "i".** The `ConversionNotice` card (shown above the
canvas after a non-PDF file is imported) renders as a rounded box with the existing entrance
animation, then after ~10 s collapses into a compact "i" icon at the canvas's top-left. Clicking the
"i" re-expands it; the expanded card carries a collapse control that closes it again; the dwell resets
on expand. The card's source label, fidelity copy and every warning remain unchanged and readable.

**B. 3D-content notice collapses to an "i".** The `Pdf3dNotice` (shown above the page area for a
document carrying 3D annotations) becomes a rounded animated box with the same auto-collapse-to-"i"
behaviour, re-expand on click and a collapse control on the expanded box. Every page/object entry
stays readable when expanded. It remains a flow element and never covers the page.

**C. Shared collapse behaviour.** Both notices reuse ONE collapse state machine (extracted so the
behaviour cannot drift), mirroring `ProtectionNotice.tsx`'s `expanded -> closing -> collapsed` phases,
its dwell effect and its `useInstantMotion` fast path. `ProtectionNotice` is left behaviourally
unchanged.

**Success criteria**

1. Opening a converted/imported non-PDF file shows the conversion card as a rounded animated box; after
   ~10 s (measured) it collapses into an "i" at the canvas top-left; clicking the "i" re-expands it;
   the expanded card's collapse control closes it again; the dwell resets on expand; every warning is
   readable after re-expand (screenshot + DOM assertions).
2. Opening a PDF with 3D content shows the 3D notice as a rounded animated box; it auto-collapses into
   an "i" at the canvas top-left after ~10 s; it re-expands/collapses on demand; the page/object text
   is readable after re-expand (screenshot + DOM assertions).
3. When a conversion card and a 3D notice are both present and both collapsed, both "i" icons are
   visible, laid out in a row with non-overlapping measured boxes, and neither overlaps a canvas
   control.
4. The collapsed "i" never covers the page content or an interactive control (`elementFromPoint` at the
   icon centre resolves to the icon; at the page area resolves to the page).
5. Reduced motion / Animations OFF: collapse and re-expand happen instantly (no transition), matching
   the protection notice's instant path.
6. No regression: the protection-notice behaviour and its specs (`phase59ProtectionNotice.test.tsx`,
   `e2e/phase59_protection_notice.spec.cjs`, `tfl46_protection_*`), the Phase 53 conversion hit-test /
   warning-visibility specs, the Phase 57 3D-notice specs, `npm run verify` and the phase's targeted
   unit/e2e specs stay green; the installer and portable still build and launch.
7. All DEF/ADV entries opened by Phase 67 are CLOSED or REJECTED with a written reason.

**CONTROL-INDEX**

- `[data-conversion-notice]` (expanded conversion box) -> read source/fidelity/warnings -> criterion 1.
- `[data-conversion-collapse]` -> collapse the conversion card -> criterion 1.
- `[data-conversion-icon]` -> re-expand the conversion card -> criterion 1.
- `[data-pdf3d-notice]` (expanded 3D box) -> read page/object entries -> criterion 2.
- `[data-pdf3d-collapse]` -> collapse the 3D notice -> criterion 2.
- `[data-pdf3d-icon]` -> re-expand the 3D notice -> criterion 2.

**Settings impact:** none. No new `AppSettings` field; the ~10 s dwell reuses the existing named-
constant pattern (as `PROTECTION_NOTICE_AUTO_COLLAPSE_MS` does) and the fast path reuses
`useInstantMotion` / the motion tokens.

## Phase 68 — Tab colour calm-down and uniform tab size (operator request via TFL-105, 2026-10-01)

**Operator request (verbatim):** "The tab colors are too bright. Make the color tone lighter and
modern. Also, make sure all tabs are same size."

**ORCHESTRATOR RULINGS (the operator may veto or adjust any of these):**

1. **Scope = the default `colorful` tab style only.** As in Phase 62, `standard` is left
   untouched, so Phase 58 criterion 1 ("standard reproduces the pre-phase tab appearance") stays
   true. Applying the same calm-down to `standard` would be a follow-up if the operator asks.
2. **"Lighter and modern" = a soft tinted surface, not a full-strength colour block.** The colorful
   tab's body fill stops being the raw semantic token (today `--sem-primary` / `--sem-attention` /
   `--sem-affirmative` / `--sem-neutral` at 100%) and becomes a light tint of the tab's palette hue
   mixed into the theme surface: inactive = `color-mix(in srgb, var(--tf-tab-accent, var(--sem-neutral))
   18%, var(--bg-elevated))`; active = the same mix at **34%**. The fill is FLAT (the Phase 58 two-stop
   vertical gradient is retired), so no bevel/gloss reading survives. Values are stated so the
   developer need not guess; the operator may veto the exact percentages.
3. **Tab ink follows the surface, not the hue.** The colorful tab label uses `var(--fg-strong)` (the
   theme's strong foreground) instead of `--tf-tab-ink`, so the label reads on the light tint in every
   theme. The `--fg-strong`-on-fill contrast must clear the 4.5:1 text floor in light, dark and frosted.
4. **Per-tab colour identity is preserved.** The `.tab-colour-chip` keeps the FULL accent colour
   (`color-mix(in srgb, var(--tf-tab-ink) 35%, var(--tf-tab-accent))` is replaced by the plain full
   accent so the chip is a saturated hue mark on the pale body), and the adjacent-tab distinctness
   invariant (Phase 45) is unchanged.
5. **All tabs are the SAME size = a fixed, uniform tab width.** The colorful tab currently sizes to
   content (`width: auto` between `min-width: 132px` and `max-width: 200px`), so a long title and a
   short title render different widths. Every colorful tab becomes a fixed **180px** wide
   (`width: var(--tf-tab-width, 180px)`); the overflow plan may still shrink all tabs uniformly below
   that, and the existing 132px floor is unchanged. The overflow planner's `natural` for `colorful`
   (in `AppHeader.tsx`) is updated from 200 to 180 so the at-rest width and the shrink regime agree.
6. **Phase 62 behaviour is retained.** The compact 26px height, the uniform corner radius, the active
   tab flush with the canvas (square bottom corners, no ink underline, the strip extension) and every
   tab BEHAVIOUR (activation / close, reorder, tear-out / drag-back, overflow shrink / stack) are
   unchanged.

**Features**

**A. Lighter, modern colorful tab colour.** The colorful tab body paints the flat soft tint in ruling
2; the two-stop gradient is gone; the tab label uses `--fg-strong`; the colour chip stays the full
accent. Light, dark and frosted themes all get the calm treatment.

**B. Uniform tab size.** Every colorful tab measures the same width (180px at rest) and the same 26px
height, active or inactive, so no tab is wider or taller than another.

**Current-scope supersession:** this phase supersedes only the Phase 58 / 51 COLORFUL tab COLOUR
(full-strength semantic fill + white/dark hue ink + two-stop gradient + tinted chip) and the
content-sized colorful width. The `standard` style, the Phase 45 per-tab palette assignment, the
Phase 62 silhouette (26px, uniform radius, active flush with the canvas), the `tabStyle` preference
and every tab behaviour remain in force. The e2e oracle `e2e/phase58_tab_style.spec.cjs` (its
`minWidth` uniformity check and any full-strength-colour assertion) is repointed by qa to the Phase 68
oracle (identical measured WIDTH, the tinted fill, `--fg-strong` ink).

**Success criteria**

1. Every colorful tab (active and inactive) measures an identical width (max-min <= 0.5px) and an
   identical 26px height (max-min <= 0.5px) - measured boxes + a light and a dark screenshot.
2. The colorful tab fill is a soft tint, not the raw semantic token: the computed inactive/active
   `::before` background is the ruled `color-mix(... , var(--bg-elevated))` (no two-stop gradient), it
   is measurably lighter than the full-strength token, and the `--fg-strong` label clears 4.5:1 against
   it in all three themes.
3. Per-tab hue identity survives: the colour chip still paints the full accent and two adjacent tabs
   resolve different accents (Phase 45 invariant unchanged).
4. Phase 62 retained: every colorful tab is 26px high with the uniform corner radius, the active tab
   remains flush with the canvas (gap <= 1px, square bottom corners, no separator line), and
   `standard` still reproduces the pre-phase appearance - screenshot + measured.
5. No behaviour regression: mousedown activation and close (DEF-034), reorder (Phase 58), tear-out /
   drag-back (Phase 61), the Phase 59 overflow shrink / stack, and the Phase 58 / 59 / 60 / 61 / 62 tab
   suites stay green after the oracle repoint.
6. `npm run verify` and the targeted unit test for this phase pass.
7. All DEF / ADV entries opened by this phase are CLOSED or REJECTED with a written reason.

**CONTROL-INDEX:** none - this phase introduces no new control; it restyles existing tab surfaces
(nothing is added, removed or re-bound).

**Settings impact:** none - no new `AppSettings` field. This is a renderer-only styling change (`src/renderer/styles.css` plus the `TAB_OVERFLOW_METRICS.colorful.natural` constant in `src/renderer/components/AppHeader.tsx`); no IPC or shared-contract change.

## Phase 69 — Jovrel "Halo" brand kit: artwork, in-app mark + loader and the brand colour (operator request via TFL-120, 2026-10-01)

**Operator request (verbatim):** "check C:\Users\tanzi\Documents\kimi\tasks\2026-09-22\15-22-34-c38fee44\jovrel-brand. It has all the branding resources. Implement it for all the app elements like app icon, installer icon, file icon, loading spinning ring etc. Don't miss any elements. Also make necessary changes to the app color to match this branding color. Make sure, the colors are implemented elegantly."

**Operator ruling (CTO, this phase — the operator may veto or adjust any of these):**

1. **The kit is the final "Halo" identity and replaces Phase 49's artwork.** Phase 49 set the Jovrel NAME and a first blue "triple-stroke J" mark. The `jovrel-brand` folder holds the final kit: a gradient ring on a near-black tile with a leading dot (the app/mark), a matching PDF file-type icon, the wordmark, the `.ico` set, the favicon, and the loader rings. Phase 69 replaces the Phase 49 artwork and repoints the Phase 49 oracles. The Jovrel name, `productName: Jovrel` and `appId: com.tflex.app` (and the userData migration) are unchanged.
2. **Brand palette (source of truth, from the kit's SVGs, verbatim):** amber `#FBBF24` (rgb 251,191,36); pink `#EC4899` (rgb 236,72,153); violet `#8B5CF6` (rgb 139,92,246); deep violet `#7C3AED`; tile `#0F0A14` (rgb 15,10,20); file-icon page `#F5F6FA`; file-icon fold `#D0D4E0`. The mark/loader gradient runs amber -> pink -> violet; the single UI accent is the solid deep violet `#7C3AED`.
3. **"Elegant" colour = one restrained violet accent, not a purple-dominated theme.** The whole accent FAMILY moves to the brand violet with the SAME structure and per-theme lightness discipline already in `styles.css`; the multi-hue gradient is reserved for the mark, the loader and (optionally) the conversion progress bar - never for large surfaces. The neutral zinc/slate base and the semantic affirmative/attention hues are untouched.
4. **Contrast is contract.** Every existing contrast/legibility suite (`phase38LegibilityContrast.test.ts`, `phase40SemanticPalette.test.ts`, `designTokensContract.test.ts`) must stay GREEN after the hue swap, and white-on-accent (`--fg-on-accent: #ffffff`) must clear 4.5:1 on every solid accent fill in all three themes. Direct `color: var(--accent)` text on dark surfaces must be raised to the per-theme label token (`--sem-primary`) where it would fall below 4.5:1; the developer tunes LIGHTNESS only, never the hue.

**Features**

**A. Packaging + shipped assets (backend-dev).**
- Refresh `assets/brand/` from the operator kit: replace `jovrel.ico`, `jovrel-pdf.ico`, `jovrel-mark.svg` + the four `jovrel-mark-*.png`, `jovrel-pdf-file.svg` + the two `jovrel-pdf-file-*.png`, and both `jovrel-wordmark-*-bg.png`; ADD the loader rings `jovrel-ring-256.png`, `jovrel-ring-1024.png`, `jovrel-ring-light-256.png`, `jovrel-ring-light-1024.png`.
- Place the NON-shipped website artwork in `docs/brand/website/`: `favicon.ico`, `favicon-legibility.png`, `concept-f-halo.png`, `preview-sheet.png`, `jovrel-ring-preview.png`, `jovrel-ring-light-preview.png` (documentation only; never referenced by the app or the builder).
- `electron-builder.yml`: `win.icon`, `nsis.installerIcon`, `nsis.uninstallerIcon` stay `assets/brand/jovrel.ico`; the `.pdf` `fileAssociations[].icon` stays `assets/brand/jovrel-pdf.ico`. No path change - only the refreshed bytes change. Confirm the `.ico` set contains the 16/24/32/48/64/128/256 size frames.

**B. In-app mark, wordmark and loader (frontend-dev).**
- `src/renderer/components/BrandMark.tsx`: replace the blue-J geometry with the Halo ring built INLINE from `assets/brand/jovrel-mark.svg` (the `#0F0A14` tile, the amber->pink->violet arc `M 324.8 167.7 A 120.0 120.0 0 1 1 215.0 153.2` at stroke-width 27 round-capped, and the white dot `circle cx=272.7 cy=147.2 r=20.4`) in the 512 viewBox. Keep the inline-SVG pattern, the unique-`useId` gradient id, and the `size`/`className`/`title`/`data-brand-mark` API.
- `src/renderer/components/BrandWordmark.tsx`: keeps styled text "Jovrel" (no image); align weight/tracking to the kit wordmark.
- NEW `src/renderer/components/BrandLoader.tsx`: an inline-SVG spinning ring using the kit's ring geometry, theme-aware dot colour (white on dark, `#7C3AED` on light/frosted), animated via the existing motion tokens / the shared spin keyframes; `size` + `className` + `data-brand-loader` + `aria-hidden` API. Use it for EVERY loading indicator: replace the `LoaderCircle`/`Loader` glyphs in `UpdateIndicator.tsx` (downloading), `UpdatePromptDialog.tsx` (downloading), `ConversionNotice.tsx` (`conversion-progress-icon`), and add it to the print-window loading banner (`PrintWindowApp.tsx`, currently a text-only "Loading the document..."), the Welcome samples loader and the accounts/reading loading lines. No loading spinner anywhere keeps a generic lucide glyph.
- Per-surface CSS in `src/renderer/styles.css` for the mark/wordmark/loader (mirror the existing `.brand-mark` / `.welcome-brand*` / `.about-mark` / `.accounts-brand*` / `.print-window-brand*` rules).

**C. Brand colour (frontend-dev).** In `src/renderer/styles.css`:
- `:root` accent family hue-swap to deep violet, structure unchanged: `--accent: #7C3AED`, `--accent-hover: #8B5CF6`, `--accent-pressed: #6D28D9`, and the derived `--accent-soft` / `--accent-selected` / `--accent-pressed-soft` / `--accent-hover-bg` / `--focus-ring` / `--select-edge` triples re-based on `124, 58, 237` (alpha values unchanged).
- `--sem-primary` per theme: light `#7C3AED`, dark `#A78BFA` (violet-400, keeps the existing dark-lightening discipline), frosted `#6D28D9`.
- `--tf-accent` family (global frosted alias): `#7C3AED` / `#8B5CF6` / `#6D28D9`, washes on `124, 58, 237`.
- Any direct `color: var(--accent)` used as TEXT on a dark surface that would drop below 4.5:1 is switched to `var(--sem-primary)`.
- The mark/loader gradient uses amber `#FBBF24`, pink `#EC4899`, violet `#8B5CF6` (optionally also the conversion progress bar fill).

**D. Oracle repoint (frontend-dev + qa).** `test/unit/renderer/phase49Brand.test.tsx`'s mark-geometry block is repointed by frontend-dev to the Phase 69 geometry (still inline-SVG, unique gradient id, theme-safe). The mark-geometry half of `e2e/phase49_brand_gate.spec.cjs` is repointed by qa. `test/unit/main/phase49Branding.test.ts` is untouched (it asserts config paths and PDF metadata, which do not change).

**Success criteria**

1. The installed product carries the Halo artwork: `assets/brand/jovrel.ico` (window + installer + uninstaller) and `assets/brand/jovrel-pdf.ico` (the `.pdf` association) are the Phase 69 kit files, the `.ico` set holds the 16-256px frames, and the build's executable/installer icon is the Halo tile (report the artifact + a screenshot of the installed icon).
2. Every branded surface shows the Halo mark + "Jovrel": the title bar, the Welcome hero, the About dialog, the account sheet and the print window - screenshots in light, dark and frosted, with no user-visible "TFlex" in those surfaces (a grep-based assertion plus screenshots).
3. The mark renders the Phase 69 geometry inline with a unique per-instance gradient id and reads correctly at the small title-bar size (18px) in all three themes (state the sizes); the wordmark is still the text "Jovrel".
4. The loading spinning ring is the brand ring everywhere a loading indicator appears: the update indicator, the update prompt, the conversion notice, the print-window loading banner, the Welcome samples loader and the accounts/reading loading lines - no generic `Loader`/`LoaderCircle` glyph remains; the ring rotates (a captured animation frame pair proves motion) and its dot colour follows the theme.
5. The single accent is the brand violet: the computed `--accent` family and `--sem-primary` resolve to the Phase 69 values in all three themes; the multi-hue gradient appears only on the mark/loader (and optionally the progress bar), never on a large surface.
6. Contrast holds: white-on-accent clears 4.5:1 on every solid accent fill in all three themes, and `phase38LegibilityContrast.test.ts`, `phase40SemanticPalette.test.ts` and `designTokensContract.test.ts` stay green (report the measured ratios).
7. No behaviour regression: the title-bar layout, the Phase 58/62/68 tab rules, the Phase 15 motion rules and `npm run verify` stay green; `phase49Brand.test.tsx` and `phase49_brand_gate.spec.cjs` pass repointed; all DEF/ADV entries this phase opens are CLOSED or REJECTED with a written reason.
8. The phase ships as a MINOR bump (a brand-identity change, not a fix), committed by git-agent with no push (operator permission required for push/tag/release).

**CONTROL-INDEX:** none - no new interactive control. The loader is a `role="status"`/`aria-busy` indicator replacing existing spinners; the mark and wordmark are decorative/labelled SVG.

**Settings impact:** none - no new `AppSettings` field. Renderer styling (`src/renderer/styles.css`, the brand components), shipped assets (`assets/brand/`) and packaging config only; no IPC or shared-contract change.

## Phase 70 — Jovrel brand-map completion: shipped favicon, user-visible string sweep and the accent-text token (operator request via TFL-120 map, 2026-10-01)

**Operator request (verbatim):** "Check the instructions on the implementation of branding" + the `jovrel-brand-implementation-map.txt` attachment on TFL-120 (comment 8873bab5).

**Operator ruling (CTO, this phase — the operator may veto or adjust any of these):**

1. **The `jovrel-brand` implementation map is the authority for the rebrand's completeness.** Phase 49 shipped the Jovrel NAME and packaging; Phase 69 shipped the Halo artwork, the inline mark/wordmark, the loader and the brand-violet accent. This phase closes the map's two remaining gaps (its acceptance checks 2 and 4) plus the one contrast clause Phase 69 left open.
2. **Internal identity is frozen.** Do NOT rename `appId: com.tflex.app`, IPC channel names, the `window.tflex` bridge, the `/TFlexColor` / `/TFlexSig` / `/TFlexBox` / `/TFlexComments` PDF keys, the `TFlexApi*` type names, the font family prefix, file paths or the userData folder. Only USER-VISIBLE strings change.
3. **Favicon is shipped artwork in Phase 70.** Phase 69 filed `favicon.ico` under `docs/brand/website/` as non-shipped art; the map requires it in `assets/brand/` and linked from the renderer entry, so Phase 70 promotes it. `vite.config.ts` already sets `publicDir` to the repo `assets/` root with `base: "./"`, so `assets/brand/*` are served (dev) and copied to `dist/renderer/brand/*` (build).
4. **The accent-as-text contrast clause is honoured with a dedicated token.** Phase 69 criterion 6 required dark-surface `color: var(--accent)` text be raised to >= 4.5:1, but the `designTokensContract.test.ts` allowlist reserves `var(--sem-*)` for tool/icon selectors. Phase 70 adds a per-theme `--accent-text` token so the text rules clear 4.5:1 without violating that contract.

**Features**

**A. Shipped favicon (backend-dev asset + frontend-dev link).**
- backend-dev: copy the kit's `favicon.ico` to `assets/brand/favicon.ico` (leave the `docs/brand/website/` copy in place as documentation).
- frontend-dev: add `<link rel="icon" href="./brand/favicon.ico" />` to the `<head>` of `src/renderer/index.html`.

**B. User-visible "TFlex" string sweep (backend-dev + frontend-dev).** Replace the remaining user-visible "TFlex" with "Jovrel" in:
- backend-dev (main): `src/main/services/export/pptx-export.ts` (`author`/`company`/`title`), `src/main/services/export/xlsx-export.ts` (`Title`/`Author`/`Company`), `src/main/services/convert/errors.ts` (the `drm-protected` message), `src/main/services/convert/mobi-parse.ts` (`MOBI_DRM_MESSAGE` and the HUFF/CDIC message).
- frontend-dev (renderer): `src/renderer/security/protection.ts` (`PROTECTION_ENFORCEMENT_TEXT`), `src/renderer/state/convert.ts` (the DRM notice), `src/renderer/components/EncryptDialog.tsx` (the permissions hint).
- Do NOT touch code comments or internal identifiers; only strings a user can see.

**C. Accent-text contrast token (frontend-dev, sequenced after A/B).** Add a per-theme `--accent-text` token (light `#7C3AED`, dark `#A78BFA`, frosted `#6D28D9`) and switch the ~40 `color: var(--accent)` text rules to `var(--accent-text)`; extend the `designTokensContract.test.ts` allowlist to permit `--accent-text` on those text selectors (never `--sem-*`).

**Success criteria**

1. `src/renderer/index.html` declares the favicon; `assets/brand/favicon.ico` exists (kit bytes) and a production build emits `dist/renderer/brand/favicon.ico` (report the emitted path).
2. No user-visible "TFlex" string remains: a grep-based assertion over `src/` with an explicit internal-identifier allowlist returns zero user-visible matches, and the Office export metadata + the reader protection/DRM text read "Jovrel" (report the grep output).
3. The existing oracles stay green: `test/unit/renderer/phase52Protection.test.ts`, `test/unit/main/phase52Encryption.test.ts` and `e2e/phase52_gate.spec.cjs` pass (their `does not enforce` substring assertions survive the swap); any spec that hard-pins a full "TFlex" string is repointed by qa.
4. Every `color: var(--accent)` text rule on a dark surface resolves to `--accent-text` and clears 4.5:1 in all three themes; `designTokensContract.test.ts`, `phase38LegibilityContrast.test.ts` and `phase40SemanticPalette.test.ts` stay green (report the measured ratios).
5. `npm run verify` (conventions + typecheck) is green, and the Phase 69 e2e oracles (`phase49_brand_gate.spec.cjs` mark-geometry half) pass repointed.
6. No behaviour regression: no layout, navigation, IPC or file-format change; the phase-close commit is a MINOR bump by git-agent with no push.

**CONTROL-INDEX:** none - no new interactive control.

**Settings impact:** none - no new `AppSettings` field. Shipped assets (`assets/brand/`), the renderer HTML head, user-visible strings and renderer styling only; no IPC or shared-contract change.

## Phase 71 — Context-window size transitions: the Preferences sheet animates between category heights, plus a bounded sweep of the app's mode-swapping dialogs (operator request via TFL-190, 2026-10-01)

**Operator request (verbatim):** "1. The preferences window doesn't have transition animation on different sizes. Fix it. 2. Check if there are more elements that's missing animation and fix them."

**Operator ruling (CTO, this phase — the operator may veto or adjust any of these):**

1. **The reported symptom is a size JUMP, not a missing fade.** The Phase 59 (item 8) Preferences sheet keeps its width fixed (`min(840px, calc(100vw - 48px))`) but derives its height from the active category's content, so clicking a category changes the sheet height with no transition. The existing `.anim-tab-in` crossfade only fades the panel's opacity; it does not animate the box.
2. **The fix must use the existing motion primitive, not new motion code.** `TfResize` (`src/renderer/components/motion/TfResize.tsx`) already animates a frame to the measured size of its content over `--motion-duration-standard` and already collapses to instant under `prefers-reduced-motion: reduce` OR the Animations setting OFF (`useInstantMotion`). The Preferences sheet is mirroring the canonical usage in `SignatureManagerModal.tsx:157` — do NOT invent a second size-animation mechanism, do NOT hardcode durations, and do NOT use `scaleY` (it smears glyphs).
3. **"More elements" is a bounded sweep, not an open-ended audit.** Only context windows (`TfDialog` / `TfSheet`) that swap their visible content on an IN-DIALOG mode/tab/step control AND change height may jump. The named set is: `InsertPagesDialog.tsx` (blank / from-PDF), `SplitDialog.tsx` (extract / split), `CropPagesDialog.tsx` (all-pages / per-page), `AccountsDialog.tsx` (sign-in step flow). Each gets a verdict and, where it jumps, the same `TfResize` wrap.
4. **Explicitly OUT of scope:** `SignatureManagerModal.tsx` (already uses `TfResize` — the reference), the top-level panels/sidebars (`TfPanel` / `AnimatedPanel` already animate), the theme crossfade (Phase 15), and any surface whose content does not change size on an in-dialog control.

**Features**

**A. Preferences sheet size transition (frontend-dev, primary).**
- `src/renderer/components/PreferencesDialog.tsx`: wrap the category-panel container currently inside `.prefs-content` (`PreferencesDialog.tsx:391-700`) in `TfResize` with `axes="height"` (import from `./motion/TfResize`), mirroring `SignatureManagerModal.tsx:157-201`. The four panels stay MOUNTED and hidden via `hidden` (a hidden panel is `display:none`, contributes 0 to the measurement — only the active panel's height drives the tween). Keep the active panel's `.anim-tab-in` crossfade and every `data-prefs-*` hook exactly as they are.
- The sheet must still shrink and grow with the animated frame, never overflow the `min(700px, calc(100vh - 48px))` max-height, and the rail must stay put while `.prefs-content` scrolls a long category.

**B. Bounded mode-swap size-jump sweep (frontend-dev, after A).** For each named file below, if swapping the mode/tab/step changes the dialog body height without animation, wrap the swapping content in `TfResize` (`axes="height"`) the same way; if the content swaps without a height change, or an existing primitive already animates it, leave it and record the verdict:
- `src/renderer/components/InsertPagesDialog.tsx` (blank / from-PDF fieldset at `InsertPagesDialog.tsx:328-374`).
- `src/renderer/components/SplitDialog.tsx` (extract / split).
- `src/renderer/components/CropPagesDialog.tsx` (all-pages / per-page).
- `src/renderer/components/AccountsDialog.tsx` (sign-in step flow).
- Verdicts to report, one line each: `FIXED - <what>`, `ALREADY ANIMATED - <primitive>`, or `NO SIZE CHANGE - <why>`.

**C. Tests (frontend-dev).**
- Extend `test/unit/renderer/prefsDialogRedesign.test.tsx` with an assertion that the Preferences sheet contains a `[data-tf-resize="height"]` frame wrapping the category panels (the frame `TfResize` renders).
- For each file FIXED in B, add a unit assertion that the mode-swap content is wrapped in `[data-tf-resize]` (mirror the existing `tfResize.test.tsx` seam).
- Keep every existing `prefsDialogRedesign.test.tsx` assertion (hooks, rail keyboard, `.anim-tab-in`) green.

**Success criteria**

1. Switching a Preferences category animates the sheet's real height over the standard motion token instead of jumping: the sheet contains a `[data-tf-resize="height"]` frame wrapping the panels, and under `prefers-reduced-motion: reduce` / Animations OFF the change is instant (existing `TfResize` path). Evidence: the run of `npm.cmd run test:unit -- test/unit/renderer/prefsDialogRedesign.test.tsx` plus a manual/e2e screenshot of two category states at different heights.
2. No Preferences regression: the `.anim-tab-in` crossfade still applies to the active panel, all four panels stay mounted, every `data-prefs-*` hook exists from open, the rail keyboard (roving tabindex, arrows, Home/End) works, theme applies immediately, the recents cap commits on Enter, and Escape closes the sheet (DEF-201) - all existing assertions stay green.
3. The bounded sweep (feature B) returns a verdict per named file; every file that jumps is wrapped in `TfResize` with a passing unit assertion, and every file that does not is recorded as `ALREADY ANIMATED` or `NO SIZE CHANGE` with its reason.
4. No `scaleY`/transform-based size animation, no hardcoded durations: the motion reads the centralized tokens; `npm run verify` (conventions + typecheck) is green.
5. All DEF/ADV entries opened by Phase 71 are CLOSED or REJECTED with a written reason; the phase-close commit stages every Phase 71 change as ONE local commit by git-agent with no push. The version bump stays with the operator-authorised release batch, NOT this commit: the release gate pins `package.json` version to the newest `WHATS_NEW` entry (`test/unit/main/whatsNew.test.ts`), so a bare MINOR bump without release notes would turn the gate red. Do NOT bump `package.json` / `package-lock.json` and do NOT edit `src/shared/whatsNew.ts` in the phase-close commit.

**CONTROL-INDEX:** none - no new interactive control (visual motion only; every existing prefs control keeps its behaviour).

**Settings impact:** none - no new `AppSettings` field. Renderer-only motion wrappers (`TfResize`) over existing surfaces; no IPC or shared-contract change.

## Phase 72 — File tab refinements: centered rounded tabs, dirty-only dot, right-aligned close, brighter tint, fit-to-width resize and cross-window restore (operator request via TFL-188, 2026-10-01)

**Operator request (verbatim):**
"1. The file tabs should have rounded corners on all side and be positioned on the vertical middle of the bar. Not flush with the bar.
2. Active tab will extend and be flush with the bottom of the bar and engulf.
3. Remove the colored dot on each tab. Dot should only appear on tabs where changes were made.
4. The "x" icon should be on the far right of the tab.
5. Add subtle border on the tabs.
6. Make the tab colors 20% brighter.
7. Instead of stacking the tabs, dynamically resize tabs with animation when too many tabs.
8. Remove the horizontal scroll for the tab bar when there are too many tabs. Tabs shouldn't go outside of the bar view.
9. Dragging and dropping tab from another app window doesn't restore tabs to its original app window."

**ORCHESTRATOR RULINGS (the operator may veto or adjust any of these):**

1. **Scope = the default `colorful` tab style, as in Phases 62 and 68.** `standard` is left untouched, so Phase 58 criterion 1 ("standard reproduces the pre-phase tab appearance") stays true. Items 1, 2, 5, 6, 7 and 8 all land in the `colorful` scope; the `standard` style keeps its current silhouette, sizing and happy-path treatment.
2. **Item 1 — inactive tabs are vertically centred, not flush.** The colorful strip returns to a centred row (`align-items: center`, normal strip height; the Phase 62 `align-self: flex-end; height: calc(100% + 1px); margin-bottom: -1px` strip extension is retired). An inactive colorful tab keeps its 26px height and all FOUR corners carry the same non-zero radius; it floats clear of both the strip's top and bottom edges (top and bottom gaps >= 2px).
3. **Item 2 — the active tab is the only tab that reaches the canvas.** The active colorful tab extends DOWN from the centred row to the strip's bottom edge / canvas top so its fill runs continuously into the canvas (bottom gap <= 1px, no separator line), keeping its two TOP corners rounded and its two BOTTOM corners square. This refines only the Phase 62 "active flush with the canvas" geometry; it does not change what "engulf" means.
4. **Item 3 — the always-on per-tab identity dot is removed; the dirty dot stays.** The `.tab-colour-chip` (the Phase 45 / 51 palette-slot identity mark, always painted) is deleted from `AnimatedTab.tsx` and its CSS block removed. The ONLY dot a colorful tab may paint is `.tab-modified-dot`, painted **iff** the tab's `modified` flag is true (unchanged data path: the `modified` prop already drives it). This SUPERSEDES the Phase 45 / 51 per-tab colour-identity chip and Phase 68 criterion 3's chip clause; the adjacent-tab hue distinctness invariant is retired with the chip it was carried by. The active-tab cue (bolder/brighter treatment) is unchanged and never depends on the chip.
5. **Item 4 — the close control is pinned to the tab's far right.** `.tab-close` gains `margin-left: auto` in the colorful scope so it sits on the tab's trailing edge; the title takes the remaining width and ellipsizes (its `max-width` is relaxed to let `margin-left: auto` win). Nothing else moves.
6. **Item 5 — a subtle 1px border, stated as a value.** Every colorful tab body (`::before`) carries `border: 1px solid color-mix(in srgb, var(--tf-tab-accent, var(--sem-neutral)) 30%, var(--border-subtle))`; the border is drawn inside the tab box (no size change) and must be visible in light, dark and frosted without breaking the 4.5:1 label floor.
7. **Item 6 — "20% brighter" = the Phase 68 accent mix raised by 20% relative (x1.2).** Inactive tint `color-mix(in srgb, var(--tf-tab-accent, var(--sem-neutral)) 22%, var(--bg-elevated))` (was 18%); active tint the same mix at **41%** (was 34%). The fill stays FLAT (no gradient) and `--fg-strong` must still clear 4.5:1 on the brighter fill in all three themes.
8. **Item 7 — the Phase 59 item 10 STACK/OVERLAP is RETIRED.** Tabs never stack and never overlap: `planTabOverflow` always returns `overlap: 0`, and the `.tab-list > li:not(:first-child) > .tab { margin-left: var(--tf-tab-overlap) }` rule and the per-tab `--tf-tab-overlap` write are removed. When the natural widths do not fit, every tab SHRINKS UNIFORMLY to the same width and the width change rides the existing `width` transition on the shared motion token (no hardcoded duration; instant under reduced motion / Animations OFF).
9. **Item 8 — the strip never scrolls and tabs never leave the bar.** `.tab-list` stops being a scroll container (`overflow-x: hidden`, no `::-webkit-scrollbar` rule) and the uniform fit width is computed from the strip's measured inner width so that `count * width + (count - 1) * gap <= available`. `TAB_OVERFLOW_METRICS.colorful.floor` drops from 132 to `MIN_TAB_WIDTH = 56`; if even 56px per tab does not fit, the uniform width continues down to a hard `HARD_MIN_TAB_WIDTH = 24px` (title elided, close control remains the last child) so the strip still contains every tab. The colorful tab's own `min-width: 132px` is removed so the fit width actually applies.
10. **Item 9 — a tab dragged out of a detached window must return to its originating window.** The expected behaviour is exactly the Phase 58/61 contract: a detached window's tab, dragged out (released past its strip), is re-adopted by the window it was torn out of, that origin window shows the tab again, and the now-empty detached window closes. The existing oracle is `e2e/phase58_tab_detach.spec.cjs` (tear-out then drag-back returns the document to the origin, `survivors.length === 1`). The fix must make the REAL drag path behave like the spec; if the root cause is in `src/main/services/tabWindows.ts` or another main-process file, frontend-dev MUST stop and report to the CTO rather than crossing the role boundary — the CTO dispatches backend-dev.

**Features**

**A. Centered rounded inactive tabs + canvas-engulfing active tab (frontend-dev).**
- Inactive colorful tab: 26px high, one uniform non-zero radius on all four corners, vertically centred (>= 2px clear of the strip's top and bottom).
- Active colorful tab: top corners rounded, bottom corners square, foot flush with the strip bottom / canvas top (<= 1px, no separator), fill continuous with the canvas.
- The `standard` style is untouched.

**B. Dirty-only dot, right-aligned close, subtle border (frontend-dev).**
- The `.tab-colour-chip` element and its CSS are removed; the only dot is `.tab-modified-dot`, painted iff `modified === true`.
- `.tab-close` is pinned to the tab's trailing edge (`margin-left: auto`); the title ellipsizes in the remaining space.
- Every colorful tab body paints the ruled 1px `color-mix(...)` border.

**C. 20%-brighter colorful tint (frontend-dev).**
- Inactive `::before` background is the ruled 22% flat mix; active `::before` is the ruled 41% flat mix; the `--fg-strong` label clears 4.5:1 on both in light, dark and frosted.

**D. Fit-to-width animated resize, no stacking, no scrolling (frontend-dev).**
- `planTabOverflow` retires the overlap/stack branch: `overlap` is always 0; the uniform width shrinks (clamped to `[HARD_MIN_TAB_WIDTH, natural]`, title elided below `MIN_TAB_WIDTH`) so the row always fits the measured strip width.
- `.tab-list` is `overflow-x: hidden` and is no longer a scroll container; no horizontal scrollbar; no tab's right edge exceeds the strip's right edge at the default window and at the 640px minimum window for the tested tab count.
- The width change animates on the shared motion token.

**E. Cross-window tab restore (frontend-dev; backend-dev only if the CTO re-dispatches).**
- A tab dragged out of a detached window is returned to its originating window, the origin re-adopts and displays it, and the detached window closes; `e2e/phase58_tab_detach.spec.cjs` stays green and a new assertion (or spec) proves the return path after a real-style gesture.

**Current-scope supersession:** this phase supersedes (a) the Phase 62 strip-level flush (`align-self: flex-end`, `height: calc(100% + 1px)`, `margin-bottom: -1px` on `.tab-area[data-tab-style="colorful"]`) — replaced by a centred row with only the active tab reaching the canvas; (b) the Phase 45 / 51 / 68 always-on `.tab-colour-chip` colour identity and its adjacent-distinctness check; (c) the Phase 59 item 10 partial-stack overlap; (d) the Phase 68 "fixed 180px width with a 132px hard floor" sizing. It does NOT change: the `standard` tab style, the Phase 62 active-tab-engulf RULE (only its geometry is refined), every tab BEHAVIOUR (mousedown activation / close DEF-034, reorder, tear-out / drag-back, the `tabStyle` preference), the Phase 15 motion rules and the standing animation / cross-bubbling rules. The e2e oracles `e2e/phase58_tab_style.spec.cjs`, `e2e/phase59_tab_overflow.spec.cjs`, `e2e/phase62_*` and the unit suites `test/unit/renderer/phase45TabColour.test.tsx`, `phase51TabColour.test.ts`, `phase62TabRestyle.test.tsx`, `phase68TabRestyle.test.tsx`, `phase59PaletteAndTabOverflow.test.tsx` are repointed by qa / frontend-dev to the Phase 72 silhouette, size, dot and overflow contract.

**Success criteria**

1. Every inactive colorful tab measures 26px high with a non-zero, EQUAL `border-*-radius` on all four corners, and sits vertically centred: its top and bottom gaps to the strip are >= 2px (measured boxes + a zoomed light and dark screenshot).
2. The active colorful tab reaches the canvas: its bottom gap to the strip bottom / canvas top is <= 1px with no separator line, its two top corners are rounded and its two bottom corners are square (measured + a zoomed light and dark screenshot). The `standard` style still reproduces the pre-phase appearance (screenshot).
3. No always-on identity dot remains: the `.tab-colour-chip` element and its CSS are gone, and a tab paints `.tab-modified-dot` (visible) ONLY when `modified === true` — an unmodified tab's dot is `not.toBeVisible()` (unit assertion + a screenshot pair of a dirty and a clean tab).
4. On every colorful tab the close control is the last element on the trailing edge: its right edge is within 2px of the tab's right padding edge, and it stays there for both a long and a short title (measured).
5. Every colorful tab body paints the ruled 1px border (computed `border-*-width` = 1px, non-transparent computed colour) in light, dark and frosted (measured + screenshots).
6. The colorful tint is the ruled brighter mix: computed inactive `::before` background resolves the 22% `color-mix(...)` and active the 41% mix (no gradient), measurably brighter than the Phase 68 values, and `--fg-strong` on each clears 4.5:1 in all three themes (report the ratios).
7. Overflow resizes, never stacks, never scrolls: with 10 tabs in the default window AND at the 640px minimum window, every colorful tab measures the SAME width (max-min <= 0.5px), no tab's right edge exceeds the strip's right edge, `.tab-list` `scrollWidth <= clientWidth` (no horizontal overflow) and `overflow-x` computes to `hidden`; the 2-tab -> 10-tab width change animates (a captured frame pair shows intermediate widths) and is instant under `prefers-reduced-motion: reduce` / Animations OFF (measured + screenshots).
8. The overflow plan carries `overlap === 0` for every tab count (unit assertion on `planTabOverflow`), and the retired stack rule / `--tf-tab-overlap` write are absent from the source (grep-based assertion).
9. Cross-window restore works: from a detached window, the return gesture restores the document to its origin window and closes the detached window; `e2e/phase58_tab_detach.spec.cjs` passes and the origin shows exactly the returned tab (test output + screenshots).
10. No behaviour regression: mousedown activation and close (DEF-034), reorder (Phase 58), tear-out / drag-back (Phase 58 / 61), the `tabStyle` preference and the Phase 15 motion rules stay green; the repointed Phase 45 / 51 / 62 / 68 tab suites pass.
11. `npm run verify` (conventions + typecheck) and the targeted unit tests for every changed renderer file pass.
12. All DEF / ADV entries opened by this phase are CLOSED or REJECTED with a written reason; the phase-close commit stages every Phase 72 change as ONE local commit by git-agent with no push and no version bump (the bump belongs to the operator-authorised release batch; the release gate pins `package.json` to the newest `WHATS_NEW` entry).

**CONTROL-INDEX:** none - this phase introduces no new interactive control. It restyles existing tab surfaces and changes the tab strip's sizing/overflow strategy; activation / close / reorder / tear-out bindings are unchanged.

**Settings impact:** none - no new `AppSettings` field. Renderer-only changes (`src/renderer/components/AnimatedTab.tsx`, `src/renderer/components/AppHeader.tsx`, `src/renderer/styles.css`) plus, only if item 9's root cause is in main, a later backend-dev chunk; no new IPC or shared-contract change.

## Phase 73 — Tab dirty-dot sizing: shrink the modified dot so it is fully visible (board correction TFL-211, 2026-10-01)

**Operator request (verbatim from TFL-211):**
"The dot for the dirty tab is partially cut-out. Make the dot smaller and fully visible."

**ORCHESTRATOR RULINGS (the operator may veto or adjust any of these):**

1. **Scope = the default `colorful` tab style, as in Phases 58 / 62 / 68 / 72.** `standard` is left untouched. Only the dirty-dot geometry changes; every other Phase 72 tab decision (centred rounded inactive chips, canvas-engulfing active tab, right-aligned close, 1px body border, brighter tint, fit-to-width overflow, dirty-only data path) stays frozen.
2. **The dot is made visibly smaller than the Phase 72 dot.** Today `.tab-modified-dot` is a 7px box plus a 1.5px OUTSET `box-shadow` ring (`styles.css:2281-2293`) — a ~10px painted extent. Ruling: the dot's own box shrinks (recommended 5px, max 6px) AND any ring is painted INSIDE that box (a `box-sizing: border-box` border or an inset shadow), so the painted extent can never exceed the dot's box. The ring stays present (legibility on the pale colorful body is a Phase 72 / DEF-441 contract), just contained.
3. **The dot is fully visible inside the tab body.** No part of the dot or its ring may be clipped by `.tab-title`'s `overflow: hidden` (`styles.css:2191-2206`), by the tab's own box, by the `--radius-2` corner, or by the trailing `.tab-close`. If the title's clip is the cause, the dot's containing box gains the small leading breathing room it needs (e.g. a leading gap) rather than removing the ellipsis clip.
4. **The dot stays dirty-only and never moves the tab layout.** The dot is painted iff `modified === true` (unchanged `AnimatedTab.tsx:196-206` data path); clean tabs stay dot-free. The dot must not change the tab's width, height, title truncation, or close-control position.
5. **Legibility holds in light, dark and frosted, on active and inactive tabs.** The colorful dot keeps the full-strength accent fill with the `--fg-strong` ring (DEF-441); the standard dot keeps its Phase 51 ink fill.
6. **The dot holds at squeezed widths.** At the minimum / squeezed tab widths (many tabs, narrow window; `MIN_TAB_WIDTH` / `HARD_MIN_TAB_WIDTH` from Phase 72) the dot must remain fully painted — if the title is squeezed to the point where a reserved dot plus close cannot fit, the dot still wins its full box (the title ellipsizes first) and is never cut.

**Features**

**A. Shrink and contain the dirty dot (frontend-dev).**
- `.tab-modified-dot` is a smaller box (recommended 5px) whose full painted extent (fill + ring) is inside that box; the ring is drawn inside (`box-sizing: border-box` border or inset shadow).
- No ancestor clip cuts the dot in any tab state or width.
- Dirty-only, dirty data path, standard style, tab layout and close position are unchanged.

**B. Proof of full visibility and size (qa).**
- A focused e2e run measures the dot's painted box fully inside the tab body (dot rect contained in the tab rect, with the ring counted via the computed border / inset) at full width AND at the squeezed width, on active and inactive tabs, in light and dark, plus a dirty-vs-clean screenshot pair; and confirms the dot's outer size is strictly smaller than the Phase 72 7px-box-plus-outset-ring baseline.

**Current-scope supersession:** this phase supersedes ONLY the Phase 72 dirty-dot geometry — the `.tab-modified-dot` size and its outset ring. It does NOT change the Phase 72 dirty-only data path (`modified === true`), the `.tab-title` ellipsis behaviour, the close-control pinning, the tab silhouette / tint / border / overflow contract, or any tab behaviour. The unit suites `test/unit/renderer/phase58TabStyle.test.tsx` and `phase68TabRestyle.test.tsx` are repointed by frontend-dev to the Phase 73 dot geometry where they assert it.

**Success criteria**

1. The dirty dot is fully inside the tab body: for a dirty tab at full width, its painted bounding box (including any ring) lies wholly within the tab's own box, with non-negative clearance to every tab edge and the close control (measured).
2. The dot is visibly smaller than the Phase 72 dot: the dot's outer painted size is <= 6px, strictly smaller than the retired 7px box plus 1.5px outset ring (measured + a zoomed screenshot in light and dark).
3. Dirty-only: a `modified === true` tab paints a visible dot; a `modified === false` tab's dot is not visible (unit assertion + a screenshot pair of a dirty and a clean tab).
4. Legible on active and inactive tabs and in light and dark: the dot's fill and ring resolve to the ruled accent / `--fg-strong` colours and are visually distinct from the tab body (measured computed colours + zoomed screenshots in light and dark).
5. Holds at the squeezed width: with the tab strip squeezed to the minimum tab width, the dot is still fully painted inside the tab (measured).
6. No regression: the Phase 72 tab contract (silhouette, tint, border, close position, fit-to-width overflow, dirty-only dot) stays green; `test/unit/renderer/phase58TabStyle.test.tsx`, `phase68TabRestyle.test.tsx`, `phase45TabColour.test.tsx`, `phase62TabRestyle.test.tsx` and `e2e/phase58_tab_style.spec.cjs`, `e2e/phase59_tab_overflow.spec.cjs` pass.
7. `npm run verify` (conventions + typecheck) and the targeted unit tests for every changed renderer file pass.
8. The phase-close commit stages every Phase 73 change as ONE local commit by git-agent, with no push and no version bump.

**CONTROL-INDEX:** none - this phase introduces no new interactive control. It restyles the existing dirty dot; activation / close / reorder / tear-out bindings are unchanged.

**Settings impact:** none - no new `AppSettings` field. Renderer-only changes (`src/renderer/components/AnimatedTab.tsx` only if the markup needs the leading guard, and `src/renderer/styles.css`); no new IPC or shared-contract change.

## Phase 74 — Encrypted form parity: Adobe-grade single-surface fields and correct tick boxes on the operator's real 956.pdf (operator request via TFL-185 / TFL-225, 2026-10-01)

**Operator request (verbatim, TFL-185):** "The encrypted form still doesn't work properly after your last run. I asked you to make engine level changes if necessary to implement adobe like experience. This is highly important. Do it properly this time. I don't want to see any layered field boxes, incorrect tick boxes anymore."

**Relationship to Phase 65 (TFL-49).** Phase 65 fixed the synthetic-fixture single-layer path and closed its defects (DEF-444 / DEF-445), but every Phase 65 oracle ran on `test-fixtures/phase65/form-956-anon.pdf` - a synthetic generator (`make-fixture.cjs`) that reproduces only the anon fixture's *field topology*, not the operator file's encryption, widget-dictionary shape, appearance state model or geometry. The operator's `C:\Users\tanzi\OneDrive\Desktop\Parent visa\956.pdf` still shows layered field boxes and incorrect tick boxes. This phase makes the on-screen and saved field layer correct **on the real file**, and closes the verification gap that let Phase 65 pass while the operator's file stayed broken.

**ORCHESTRATOR RULINGS (the operator may veto or adjust any of these):**

1. **Real-file verification, faithful copy only.** A byte-identical copy of the operator's `956.pdf` may be placed under `test-fixtures/tfl225/` (gitignored by the existing `test-fixtures/*.pdf` rule; never committed, never modified in place) and is the mandatory verification oracle for criteria 1-6. A synthetic/anonymised stand-in alone is NOT acceptable evidence for this phase. The operator's original file is read-only and must never be altered or committed.
2. **Root cause over symptom.** The characterisation must first establish, from the real file and the installed pdf.js 4.10.38 + `@cantoo/pdf-lib` behaviour, exactly why widgets are layered, missing or mis-ticked (enumeration, `/P` page resolution, widget `/Rect`, `/AP` / `/AS` on-values, `NeedAppearances`, encryption with empty user password, XFA/hybrid forms, field/widget hierarchy). Engine changes are in scope when the research proves the engine's geometry/enumeration/classification is incomplete. No renderer-only cosmetic patch and no fallback column may stand in for a real field's own widget geometry.
3. **One authoritative surface per widget (carries Phase 65 rulings 3, 7, 8 forward).** A widget is drawn exactly once on screen: canvas paint OR overlay control, never both, and never neither. Read-only/on-canvas kinds keep the Phase 65 gate semantics; every kind pdf.js does not canvas-paint gets exactly one truthful overlay surface.
4. **Tick state is read from the document, not guessed.** A checked box/radio shows a tick iff the field `/V` and the widget `/AS` name the widget's non-Off on-state; a click toggles `/V` + `/AS` so the rendered state always matches the stored value after reopen. The on-value lookup must work for the real file's on-state names (which may differ from the synthetic `Yes`/`No` set).
5. **Complete coverage.** Enumeration parity holds on the real file: every field and every widget on a visible page yields exactly one control at its own `/Rect`; no field is dropped into a fallback column, none is duplicated, none is extra (orphan widgets keep their single `NonFillableView` surface per ADV-124).
6. **The operator's running build carries the fix.** Whether the operator's installed build predates the Phase 65 commit or the fix is genuinely insufficient, the phase is not done until a build that demonstrably contains the fix is produced and the operator can run it. Any push/tag/release still requires explicit operator authorisation in the session (PUSH GATE); a local build artefact is not enough on its own.
7. **No fill regression.** The Phase 59 native-fill path (field `/V`, regenerated widget appearances, fill report) stays exactly as it is; fill/save/reopen round-trips on the real file.

**Features**

**A. Characterisation of the real file (backend-dev).** A named, reproducible diagnostic enumerates `956.pdf` through the actual engine (`getFormFields`, `findOrphanWidgets`, `findFieldPage`) plus a raw pdf-lib walk: field count, widget count, per-kind and per-page distribution, per-field widget lists and `/Rect`s, `/P` presence and resolution, `/Ff` flags, `/V` and per-widget `/AS`/on-values, `/AP` presence, `NeedAppearances`, encryption dictionary (filter, empty-user-password), and any overlapping/duplicate rects. It records the exact list of fields that are layered, missing or mis-ticked today, and the root cause for each class. Findings are recorded in the child-issue thread before any fix brief is written.

**B. Single-surface field layer on the real file (frontend-dev; backend-dev where the root cause is enumeration/geometry).** No field appears twice on the operator's file: the canvas under a control paints no duplicate widget box, and every widget pdf.js does not canvas-paint has exactly one overlay surface.

**C. Correct tick boxes (backend-dev + frontend-dev).** A checked box/radio shows a tick that matches `/V` + `/AS`; clicking reliably toggles; the rendered state matches the stored value after a save/reopen; the checkbox on-value lookup is correct for the real file's naming.

**D. Complete, correctly-positioned coverage (backend-dev engine if required; frontend-dev).** Every widget of the real form is present, editable (or truthfully read-only), and positioned at its own mapped `/Rect`, at every zoom and page rotation.

**E. Real-file QA proof (qa).** A focused e2e/QA pass runs the running Electron build against the faithful copy (and the real file where the harness allows): per-page control-count vs engine widget-count parity, no duplicate surface (pixel/region sampling), checkbox state round-trip, geometry vs `/Rect` at 100% and non-100% zoom, plus screenshots inspected.

**F. Running-build parity and packaging (git-agent / backend-dev).** Confirm which version the operator runs; ensure the fix is present in the built artefact the operator can install (installer + portable still build and launch). Push/tag/release only on explicit operator authorisation.

**Current-scope supersession:** this phase supersedes the Phase 65 verification premise that an anonymised synthetic fixture is sufficient evidence for the operator's encrypted-form complaint. It does not otherwise change Phase 65's rendering rules (rulings 3, 7, 8 and the single suppression gate), the Phase 59 fill path, or any other phase.

**Success criteria**

1. On the faithful copy of the operator's `956.pdf`, no layered / duplicate field boxes exist anywhere: for each widget region on a visible page the pixel area shows exactly one surface, and the canvas paints no duplicate field box under an overlay control (before/after screenshots on the real-file copy).
2. Every widget type on the real file renders correctly: text, checkbox, radio, dropdown, listbox, signature and push button each show exactly one truthful surface.
3. Tick boxes are visually and functionally correct on the real file: a checked box/radio shows a tick, clicking toggles it reliably, and the rendered state always matches the underlying `/V` + widget `/AS` after a save/reopen (no "incorrect tick box").
4. Complete coverage on the real file: the number of interactive surfaces on each page equals the number of widget boxes the engine reports for that page; no widget missing, none extra, none stacked into a fallback column; multi-widget groups render one surface per widget.
5. Geometry parity on the real file: each control's measured box equals its widget `/Rect` mapped through page scale within tolerance, at 100% and at a non-100% zoom, including a rotated page.
6. No fill regression on the real file: editing a control fills the field, a save/reopen shows the value from the field `/V` (independent-reader evidence), and the Phase 59 fill report still fires.
7. No visual regression: non-form annotations still paint, read-only and signature fields render truthfully, text selection/search still works (blast-radius checks on the rebuilt specs).
8. The result is demonstrably visible in the build the operator actually runs; if the installed build did not carry the Phase 65 fix, the gap is named and the fixed build is produced.
9. `npm run verify` (conventions + typecheck) is green and the phase's targeted unit/e2e specs pass; the installer and portable still build and launch.
10. All DEF / ADV entries opened by this phase are CLOSED or REJECTED with a written reason; the phase-close commit stages every Phase 74 change as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** no new interactive control is introduced. The controls are the existing `FormsOverlay` editors (`.form-editor`, `.form-checkbox`, `.form-radio`, `.form-select`, `.form-listbox`) and their promised actions are unchanged from Phase 59/65 - this phase changes enumeration, placement and tick fidelity. The per-kind e2e proof is the control-count/geometry/state assertions in criteria 2-5 on the real-file copy.

**Settings impact:** none - no new `AppSettings` field. Any engine change is limited to field/widget data already carried by `FormField` / `FormFieldWidget` in `src/shared/`; a non-breaking optional flag is permitted only if the research proves it necessary (as with `pushButton` in Phase 65) and must be recorded here before the renderer consumes it.

## Phase 75 — Dock/App-home edit mode: remove the entry vibration, add a continuous iOS-style jiggle (operator correction via TFL-205 / TFL-228, 2026-10-02)

**Operator request (verbatim, TFL-228):** "On both the dock and the App home page, entering edit mode must feel like iOS. The icon 'vibration' currently played when the edit icon is clicked is removed, and while edit mode is active the icons continuously animate with the iOS-style jiggle/wiggle. The animation runs for as long as edit mode is active and stops cleanly on exit."

**Relationship to Phase 58 / Phase 63.** Phase 58 feature C built the dock pen and gave EDIT-mode entry a one-shot `anim-vibrate` shake on the dock ROOT (`ActionDock.tsx`), and feature D did the same on the home tool row (`Welcome.tsx`). Phase 63 restyled the pen's colour only. This phase removes the entry shake entirely and replaces it with a continuous per-icon jiggle that lasts the whole time EDIT mode is active. Curation (minus/plus), persistence (`dockPins` / `dockUnpinned` / `homeTools`), the animated resize, the pen identity and every other Phase 58/63 behaviour are unchanged.

**Features**

**A. Remove the entry vibration (frontend-dev).** Drop the `anim-vibrate` class from the dock root (`ActionDock.tsx`) and the home row (`Welcome.tsx`) so entering EDIT mode is not itself a shake. The `tf-anim-vibrate` keyframes and `.anim-vibrate` utility (and every reduced-motion / Animations-OFF reference to it) are removed as dead code.

**B. Continuous per-icon iOS jiggle (frontend-dev).** While EDIT mode is active, each curated icon jiggles continuously: a small rotation plus translation wobble, transform-only (no layout shift), on the edit-mode surface only, using the centralized motion system. The jiggle is desynchronised per icon (a deterministic per-icon phase offset), never in lockstep. It runs for the full duration of EDIT mode and stops cleanly on exit, returning each icon to its exact resting transform. It covers both the dock verbs and the home tool tiles consistently. The controls (pen, plus) are not icons being curated and do not jiggle.

**C. Motion gating (frontend-dev).** The jiggle obeys the existing `prefers-reduced-motion` catch-all and the `data-animations="off"` (Phase 23) gate: with either set, no jiggle is painted and EDIT mode still functions (minus/plus curation). The removed vibration stays removed under both.

**D. Focused QA (qa).** Repointed unit + e2e oracles prove: no entry vibration, a running per-icon jiggle while EDIT mode is active, per-icon desync, clean stop and exact resting transform on exit, parity on dock and home, no layout shift / dropped clicks, reduced-motion + Animations-OFF no-jiggle, and a coarse frame-rate sanity check.

**E. Adversarial diff-pass (adversary).** A read-only adversarial pass over the phase diff attacks the interaction edges: enter/exit flapping, clicking a jiggling icon (tool still runs), the plus/minus while jiggling, reduced-motion, and Escape-to-exit.

**Current-scope supersession:** this phase supersedes ONLY the Phase 58 EDIT-mode entry "vibration animation" - feature C ("the dock plays a short vibration animation", `REQUIREMENTS.md` Phase 58 line 3530), feature D ("the same vibration / minus / plus interaction", line 3544), success criterion 9 ("enters edit mode with the vibration animation", line 3576) and success criterion 11 ("enters edit mode with the same interaction", line 3581) - the entry shake is replaced by the continuous per-icon jiggle described here. It does NOT change the minus/plus curation, the persistence lists, the animated resize, the pen's identity/colour (Phase 63), or any other phase. The oracles `test/unit/renderer/phase58DockEdit.test.tsx`, `test/unit/renderer/phase58HomeTools.test.tsx`, `e2e/phase58_dock_edit.spec.cjs` and `e2e/phase58_home_tools.spec.cjs` are repointed by frontend-dev / qa from the entry vibration to the jiggle contract.

**Success criteria**

1. Clicking the edit icon no longer plays the current vibration/shake animation; entering EDIT mode is not itself an animated shake (computed `animation-name` on the dock root and home row carries no vibrate keyframe).
2. While dock / App-home EDIT mode is active, the curated icons animate with an iOS-like jiggle: a small, continuous rotation + translation wobble (measured computed `animation-name` / transform change over time on each icon).
3. The wobble is desynchronised across icons - each has its own phase/offset, so at any instant they are not all at the same pose (sampled per-icon transforms differ at a fixed timestamp).
4. The animation continues for the full duration of EDIT mode and stops immediately and cleanly on exit; each icon returns exactly to its resting transform (post-exit computed transform equals the pre-entry/resting value, no residual offset).
5. Behaviour is consistent on both the dock and the App home page (same jiggle contract proven on both surfaces).
6. No layout shift (icon/getBoundingClientRect positions unchanged by the jiggle), no dropped or blocked clicks on icons/controls (a click on a jiggling icon still runs the tool; minus/plus still fire), and no measurable frame-rate regression while EDIT mode is active.
7. Respects `prefers-reduced-motion`: with it set, icons do not jiggle (and the removed vibration stays removed), while EDIT mode still functions. The `data-animations="off"` gate behaves the same.
8. The motion is modelled on iOS icon edit-mode jiggle behaviour; the behavioural reference used (timing/amplitude/rotation) is cited in the phase evidence.
9. `npm run verify` (conventions + typecheck) is green and the phase's targeted unit/e2e specs pass; the installer and portable still build and launch.
10. All DEF / ADV entries opened by this phase are CLOSED or REJECTED with a written reason; the phase-close commit stages every Phase 75 change as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** no new interactive control is introduced. The controls are the existing dock pen `[data-dock-edit-toggle]`, dock minus/plus (`[data-dock-minus]`, `[data-dock-plus]`) and home pen/minus/plus (`[data-home-edit-toggle]`, `[data-home-minus]`, `[data-home-plus]`); their promised actions are unchanged from Phase 58/63 and remain proven by the repointed Phase 58 e2e specs. This phase changes only the EDIT-mode motion.

**Settings impact:** none - no new `AppSettings` field. The jiggle is renderer-only and gated by the existing `animationsEnabled` setting (via `data-animations`) and `prefers-reduced-motion`; no `src/shared/` type changes.

## Phase 76 — Opaque tab colours across all themes (operator request via TFL-208 / TFL-233, 2026-10-02)

**Operator request (verbatim, TFL-208):** "The tab color looks like, the color is transparent and is on top of a background. Remove the transparency, so it looks good on every theme."

**Relationship to Phase 45 / 51 / 68 / 72.** Phase 45 gave each tab its own palette hue; Phase 51 made the `standard` tab body the full-strength semantic token; Phase 68 calmed the `colorful` body to a flat tint mixed into `--bg-elevated`; Phase 72 brightened that tint to 22% inactive / 41% active and retired the identity chip. In the default `frosted` theme `--bg-elevated` resolves to `rgba(255, 255, 255, 0.93)`, so the `colorful` tab body (`.tab::before`) and its 1px border (mixed with the alpha-bearing `--border-subtle`) carry alpha and let the app header show through. This phase removes that alpha in every theme while keeping the Phase 68/72 tint percentages and `--fg-strong` ink; the `standard` style is already opaque and is left untouched.

**Features**

**A. Opaque colorful tab fill (frontend-dev).** The `colorful` tab body (`.tab-area[data-tab-style="colorful"] .tab::before`) and its active 41% variant (`.tab-active::before`) mix the tab's palette hue into a new, fully opaque per-theme token `--tf-tab-surface` instead of `--bg-elevated`, so the computed `background-color` alpha is exactly 1 in light, dark and frosted. The 22% / 41% mix percentages and the flat-fill shape are unchanged.

**B. Opaque colorful tab border (frontend-dev).** The 1px `::before` border's mix base is the same opaque `--tf-tab-surface` token instead of the alpha-bearing `--border-subtle`, so the border color alpha is exactly 1 too.

**C. Focused QA (qa).** A rendered computed-style e2e proves alpha === 1 for the inactive and active `::before` background and border in light, dark and frosted, captures screenshots in all three themes, and sweeps the tab shape / label / hover / active / click regression surface.

**D. Adversarial diff-pass (adversary).** A read-only adversarial pass over the phase diff attacks the alpha claim: theme flapping, the active/inactive tint relationship, nested translucency (a tab over a translucent header over a wallpaper), and the border edge.

**Current-scope supersession:** this phase supersedes ONLY the Phase 68 (ruling 2) / Phase 72 (item 6) `colorful` tab FILL BASE (`color-mix(..., var(--bg-elevated))`) and the Phase 72 (item 5) `colorful` body BORDER base (`color-mix(..., var(--border-subtle))`). The 22% inactive / 41% active mix PERCENTAGES, the `--fg-strong` ink (Phase 68 ruling 3), the Phase 62/72 silhouette (26px, uniform radius, active flush with the canvas), the Phase 45 palette assignment, the `standard` style, and every tab behaviour remain in force. The oracle `test/unit/renderer/phase68TabRestyle.test.tsx` (its two fill/border string assertions) is repointed by frontend-dev; the e2e `e2e/phase58_tab_style.spec.cjs` (the active-vs-inactive `::before` comparison) stays green under the new base.

**Success criteria**

1. In all three supported themes (light, dark and frosted) the computed `background-color` alpha of every colorful tab's `::before` is exactly 1, for both inactive and active tabs.
2. In all three themes the computed `border-*-color` alpha of the colorful tab's `::before` is exactly 1.
3. The Phase 68/72 tint relationship is preserved: the active fill differs from the inactive fill, and the `--fg-strong` label clears the 4.5:1 text floor against the fill in all three themes.
4. A screenshot in the running app on the default `frosted` theme (plus light and dark) shows a solid tab fill with no app background showing through.
5. No regression to tab shape, label, hover/active state or click behaviour; the Phase 58/59/60/61/62 tab specs stay green.
6. `npm run verify` (conventions + typecheck) is green and the targeted tab unit suites pass.
7. All DEF / ADV entries opened by this phase are CLOSED or REJECTED with a written reason; the phase-close commit stages every Phase 76 change as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** none - no new interactive control is introduced. The changed surface is the existing `.tab` (`[data-tab-id]`, `role="tab"`); every tab action (mousedown activation, close, reorder, tear-out, overflow) is unchanged and remains proven by the Phase 58/59/60/61/62 specs.

**Settings impact:** none - no new `AppSettings` field. This is a renderer-only styling change (`src/renderer/styles.css` plus its repointed unit oracle); no IPC or `src/shared/` change.

## Phase 77 — Book View correction: page-flip quality, spread-aware current-page indicator and mode transitions (TFL-238 issue label "Phase 75"; operator correction via TFL-183, 2026-10-02)

**Operator request (verbatim, TFL-183 items 2-6):** "2. Activating book view doesn't have any animation. 3. There's no current page number shown. 4. The single page flip animation looks very laggy and opposite. 5. Single to double page transition doesn't have any animation. 6. Double page flip doesn't look like a page flip on a real book. The page is flipping outside of the canvas."

**Relationship to Phase 66 / TFL-237.** Phase 66 ([TFL-90](/TFL/issues/TFL-90), chunks TFL-122 / TFL-131) built the baseline Book View: an in-canvas read-only shell over the existing `PageView`, a double spread with a centre crease, a CSS 3D `rotateY` page turn and a single/double toggle (`src/renderer/components/BookView.tsx`, `src/renderer/styles.css:18441-18703`). TFL-237 ([TFL-237](/TFL/issues/TFL-237)) recorded how industry-standard readers implement book view, page-flip and spreads and identified the code-grounded deviations: the forward turn hinges the right page on its FREE edge instead of the spine (`.book-view-turn-next { transform-origin: right center; rotateY -180 }`, `styles.css:18599-18616`), there is no back-face content, the turning unit is the already-advanced page rather than the outgoing leaf, the stage (`overflow: auto`, `styles.css:18514`) does not clip the leaf, the progress label is not spread-aware (`BookView.tsx:350-352`), and the mode swap is instant (`chooseLayout`, `BookView.tsx:270-273`). This phase corrects the mechanics on those findings. The Phase 66 read-only shell, annotation marking, entry control and panel restoration are unchanged.

**Features**

**A. Spine-hinged two-face page turn (frontend-dev).** The forward turn is a single leaf hinged at the spine (centre fold) of the spread, not the free edge: the front face carries the OUTGOING page and the back face carries the INCOMING page, with `backface-visibility` so the reverse of the flip shows the incoming page, never a mirror of the outgoing one. Direction is correct for LTR: a next turn swings the right page inboard across the spine (hinge on its left/spine edge); a back turn swings the left page inboard (hinge on its right/spine edge). Single-page mode mirrors the same inboard motion. The turn remains transform-only CSS 3D over the existing `PageView` canvas with no WebGL/3D dependency and no recolour of the page bitmap.

**B. Bounded flip (frontend-dev).** While a turn is in flight the leaf is clipped to the spread/book rect and the stage cannot scroll under it, so no part of the turning page renders or flips outside the canvas bounds at any point in the animation.

**C. Deliberate entry animation (frontend-dev).** Entering Book View plays a short one-shot entry animation (a settle, not an instant swap) driven by the centralized motion tokens; `prefers-reduced-motion` and `:root[data-animations="off"]` collapse it to an instant entry.

**D. Animated single/double (portrait/spread) transition (frontend-dev).** Toggling single/double plays a bounded animated transition (cross-fade and/or scale on the container over the layout motion token) with the current page anchored as the left page of the new spread; reduced motion collapses it to instant. The spread is not folded page-by-page.

**E. Spread-aware current-page indicator (frontend-dev).** The header progress label shows the visible page or pages: single mode "Page N of T"; double mode "Page N-M of T" for the visible pair (M = min(N+1, T), clamped at the last page); empty document keeps "No pages". The label is a readable fixed-chrome element (existing `[data-book-progress]`).

**F. Focused QA (qa).** A focused render/frame-time pass proves each corrected behaviour on the running build with named assertions and screenshots: entry animation vs instant, spread-aware label in both modes, flip direction (hinge/spine side and outgoing front page), flip frame-time budget, clipped bounds throughout the turn, animated mode transition, and no regression of the Phase 66 shell / annotation / reduced-motion paths.

**G. Adversarial diff-pass (adversary).** A read-only adversarial pass over the phase diff attacks the motion/bounds edges: rapid repeat turns, turning at the first/last spread, turning while the stage is scrolled or zoomed, toggling layout mid-turn, reduced motion, single-page flips at both ends, and annotation clicks not turning the page.

**Current-scope supersession:** this phase supersedes ONLY the Phase 66 page-turn keyframe/origin pair (`styles.css:18599-18625`), the instant `chooseLayout` swap and the non-spread-aware progress label (`BookView.tsx:270-273`, `350-352`). It does NOT change the Phase 66 rulings 1-6 (same window, one entry, read-only, reuse `PageView`/annotation engine, motion-tokens-only, no EPUB/comic regression), the entry control, panel restoration or annotation marking. Oracles repointed: `test/unit/renderer/bookViewSpread.test.tsx` and `test/unit/renderer/bookView.test.tsx` (frontend-dev); `e2e/phase66_bookview_spread.spec.cjs` plus the new phase spec (qa, who owns `e2e/`).

**Success criteria**

1. Research input incorporated: the TFL-237 findings (spine-hinged two-face leaf, correct LTR handedness, clip to the spread rect, spread-aware indicator, animated entry/mode) inform the implementation; the mechanism is named in the phase evidence.
2. Entering Book View plays a deliberate animation rather than an instant swap (a non-none `animation-name` with a positive duration on `[data-book-view]` in the running app; instant under `prefers-reduced-motion` / `data-animations="off"`).
3. A current page number is shown while reading and is spread-aware where two pages are visible: single "Page N of T", double "Page N-M of T" (before/after screenshots).
4. The single-page flip animates smoothly with no visible lag (frame-time budget met, matching the existing phase-66 turn measurement) and turns in the correct direction (single-mode next hinges inboard at the spine; the outgoing page is the one that leaves).
5. The single<->double (portrait<->spread) mode transition is animated (a non-none animation with a positive duration on the container; instant under reduced motion), with the current page anchored across the toggle.
6. The double-page flip reads as a real book page turn: the leaf is hinged at the spine, carries the outgoing page on its front and the incoming page on its back, and the flipping page never renders/flips outside the canvas bounds during the turn (screen recording or per-frame bounds check + screenshots).
7. `npm run verify` (conventions + typecheck) is green and the phase's targeted unit/e2e specs pass; the installer and portable still build and launch.
8. All DEF / ADV entries opened by this phase are CLOSED or REJECTED with a written reason; the phase-close commit stages every Phase 77 change as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** no new interactive control is introduced. The changed surfaces are the existing page-click surfaces `[data-book-page-side="single"|"left"|"right"]` (their promised action is unchanged - turn the spread - but the turn now animates correctly), the existing single/double toggle pair `[aria-label="Book single page"]` / `[aria-label="Book double page"]` (the mode swap now animates), and the existing progress label `[data-book-progress]` (now spread-aware). New stable test hooks for QA: during a turn `[data-book-turn]` with `data-book-turn-dir="next"|"prev"`, carrying `[data-book-turn-front="<page>"]` and `[data-book-turn-back="<page>"]`; a one-shot `book-view-enter` animation on `[data-book-view]`; a transient `book-view-relayout` animation on the spread/stage on a mode toggle.

**Settings impact:** none - no new `AppSettings` field. The entry animation, mode transition, indicator and flip are renderer-only and gated by the existing `animationsEnabled` setting (via `data-animations`) and `prefers-reduced-motion`; no IPC or `src/shared/` type change.

## Phase 78 - Information message: the top-of-canvas notices render inside the canvas, anchored at the top-right beside Book View (operator request via TFL-187, 2026-10-01)

**Operator request (verbatim, TFL-187):** "The information message task you done earlier was mostly correct. However, the message shouldn't show up outside of the canvas. The message should be in rounded, slightly transparent box within the canvas. The appearing animation should work like this. The "i" icon appears on the top right (on the left of book view icon. Don't leave too much space between these icons), and immediately the "i" icon expands into the message box smoothly. After 10 seconds, it will collapse into the "i" icon."

**Resolved placement decision (operator confirmed 2026-10-01 via question card, answer option `move_book_view`):** MOVE the Book View control to the canvas TOP-RIGHT, then place the information "i" icon immediately to its LEFT with tight spacing. Book View is currently at the canvas top-left (`.canvas-book-view { left: 12px }`, `styles.css:18689`).

**Relationship to Phase 59 feature B / TFL-46 and Phase 67 / TFL-104.** TFL-46 gave the document-protection notice (`ProtectionNotice`) the collapse-to-"i" behaviour; TFL-104 / Phase 67 extended the SAME behaviour to `ConversionNotice` (Phase 53) and `Pdf3dNotice` (Phase 57) through the shared `useNoticeCollapse` hook. Those notices are FLOW elements in the pane's `.document-column` ABOVE the canvas (`App.tsx` `DocumentSurfaceColumn:604-658`), and their collapsed "i" sits at the canvas TOP-LEFT (`.protection-notice-collapsed-toggle`, `.conversion-notice-collapsed-toggle`, `.pdf3d-notice-collapsed-toggle`). This phase moves the whole notice PRESENTATION inside the canvas and moves the collapsed "i" row to the TOP-RIGHT immediately left of Book View. The operator's "information message" is the TFL-104 notice family ("all the messages that appear on the top after opening certain files").

**CTO RULINGS:**

1. **Scope is the open-triggered top-of-canvas notice family built by TFL-46 + TFL-104:** `ProtectionNotice` (Phase 59), `ConversionNotice` (Phase 53) and `Pdf3dNotice` (Phase 57). `ValidationNotice` stays OUT (Phase 67 ruling 2: not produced by opening a file); `Toasts` (bottom-right) and `ExportPagesWithoutTextNotice` (inside export dialogs) are untouched. Their copy, information content and state-machine semantics are unchanged; only the presentation location and enter sequence change.
2. **The notices are RE-PARENTED into the canvas-bound overlay** `.canvas-overlay` (`DocumentView.tsx:4303`), the same coordinate system as the Book View entry and the page-layout control. No notice box or collapsed icon may remain a flow sibling above the `.document-scroller` inside `.document-column`. This is what guarantees "never outside the canvas bounds" and consumes the open Inspector inset (`--tf-tools-inset`) automatically.
3. **Book View control moves to the canvas top-right, immediately LEFT of the page-layout control** (`.canvas-page-layout { right: 12px }`, `styles.css:15924`). The collapsed notice "i" row sits immediately LEFT of Book View with minimal spacing. Right-to-left order at the top-right: page-layout control, Book View, then the notice icons. The page-layout control keeps its current position.
4. **The enter sequence gains a morph.** On appear the collapsed "i" is rendered FIRST, then immediately transitions (morph/scale from the icon) into the fully expanded message box. After the existing ~10 s dwell the box collapses smoothly back into the "i"; the dwell resets on every user expand. The `useNoticeCollapse` semantics (`expanded | closing | collapsed`, `NOTICE_AUTO_COLLAPSE_MS = 10000`, instant path under reduced motion / Animations OFF) are preserved; the morph is an added enter leg on top of that machine.
5. **No regression to Phase 67 ruling 6 / criteria 3-4 or DEF-447.** When more than one notice is collapsed at once the "i" icons lay out in a row, non-overlapping, and no icon covers a canvas control (Book View, the page-layout control) or the page; each icon centre hit-resolves to the icon. The row now yields from the RIGHT instead of the left.
6. **Motion tokens only** (`src/renderer/hooks/motionTokens.ts`, `styles/animations.css`); the "slightly transparent" box uses the existing surface/glass tokens (`--bg-elevated` / `--glass-*` / `backdrop-filter`), never a hardcoded colour. Same timing in every theme.
7. **Hooks preserved.** The existing `role` / `aria-label` / `data-*` hooks stay: `[data-protection-notice]`, `[data-protection-collapse]`, `[data-protection-icon]`, `[data-conversion-notice]`, `[data-conversion-collapse]`, `[data-conversion-icon]`, `[data-pdf3d-notice]`, `[data-pdf3d-collapse]`, `[data-pdf3d-icon]`, `[data-book-view-open]`, `[data-canvas-overlay]`. Existing Phase 53/57/59/66/67 oracles are repointed where they asserted the old top-left / flow placement (qa owns `e2e/`).

**Features**

**A. Re-parent the notice family into the canvas overlay (frontend-dev).** `DocumentSurfaceColumn` stops rendering the notice boxes/regions above the canvas; the notices render inside `DocumentView`'s `.canvas-overlay` (a new optional prop carrying the notice elements, or an equivalent move of the mount). The notices share the canvas-bound overlay so their right edge respects `--tf-tools-inset` and they are clipped to the canvas. `.document-column` no longer reserves a notice row.

**B. Book View and the "i" row at the canvas top-right (frontend-dev).** `.canvas-book-view` moves from `left: 12px` to the right side immediately left of `.canvas-page-layout`. The collapsed notice "i" row (`[data-protection-icon]`, `[data-conversion-icon]`, `[data-pdf3d-icon]`) is pinned at the canvas top-right immediately left of Book View with tight spacing. Both use the same measured chrome top (`--tf-chrome-y`) and motion treatment as the existing canvas controls.

**C. In-canvas translucent rounded box and the enter morph (frontend-dev).** The expanded box is a rounded, slightly translucent surface anchored at the canvas top-right, inside the canvas, clipped to its bounds. On appear the "i" shows first and immediately expands (morph/scale from the icon origin) into the box; after the 10 s dwell it collapses back to the "i"; reduced motion / Animations OFF take the instant path with no morph.

**D. Focused QA (qa).** A focused render/geometry pass on the running build proves, per notice (`protection`, `conversion`, `3D`): the box renders inside `[data-canvas-overlay]` and never outside the canvas; Book View and the "i" are at the canvas top-right with a measured minimal gap; the enter morph plays icon -> box and the 10 s dwell collapses box -> icon; the multiple-collapsed-icon row is non-overlapping and hit-testable; and the Phase 67 / DEF-447 / reduced-motion paths are unregressed. Named screenshots + measured boxes + `elementFromPoint`.

**E. Adversarial diff-pass (adversary).** A read-only adversarial pass over the phase diff attacks the presentation edges: all three notices present at once, notice toggled while Book View is open/closed, window narrowed so the top-right cluster meets the pills/chrome, Inspector open (inset), Multi Mode pane, reduced motion, and rapid expand/collapse.

**Current-scope supersession:** this phase supersedes ONLY the Phase 67 collapsed-icon PLACEMENT (the canvas top-left "i" row) and the flow-above-canvas presentation of `ProtectionNotice` / `ConversionNotice` / `Pdf3dNotice` (Phase 59 feature B + Phase 67). It does NOT change their copy, information content, state-machine semantics (`useNoticeCollapse`), the instant path, the Phase 67 non-collision rule, the Phase 66 Book View shell, or the Phase 77 Book View corrections. Oracles repointed: `test/unit/renderer/tfl46_protectionIconLeftInset.test.ts`, the Phase 67 notice-collapse specs, and the Phase 53/57 notice e2e specs (qa owns `e2e/`).

**Success criteria**

1. Each of the three notices (`ProtectionNotice`, `ConversionNotice`, `Pdf3dNotice`) renders only within the canvas as a rounded, slightly translucent box; a geometry probe measures the expanded box inside the canvas bounds and `elementFromPoint`/screenshots show it never shows outside the canvas (per notice).
2. The Book View control sits at the canvas top-right immediately left of the page-layout control, and the notice "i" icon sits immediately left of Book View with a measured minimal gap (e.g. ~8px), at the geometry probe window 2048x1392 (measured boxes + screenshot).
3. On appear the "i" icon is shown then immediately expands smoothly into the full message box: a non-none enter animation with the collapsed icon as the morph origin; instant under `prefers-reduced-motion` / `data-animations="off"`.
4. After ~10 s (measured) the box collapses smoothly back into the "i" icon; the dwell resets on every expand; both legs take the instant path under reduced motion / Animations OFF.
5. No regression to Phase 67 (multiple collapsed icons non-overlapping, each icon centre hit-resolves to the icon, no icon covers a canvas control or the page) or the standing animation rules (TFL-189 / TFL-190); the Phase 53/57/59/66/67 targeted specs and the repointed oracles stay green.
6. `npm run verify` (conventions + typecheck) is green and the phase's targeted unit/e2e specs pass; the installer and portable still build and launch.
7. All DEF / ADV entries opened by this phase are CLOSED or REJECTED with a written reason; the phase-close commit stages every Phase 78 change as ONE local commit by git-agent, no push and no version bump.

**CONTROL-INDEX**

- `[data-protection-notice]` / `[data-conversion-notice]` / `[data-pdf3d-notice]` (expanded box) -> read the message; now inside the canvas -> criteria 1, 3.
- `[data-protection-icon]` / `[data-conversion-icon]` / `[data-pdf3d-icon]` (collapsed "i") -> expand the message; now at the canvas top-right, left of Book View -> criteria 2, 3.
- `[data-protection-collapse]` / `[data-conversion-collapse]` / `[data-pdf3d-collapse]` -> collapse the box back to the "i" -> criterion 4.
- `[data-book-view-open]` -> opens Book View; now at the canvas top-right -> criterion 2.
- `[data-page-layout-control]` -> single/two/four page layout; keeps its top-right anchor (the Book View / "i" cluster sits to its left) -> criterion 2.

**Settings impact:** none. No new `AppSettings` field; the presentation is renderer-only and rides the existing `animationsEnabled` setting (via `data-animations`), `prefers-reduced-motion`, the motion tokens and the existing surface/glass tokens. No IPC and no `src/shared/` type change.

## Phase 79 - App icon rendering across all Windows file views: native BMP-framed .ico set (operator request via TFL-184; commissioned as TFL-236, 2026-10-01)

**Operator request (verbatim, TFL-184):** "There are some file views that don't reflect the new icon. File views that still has the old icons are. 1. Extra large view has new icons but icons look stretched. 2. Same for large view. 3. Medium view has old icon. 4. Tiles view has old icon. 5. Content view doesn't show app icon."

**Relationship to Phase 49 (Jovrel icons) / Phase 70 (brand map) / DEF-452.** Phase 49 wired the Jovrel application icon and the `.pdf` file-type icon into `electron-builder.yml` (`icon: assets/brand/jovrel.ico`, `fileAssociations[pdf].icon: assets/brand/jovrel-pdf.ico`, `installerIcon`/`uninstallerIcon`). DEF-452 restored the `.ico` frame set for those files. The operator's report is about how Windows Explorer renders those shipped icons in its folder views (Extra large / Large / Medium / Tiles / Content).

**CTO RULINGS:**

1. **Scope is the Windows shell icon set and its packaging wiring** - the `.ico` files Explorer renders for the app executable and for `.pdf` files (`assets/brand/jovrel.ico`, `assets/brand/jovrel-pdf.ico`, and `assets/brand/favicon.ico`), plus the `electron-builder.yml` references. There is NO in-app renderer change; `src/renderer/components/BrandMark.tsx` (inline SVG) and every in-app brand surface are untouched.
2. **Confirmed structural root cause (CTO read the assets):** both `.ico` files currently embed a **PNG-compressed frame at EVERY size** (16/24/32/48/64/128/256, all PNG). Windows Explorer's folder-view icon paths do not use PNG frames below 256x256 (and scale/fall back for Large), which produces exactly the reported symptoms: stretched Extra-large/Large, stale Medium/Tiles, and a missing Content icon. The fix is a native **BMP/DIB (32-bit alpha) frame at every size <=128**, with 256 allowed to stay PNG (or BMP).
3. **Complete native frame set:** 16, 20, 24, 32, 40, 48, 64, 96, 128, 256 - each composed from the master brand art (`assets/brand/jovrel-mark.svg` / `jovrel-mark-1024.png`, and the PDF-file master) at its NATIVE size, square, correct aspect ratio, so no Explorer view ever upscales or stretches.
4. **Stale-icon cache is expected on an existing install.** The phase supplies the corrected files and, for the operator's post-install verification, an icon-cache refresh step; the icon must be correct after a refresh/reinstall.
5. **No regression** to the views that already render correctly; Extra-large and Large must become correct, not merely move the defect.
6. The change is asset/packaging only: no motion, no UI, no settings, no network.

**Features**

**A. Regenerate the shipped icon set (backend-dev).** Rebuild `assets/brand/jovrel.ico`, `assets/brand/jovrel-pdf.ico` and `assets/brand/favicon.ico` with the complete native frame set (16/20/24/32/40/48/64/96/128/256); every frame <=128 is a 32-bit BMP/DIB with alpha (NOT PNG); 256 may be PNG or BMP. Each frame is the master art rendered at that native size, square and undistorted. Add/refresh the asset generator (or a committed script) so the set is reproducible.

**B. Packaging wiring (backend-dev).** Confirm `electron-builder.yml` points at the regenerated files (`icon`, `fileAssociations[pdf].icon`, `installerIcon`, `uninstallerIcon`) and that `npm run dist` embeds the corrected icon in the executable, the installer and the portable.

**C. Focused QA (qa).** Prove the fix: a structural `.ico` parse (every native size present; no PNG frame <=128); a per-frame render compared to the master (no distortion/stretch); and Windows Explorer screenshots at Extra large / Large / Medium / Tiles / Content on a rebuilt build after an icon-cache refresh, plus a no-regression check.

**D. Adversarial diff-pass (adversary).** Attack the icon set and its wiring: a missing/duplicate frame size, a non-square or padded frame, a PNG frame <=128, a wrong directory/byte-order entry, an alpha artifact, a per-association icon mismatch (app vs `.pdf`), and installed-vs-portable icon differences; file ADV entries for confirmed breaks.

**Current-scope supersession:** this phase supersedes ONLY the `.ico` frame-set encoding/output left by Phase 49 / DEF-452 (the "16-256 frame set" is extended to the complete native set with BMP frames <=128). It does not change the brand artwork, the in-app `BrandMark`, the window/taskbar icon path, or any renderer surface.

**Success criteria**

1. Extra large (256) renders the new icon without stretching or distortion.
2. Large (96/128) renders the new icon without stretching or distortion.
3. Medium (48) shows the new icon.
4. Tiles (48) shows the new icon.
5. Content (32) shows the app icon.
6. No regression in the views that already rendered the new icon correctly.
7. Structural evidence (every native frame present; BMP encoding for <=128; square/undistorted per-frame render vs master) plus Windows Explorer screenshots per view; `npm run dist` builds with the corrected icon; all DEF/ADV opened by the phase are CLOSED or REJECTED; the phase-close commit stages every Phase 79 change as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** none - no interactive control is introduced. The changed surface is a set of shipped icon assets (`assets/brand/*.ico`) and their `electron-builder.yml` references.

**Settings impact:** none - no new `AppSettings` field. This is an asset/packaging change (`assets/brand/*.ico` + `electron-builder.yml`); no renderer, IPC or `src/shared/` change.

## Phase 80 - Format Painter: apply one text object's formatting to another (FEA-012, commissioned via TFL-315 / TFL-316, 2026-10-02)

**Operator request (product terms, TFL-316):** give TFlex users a Format Painter - select a text object, pick up its formatting (the Phase-21 FORMAT TEXT set: font family, size, colour, bold/italic/underline, alignment, line spacing, list style), and apply that combination to another text object in one action. Offline only.

**Relationship to Phase 21 (docked FORMAT TEXT panel) / Phase 27 (character spacing) / FEA-012.** Phase 21 shipped the docked text-properties panel and its full control set; Phase 27 made character spacing live (the engine now emits the `Tc` operator), leaving horizontal scaling as the only disabled-with-tooltip control (no `Tz` operator). FEA-012 identified re-applying a font/colour/size combination to many objects as the most common bulk action once the panel exists. This phase adds the Word "Format Painter" affordance on top of the existing style-application path; it adds no new engine capability.

**CTO RULINGS:**

1. **Scope is the renderer's text-format application path only.** The feature captures a selected text object's panel values and re-applies them to another text object through the SAME engine style route the panel controls already use (text box -> `updateTextBox` patch; text annotation -> `editAnnotation` `style` payload). No new engine op, no new IPC channel, no `src/shared/` change, no settings field, no network.
2. **The painter's home is the docked FORMAT TEXT panel** (`src/renderer/edit/TextPropertiesPanel.tsx`), the accepted natural home per FEA-012. It is one new button in the panel's Font group; no dock verb, no toolbar change, no new panel.
3. **Source is any current panel text target** (committed text box, text annotation, or edited text run) - its full panel value set is captured. **Target is a committed text box or a text annotation**, the two object kinds whose style the engine persists in place. A raw text run is NOT an applicable target (applying to it would mean re-baking the run through `editTextRun`); a run selected while the painter is armed must fail loud with a visible hint, never silently no-op.
4. **The captured format is exactly the engine-honoured set:** font family, size, colour, bold, italic, underline, alignment, line spacing, list style, highlight, baseline shift (super/sub), indent, and character spacing. Horizontal scaling is NOT part of the captured format and its panel control stays disabled-with-tooltip exactly as today (the engine has no `Tz` operator). The painter must never attempt an operator the engine cannot honour.
5. **Single-shot, one undo step.** The painter arms on click, applies on the next applicable text-object selection as ONE style write (one undo entry), then disarms. It never applies to the object it was picked up from (a same-target selection is not a new target).
6. **No regression** to text edit, save/export, settings persistence, or the Phase-21 panel behaviour; the feature is fully offline.

**Features**

**A. Format Painter control in the FORMAT TEXT panel (frontend-dev).** Add one button to the Font group of `TextPropertiesPanel.tsx`, test hook `[data-txt-format-painter]`, `aria-label="Format Painter"`, `aria-pressed` reflecting armed state, paintbrush icon from the existing lucide icon set, tooltip explaining pick-up then apply. The control is disabled-with-tooltip when no text source is currently selected (nothing to pick up). Clicking it captures the current selection's full value set (via the existing `valuesToPatch` from `textStyle.ts`) and arms the painter.

**B. Apply to target in one action (frontend-dev).** While armed, the next committed text box or text annotation the user selects receives the captured format as ONE style application through the same host route the panel controls use (`DocumentView.handleTextPanelPatch`: box -> `edit.onTextStylePatch`; annotation -> `onEditAnnotation`), then the painter disarms. The applied change is a single undo step and uses the persisted style path, so it survives save/reload. The host (`DocumentView.tsx`) owns the armed state; the panel stays a pure controlled component.

**C. Fail-loud scope and state (frontend-dev).** While armed, selecting a non-applicable target (a raw text run, an image, a page) keeps the painter armed and shows a readable hint (test hook `[data-txt-format-painter-hint]`), never a silent no-op. Escape or a second click on the armed button cancels the painter. The armed state is reflected on the button (`aria-pressed`) and cleared when the document/tab closes.

**D. Focused QA + adversarial diff-pass (qa, adversary).** qa proves the feature end to end with a run that applies a source object's formatting to a target (font family, size, colour, bold/italic/underline, alignment, line spacing, list style), then saves and reloads and re-asserts the target's formatting; plus a no-silent-no-op check for a raw-run target and a no-regression check on text edit, save/export and settings persistence. The adversary runs a diff-pass on the format-apply path (a high-risk style-write merge): arming with no source, applying across pages/objects, undo/redo behaviour, the raw-run and image target cases, and the save/reload durability, filing ADV entries for confirmed breaks.

**Current-scope supersession:** none - this phase adds a new renderer affordance and changes no earlier phase's contract. It extends FEA-012 (previously PROPOSED) into a delivered feature and relies on the Phase-21/27 control set and engine paths unchanged.

**Success criteria**

1. With a text object selected, ONE click on `[data-txt-format-painter]` arms the painter and the button reflects the armed state (`aria-pressed`); with no text source selected the control is disabled-with-tooltip.
2. With the painter armed, selecting a second committed text box or text annotation applies the source object's formatting to it in ONE action (one undo step); the on-screen result and the panel's reflected values both show the applied format.
3. The applied formatting survives save + reload: qa applies the painter, saves, reopens, and re-asserts the target's font family, size, colour, bold/italic/underline, alignment, line spacing and list style against the source.
4. Horizontal scaling stays disabled-with-tooltip and is never part of the captured format; the painter never attempts an operator the engine cannot honour; a non-applicable target (raw text run) shows the visible hint `[data-txt-format-painter-hint]` instead of silently no-opping.
5. No regression to text edit, save/export, or settings persistence; offline-only preserved (no network call added).
6. Unit tests cover the capture (full value set -> patch), the arm/apply/disarm reducer or state transitions, and the non-applicable-target hint; e2e covers arm -> apply -> save/reload and the fail-loud target case.
7. All DEF/ADV opened by the phase are CLOSED or REJECTED; phase-close QA returns a verdict per criterion; the phase-close commit stages every Phase 80 change as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** one new control - `[data-txt-format-painter]` (button in the FORMAT TEXT panel Font group, `aria-pressed` armed state). Promised action: click picks up the selected text object's formatting (disabled-with-tooltip when no source is selected) and the next committed text box / text annotation selection applies it in one action; a non-applicable target shows `[data-txt-format-painter-hint]`. Proven by the Phase 80 e2e spec: arm -> apply to target -> assert target formatting equals source -> save/reload re-assert; plus the raw-run fail-loud case.

**Settings impact:** none - the picked-up format is session/UI state held in the renderer, not persisted; no new `AppSettings` field, no settings IPC, no `src/shared/` change.

## Phase 81 - Named print presets persisted across sessions (FEA-015, commissioned via TFL-315 / TFL-317, 2026-10-02)

**Operator request (product terms, TFL-317):** let TFlex users save the current print settings under a name and re-apply that named preset across app restarts (for example duplex + greyscale + fit), so a repeated print job does not re-enter the same controls every time. Offline only; no network feature.

**Relationship to Phase 30 (print with advanced options).** Phase 30 shipped the full option set and session-level presets, but declared `Settings impact: none`, and the session list did not survive the Phase 35/37 move to the standalone print window - there is no preset control in today's print surface at all. FEA-015 is the only print item that needs a persisted settings field. This phase adds named, persisted presets on top of the SAME `PrintSettings` shape Phase 30 defines; it adds no engine capability and no print-behaviour change.

**CTO RULINGS:**

1. **Scope is the shared contract, the main settings validator and the renderer print surface.** One new `AppSettings` field (`printPresets`), its preserve-if-valid / reject-if-invalid normalizer in `src/main/services/settings.ts`, and the preset controls in the standalone print window's shared surface (`PrintPanel.tsx` + `usePrintControls.ts`, hosted by `PrintWindowApp.tsx`). No new IPC channel (reuse `loadSettings` / `saveSettings`), no new window, no dock/toolbar verb, no Preferences entry, no engine op, no network.
2. **A preset snapshots the OPTION SET, not the printer.** `PrintPreset.settings` excludes `deviceName`: a printer is environment-specific and a preset that names a device which is gone would fight the existing printer fallback. Applying a preset never changes the selected printer. The snapshot is the option set Phase 30 defines (copies, collate, scaling + scalePercent, orientation, duplex, colour, pagesPerSheet, pageOrder, oddEven, reverse, printAnnotations).
3. **Capture and apply use the existing pure mappers.** Saving calls the same `buildPrintSettings(dialogState)` the print run uses, minus `deviceName`. Applying seeds the controls through `seedPrintDialogState` (the existing pure inverse), so capture and apply can never drift from the print path. Page range (`scope` / `customInput`) is per-document and is NOT part of a preset (Phase 30 deliberately leaves `pageRanges` unset).
4. **Persist through the Phase-6 preserve-if-valid pattern.** `src/shared/types.ts` gains `PrintPreset` and `AppSettings.printPresets?`. `src/main/services/settings.ts` gains `normalizePrintPresets` (a non-array rejects the field; each entry must be an object with a non-empty trimmed string name within `PRINT_PRESET_NAME_MAX` and a plain-object settings snapshot whose known keys survive per-key validation, unknown keys dropped), a cap (`PRINT_PRESETS_CAP`), and same-name upsert (a later entry with an existing name replaces the earlier one). A corrupt or oversized stored list can never fail the whole settings load.
5. **No silent no-op.** A save with an empty/whitespace name fails loud with an inline error (`[data-print-preset-error]`) and writes nothing. A save or delete that persists shows a readable status (`[data-print-preset-notice]`). The list is manageable: the selected preset can be deleted, also persisted.
6. **No regression** to the print option set, printing, settings persistence for other fields, or the offline-only rule.

**Features**

**A. Persisted print-preset contract + validation (backend-dev).** Add `PrintPreset` and `AppSettings.printPresets?` to `src/shared/types.ts`; add `PRINT_PRESETS_CAP`, `PRINT_PRESET_NAME_MAX`, `normalizePrintPresets`, and the `normalizeSettings` wiring to `src/main/services/settings.ts`. Unit tests cover preserve-if-valid, reject-if-invalid, per-key settings validation, the cap, same-name upsert and unknown-key dropping.

**B. Preset controls in the print surface (frontend-dev).** Add a preset picker, a name field, Save and Delete to `PrintPanel.tsx` (`[data-print-preset]`, `[data-print-preset-name]`, `[data-print-preset-save]`, `[data-print-preset-delete]`, `[data-print-preset-notice]`, `[data-print-preset-error]`). Extend `usePrintControls.ts` with preset state and actions, fed by injected `loadPresets` / `savePresets` seams; wire `PrintWindowApp.tsx` to the real `window.tflex.loadSettings` / `saveSettings` (read-modify-write the full settings object so other fields survive). Save snapshots the current dialog state via `buildPrintSettings` minus `deviceName`; apply re-seeds the controls via `seedPrintDialogState`; save and delete persist.

**C. Focused QA + adversarial diff-pass (qa, adversary).** qa proves save -> restart -> apply end to end in the standalone print window (duplex + greyscale + scaling survive a window close/reopen and re-apply to the controls), the empty-name fail-loud, and no-regression on printing and other settings fields. The adversary runs a diff-pass on the settings-persistence merge: corrupt/oversized/duplicate stored presets, a preset with invalid settings keys, applying while a print runs, and whether saving presets clobbers other settings fields.

**Current-scope supersession:** none - this phase extends FEA-015 (previously PROPOSED) into a delivered feature and relies on the Phase-30 `PrintSettings` shape and the Phase-35/37 print surface unchanged.

**Success criteria**

1. With the print surface open, saving the current option set under a name lists that preset immediately; reopening the print window (a fresh app session) still lists it and applying it re-seeds the option controls (duplex, greyscale, scaling and the rest) to the saved values.
2. The preset survives an app restart: qa saves a preset, closes the print window, reloads settings, and re-asserts the stored `printPresets` entry and the applied control values.
3. Settings persist and validate per the Phase-6 preserve-if-valid / reject-if-invalid pattern: a non-array `printPresets` rejects the field; an invalid entry is dropped; an invalid settings key is dropped; the list is capped; a corrupt list never fails the whole settings load. Unit tests cover each case.
4. No silent no-op: saving with an empty name shows `[data-print-preset-error]` and writes nothing; save/delete shows `[data-print-preset-notice]`; applying a preset always changes the visible controls.
5. No regression to the print option set, printing, settings persistence for other fields, or offline-only behaviour (no network call added).
6. Unit tests cover the capture (dialog state -> snapshot minus `deviceName`), the apply (snapshot -> seeded controls), the empty-name error and the validator; e2e covers save -> close -> reopen -> apply plus the empty-name case.
7. All DEF/ADV opened by the phase are CLOSED or REJECTED; phase-close QA returns a verdict per criterion; the phase-close commit stages every Phase 81 change as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** new controls in the print surface - `[data-print-preset]` (preset picker, lists saved names; selecting one applies it), `[data-print-preset-name]` (name field), `[data-print-preset-save]` (saves the current option set under the typed name; empty name -> `[data-print-preset-error]`), `[data-print-preset-delete]` (deletes the selected preset). Promised actions proven by the Phase 81 e2e spec: save -> assert the preset is listed and persisted; close/reopen -> assert it is still listed; apply -> assert the option controls change to the saved values; empty name -> assert the error and no write.

**Settings impact:** yes - a new `AppSettings.printPresets?: PrintPreset[]` field (`{ name: string; settings: PrintSettings }`), validated preserve-if-valid / reject-if-invalid in `src/main/services/settings.ts` (per-entry validation, same-name upsert, `PRINT_PRESETS_CAP`, `PRINT_PRESET_NAME_MAX`), persisted through the existing settings IPC (`loadSettings` / `saveSettings`) with no new channel. Offline only; no password or credential is ever stored.

## Phase 82 - Offline spell check inside the text-edit flow (FEA-013, commissioned via TFL-315 / TFL-343, 2026-10-02)

**Operator request (product terms, TFL-343):** while editing text in a PDF in TFlex, underline misspelled words and offer a suggestion list, backed by a dictionary bundled with the app. No network call at any point - the feature stays inside the v1 offline rule. Accepting a suggestion replaces the word in the edited content.

**Relationship to Phase 21 (docked FORMAT TEXT panel) / Phase 26 (panel Text field) / Phase 51 item 12 (on-canvas run editor).** The codebase treats `TextPropertiesPanel.tsx`'s `[data-txt-text]` textarea as "the single text-editing surface": text runs, text boxes and text annotations are all edited there, and the host commits ONE engine op per session on blur. Phase 51 item 12 added the on-canvas run editor (`[data-edit-run-editor]`), a second SURFACE of the SAME host text session (its keystrokes call the same `handlePanelTextChange`, its blur the same `commitTextSession`). FEA-013 identified spell check as part of Acrobat's add/edit-text flow. This phase decorates those two text surfaces with offline squiggles and a suggestion list; it adds no engine capability, no new document op and no network.

**CTO RULINGS:**

1. **Scope is the renderer's text-input surfaces plus one bundled dictionary and one persisted setting.** The feature wraps the existing textareas - the panel Text field (`[data-txt-text]`, `TextPropertiesPanel.tsx`) and the on-canvas run editor (`[data-edit-run-editor]`, `EditOverlay.tsx`) - in ONE reusable decoration wrapper, and adds a bundled dictionary asset with a main-process loader and one new read-only IPC channel. No engine op, no document mutation path change, no new window, no dock/toolbar verb, no network.
2. **The dictionary is bundled, offline and pure-JS.** A plain-text English word list ships as `assets/dictionary/en-us.txt` (one lowercase word per line, `#` comments, LF, UTF-8) under the existing `assets/**` packaging rule, with its provenance and licence recorded in `assets/dictionary/LICENSE.txt`. Main reads it from `app.getAppPath()/assets/dictionary/` exactly as `OcrService` reads `assets/tessdata` (`src/main/index.ts` constructs `new OcrService(join(app.getAppPath(), 'assets', 'tessdata'))`), exposed over a new IPC channel. NO new npm dependency: do not add `nspell`, `hunspell`, `typo-js`, `word-list` or any dictionary package - the list is a vendored asset.
3. **The pure spell algorithm lives in `src/shared/spell.ts`** (no DOM, no `fs`, no Electron imports) so it is unit-testable and coverage-counted. It exports: a tokenizer that returns `{ word, start, end }` offsets into the ORIGINAL string (so the mirror can underline ranges), `buildSpellDictionary(raw: string): Set<string>`, a miss test, and `suggestSpellCorrections`. Suggestions use a bounded Damerau-Levenshtein over candidates bucketed by first letter and length +/-2, capped at `SPELL_SUGGESTION_LIMIT` (5), skipping words longer than `SPELL_WORD_MAX` (48). Deterministic handling of digits, single letters, all-caps acronyms and apostrophes is documented in the module.
4. **The decoration wrapper is a reusable component applied to both text surfaces.** It keeps the existing `<textarea>` as the input element (never replaces it with `contentEditable`, so caret/IME/session behaviour is untouched) and paints a pointer-transparent mirror layer behind it with `text-decoration: underline` spans for misspelled ranges, mirrored from `getComputedStyle(textarea)` font metrics and synced on input, scroll and resize. Typing must never block: tokenise+check is debounced (120-200 ms idle) and the dictionary is compiled to a `Set` once and cached for the session. Accepting a suggestion replaces the token in the value and calls the SAME `onChange` the textarea already calls, so the host session and the single-commit-on-blur path are unchanged.
5. **Suggestions are offered by right-click (contextmenu) on the textarea**, resolving the word under the pointer via a caret-from-point lookup with the textarea's `selectionStart` as fallback; if the word under the pointer is not misspelled the popover does not open (never a blank popover). The popover is anchored to the misspelled range and lists at most `SPELL_SUGGESTION_LIMIT` items.
6. **One new persisted setting, Phase-6 pattern.** `AppSettings.spellCheck?: { enabled: boolean; language: SpellCheckLanguage }` with `SpellCheckLanguage = 'en-US'` (allowlist; one dictionary bundled this phase), consumer default `{ enabled: true, language: 'en-US' }`. `src/main/services/settings.ts` gains `normalizeSpellCheck` (non-object rejects the field; a non-boolean `enabled` falls back to the default; a `language` outside the allowlist is dropped to the default) - preserve-if-valid / reject-if-invalid. The only new control is the enable toggle; a one-option language picker is NOT shipped (it would be a no-op control) - the validated field exists so a future dictionary plugs in without a schema change.
7. **Fail-loud, no silent no-op.** If the dictionary load fails, the panel shows a readable inline status (`[data-spell-status]`) and no underlines; it is never blank. With spell check disabled the status reads off and no squiggles are drawn. The toggle always changes a real, persisted state.
8. **No regression** to the text-edit session (keystroke routing, blur commit, run/annotation/text-box targets), save/export, settings persistence for other fields, or the offline-only rule.

**Features**

**A. Shared spell contract, pure algorithm + bundled dictionary (backend-dev).** Add `SpellCheckLanguage`, `SpellCheckSettings` and `AppSettings.spellCheck?` to `src/shared/types.ts`; add `src/shared/spell.ts` with the tokenizer-with-offsets, `buildSpellDictionary`, the miss test and `suggestSpellCorrections` (bounded Damerau-Levenshtein, `SPELL_SUGGESTION_LIMIT`, `SPELL_WORD_MAX`); vendor `assets/dictionary/en-us.txt` plus `assets/dictionary/LICENSE.txt`. Unit tests cover tokenizer offsets (words, apostrophes, digits, punctuation), `buildSpellDictionary` (comments/blank lines/lowercasing), the miss test (known word passes, misspelling fails, short/acronym/digit rules) and suggestions (known correction ranked first, deterministic ordering, cap and length bound).

**B. Dictionary load IPC + settings validation (backend-dev).** Add `dictionaryLoad: "dictionary:load"` to `src/shared/ipc.ts`; add a small main-process loader reading `app.getAppPath()/assets/dictionary/en-us.txt` (mirroring the `OcrService` construction in `src/main/index.ts`), returning a typed `Result<{ language, words }, DictionaryError>`; expose `loadDictionary(language)` on the preload API (`src/preload/preload.ts`). Add `normalizeSpellCheck` and its `normalizeSettings` wiring to `src/main/services/settings.ts`. Unit tests cover the loader (present file, missing file -> typed error) and the validator (valid object, non-object rejects, bad `enabled`, bad `language`, absent field).

**C. Spell-check decoration + suggestion list on both text surfaces (frontend-dev).** Add a reusable wrapper around the panel Text field (`[data-txt-text]`) and the on-canvas run editor (`[data-edit-run-editor]`) that renders the misspelled-underline mirror and the contextmenu suggestion popover, plus the enable toggle in the panel Text group. Load the dictionary once per session through `window.tflex.loadDictionary('en-US')`, cache the compiled `Set`, read/write `settings.spellCheck`, and pass state into the panel. Test hooks: `[data-txt-spellcheck]`, `[data-spell-misspelled]`, `[data-spell-suggest]`, `[data-spell-suggestion]`, `[data-spell-status]`. Unit tests cover the word-at-offset resolver, the accept-replace (value -> replaced token -> same `onChange`), the debounce/check state and the fail-loud status.

**D. Focused QA + adversarial diff-pass (qa, adversary).** qa proves the feature end to end: type a known misspelling in `[data-txt-text]` -> the word is underlined -> open `[data-spell-suggest]` -> click `[data-spell-suggestion]` -> the word is replaced and the underline clears -> the value still commits through the normal save path; plus the fail-loud dictionary-load-error state and a no-regression pass on text edit, save/export and settings persistence. The adversary runs a diff-pass on the settings-persistence and dictionary-load merge: a corrupt/oversized `spellCheck` value, a missing dictionary asset, a very large paste, IME/composition input, the same text session edited from both surfaces, and whether accepting a suggestion bypasses the single-commit-on-blur path.

**Current-scope supersession:** none - this phase extends FEA-013 (previously PROPOSED) into a delivered feature and relies on the Phase-21/26 panel Text field, the Phase-51 on-canvas run editor and the Phase-6 settings pattern unchanged.

**Success criteria**

1. With spell check enabled and a text element selected, typing a known misspelling in `[data-txt-text]` underlines the word (`[data-spell-misspelled]`), right-click opens `[data-spell-suggest]`, and accepting a `[data-spell-suggestion]` replaces the word in the edited value and clears the underline.
2. The dictionary is bundled and offline: `assets/dictionary/en-us.txt` ships through the existing `assets/**` rule and loads through `dictionary:load` with no network call; the feature works with the app offline. `spellCheck` persists across a reload and validates preserve-if-valid / reject-if-invalid (unit tests per case).
3. Fail-loud: a forced dictionary-load failure shows `[data-spell-status]` with a readable message and draws no underlines; the toggle always changes a persisted state; there is no blank UI and no silent no-op.
4. No regression to text edit, save/export, settings persistence for other fields, or offline-only behaviour.
5. The decoration wrapper is applied to BOTH the panel Text field and the on-canvas run editor; the feature is not claimed for any other overlay.
6. Unit tests cover the tokenizer offsets, `buildSpellDictionary`, the miss test, suggestions (ordering/cap/bound), the word-at-offset resolver, accept-replace and the settings validator; e2e covers type-misspelling -> underline -> suggestions -> accept -> replaced, the fail-loud load-error state, and a no-regression text-edit/save pass.
7. All DEF/ADV opened by the phase are CLOSED or REJECTED; phase-close QA returns a verdict per criterion; the phase-close commit stages every Phase 82 change (source, dictionary asset + licence, unit tests, e2e spec, ledgers, docs) as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** new controls - `[data-txt-spellcheck]` (enable/disable toggle in the panel Text group, `aria-pressed`; toggling persists `spellCheck.enabled` and immediately shows/hides underlines), `[data-spell-suggest]` (suggestion popover opened by right-click on a misspelled word), `[data-spell-suggestion]` (one suggestion; click replaces the word), `[data-spell-status]` (readable loading/off/unavailable status - never blank), `[data-spell-misspelled]` (underline decoration span, not itself interactive). Promised actions proven by the Phase 82 e2e spec: type a known misspelling -> assert `[data-spell-misspelled]`; right-click -> assert `[data-spell-suggest]`; click a `[data-spell-suggestion]` -> assert the token is replaced; force a load error -> assert `[data-spell-status]` text and no underlines; toggle off -> assert no underlines and the persisted value.

**Settings impact:** yes - a new `AppSettings.spellCheck?: { enabled: boolean; language: SpellCheckLanguage }` field (`SpellCheckLanguage = 'en-US'`, the only bundled dictionary this phase), validated preserve-if-valid / reject-if-invalid in `src/main/services/settings.ts` (`normalizeSpellCheck`), persisted through the existing settings IPC (`loadSettings` / `saveSettings`) with no new settings channel; the dictionary itself is a bundled read-only asset served over one new IPC channel (`dictionary:load`). Offline only; no network call, no password and no credential is ever stored.

## Phase 83 - Booklet and poster printing / imposition layouts (FEA-014, commissioned via TFL-315 / TFL-344, 2026-10-02)

**Operator request (product terms, TFL-344):** add the two remaining industry imposition layouts on top of the Phase-30 print foundation - **Booklet** (two pages per sheet, reordered for saddle stitch, with gutter/creep and a subset choice) and **Poster** (one page scaled across a grid of sheets, tiled with overlap and cut marks), both with a live preview. Offline only; no network feature.

**Relationship to Phase 30 (print with advanced options), Phase 33 (N-up page order) and Phase 81 (named print presets).** Phase 30 shipped N-up, page order, odd/even and reverse - the ordering plus one-image-per-page substrate - and deliberately left booklet/poster out as the L-effort tier. Phase 33 made `src/shared/printLayout.ts` the single N-up source of truth shared by the renderer preview and the main compose, so preview and print cannot disagree. Phase 81 persists a `PrintSettings` option snapshot as a named preset. This phase adds the imposition MATH on top of that substrate, keeps the single-source-of-truth rule for both new layouts, and rides the existing preset snapshot. It adds no engine capability, no new window, no new IPC channel and no network.

**CTO RULINGS:**

1. **Scope is the shared contract, one new pure shared module, the main compose path and the renderer print surface.** Files: `src/shared/types.ts` (contract), a new `src/shared/printImposition.ts` (pure math), `src/main/services/print.ts` (compose + validation), and the renderer print surface (`src/renderer/components/PrintPanel.tsx`, `src/renderer/components/usePrintControls.ts`, hosted by `src/renderer/print-window/PrintWindowApp.tsx`). No new IPC channel, no new window, no dock/toolbar verb, no Preferences entry, no engine op, no network.
2. **One shared source of truth for the imposition math** - `src/shared/printImposition.ts`, pure (no DOM, no `fs`, no Electron imports), mirroring `src/shared/printLayout.ts`, consumed by BOTH the renderer preview and the main compose so they can never disagree. It exports: `bookletPageCount(pageCount)` (pad up to a multiple of 4), `saddleStitchSequence(pageCount, subset)` (flat ordered list of 1-based page numbers with `null` for a blank slot; consecutive pairs are the front/back sides of the saddle-stitch sheets), `bookletSideOffset(sheetIndex, sheetCount, gutterPt, creepPt)` (the inward margin per page cell), and `posterTileGrid(pageWidth, pageHeight, rows, cols, overlap)` (source rectangles per tile plus the sheet count).
3. **Contract extension on `PrintSettings`, backward compatible (omitted = today's behaviour).** Add `PrintLayoutMode = 'single' | 'booklet' | 'poster'` and `BookletSubset = 'both' | 'front' | 'back'`. `PrintSettings` gains `layoutMode?` (default `'single'`), `bookletGutterPt?` (default 0, range 0-72), `bookletCreepPt?` (default 0, range 0-36), `bookletSubset?` (default `'both'`), `posterRows?` / `posterCols?` (default 2, range 1-10), `posterOverlapPt?` (default 0, range 0-72), `posterScalePercent?` (default 100, range 10-500) and `posterCutMarks?` (default false). The new keys are part of the same snapshot Phase 81 already persists, so a saved preset carries a booklet/poster layout for free - no new `AppSettings` field.
4. **Blank page slots travel explicitly.** `PrintJobPayload.images` may carry an empty string `''` to denote a blank page slot (booklet padding and single-sided subsets). `''` is not an image: `validatePrintPayload` accepts it as a placeholder (it must NOT reject the payload), and `composePrintHtml` renders an empty `.page` cell for it. A non-empty entry must still pass the existing `isValidPageImage` check.
5. **Booklet semantics.** Saddle stitch: a document padded to a multiple of 4; sheet i (0-based) front side holds pages `[N-2i, 2i+1]` and back side holds `[2i+2, N-2i-1]` where a value above the real page count is a blank. The layout is 2-up, landscape by default. `bookletSubset` selects which sides are emitted: `both` emits front then back per sheet (interleaved, relying on the user's duplex setting); `front`/`back` emit only that side per sheet (for manual reload). `bookletGutterPt` is a binding gap added between the two page cells on a side; `bookletCreepPt` is a progressive inward shift of the inner sheets to compensate fold thickness (`bookletSideOffset`). The preview shows the actual saddle-stitch pairs and applies the same offsets.
6. **Poster semantics.** One selected page is scaled to `posterScalePercent` and tiled across a `posterRows` x `posterCols` grid, one tile per sheet; adjacent tiles overlap by `posterOverlapPt` so the user can glue them; `posterCutMarks` draws trim marks at tile edges. Source rectangles come only from `posterTileGrid`; the renderer crops the tiles and the preview shows the same grid with overlap and cut marks. Page selection is the normal Phase-30 selection (scope/range); poster ignores odd/even, reverse and N-up order (those controls are disabled, not silently ignored).
7. **Fail loud, no silent no-op.** An invalid poster grid (0, negative or above the max), an out-of-range overlap/scale, or an invalid booklet subset fails loud with an inline error (`[data-print-layout-error]`) and nothing is sent to the printer. Switching to Booklet or Poster disables the controls that do not apply (page order, odd/even, reverse) and enables the layout-specific ones; switching back restores them. The preview always reflects the chosen layout.
8. **No regression** to the Phase-30/33/81 print option set (N-up, page order, odd/even/reverse), printing, print presets, settings persistence for other fields, or the offline-only rule.

**Features**

**A. Shared imposition contract + pure math (backend-dev).** Add `PrintLayoutMode`, `BookletSubset` and the new `PrintSettings` keys to `src/shared/types.ts`; allow `''` blank slots in `PrintJobPayload` (documented) and extend `src/shared/printLayout.ts`-style discipline into a new pure `src/shared/printImposition.ts` (`bookletPageCount`, `saddleStitchSequence`, `bookletSideOffset`, `posterTileGrid`). Unit tests cover the saddle-stitch sequence and blank padding for N = 1..8 and both subsets, `bookletSideOffset` monotonic creep, and the poster tile geometry (non-overlapping grid, overlap step, sheet count, single-row/column grids).

**B. Main compose + validation (backend-dev).** Extend `validatePrintPayload` (`src/main/services/print.ts`) to accept `''` slots and to bounds-check the new options, and extend `composePrintHtml` so Booklet lays out 2-up saddle-stitch sides with the gutter/creep margins from `bookletSideOffset`, and Poster lays out `rows*cols` tile sheets with `posterCutMarks` trim marks. Unit tests cover the compose HTML for a booklet of N=8 (sheet order, blanks, gutter/creep) and a poster 2x2 (four sheets, cut marks on/off) plus the new validation rejections.

**C. Renderer controls + imposed preview (frontend-dev).** Add the layout selector and the layout-specific controls to `PrintPanel.tsx` and `usePrintControls.ts`: booklet gutter/creep/subset and poster rows/cols/overlap/scale/cut-marks, wired through `buildPrintSettings` / `seedPrintDialogState`; drive the preview from `src/shared/printImposition.ts` (saddle-stitch pairs with offsets; poster tile grid with overlap and cut marks); disable the non-applicable controls; show `[data-print-layout-error]` on an invalid combination. Test hooks: `[data-print-layout]`, `[data-print-booklet-gutter]`, `[data-print-booklet-creep]`, `[data-print-booklet-subset]`, `[data-print-poster-rows]`, `[data-print-poster-cols]`, `[data-print-poster-overlap]`, `[data-print-poster-scale]`, `[data-print-poster-cut-marks]`, `[data-print-cut-mark]`, `[data-print-layout-error]`. Unit tests cover the layout state model, the control enable/disable matrix and the preview derivation.

**D. Focused QA + adversarial diff-pass (qa, adversary).** qa proves the feature end to end on a multi-page fixture: Booklet preview shows saddle-stitch pairs, changing gutter/creep/subset changes the preview and the composed output, and a print to the virtual-PDF destination produces a document in the saddle-stitch page order (parsed, not a static render); Poster preview shows the tile grid with cut marks and produces `rows*cols` tile sheets; plus the invalid-grid fail-loud and a no-regression pass on N-up/page order/odd-even/reverse, presets and settings persistence. The adversary runs a diff-pass on the compose and preset-snapshot merge: a malformed stored booklet/poster preset, blank-slot payloads, a 1x1 and a 10x10 poster grid, extreme overlap/scale, and whether switching layout mutates other print settings.

**Current-scope supersession:** none - this phase extends FEA-014 (previously PROPOSED) into a delivered feature and relies on the Phase-30 `PrintSettings` shape, the Phase-33 shared layout rule and the Phase-81 preset snapshot unchanged.

**Success criteria**

1. Booklet layout imposes the preview 2-up in saddle-stitch order for a multi-page fixture: the preview shows the correct front/back page pairs (including blank padding), and gutter, creep and subset visibly change the preview.
2. Poster layout scales one page across the chosen rows x cols grid with overlap and cut marks, and the preview shows that tile grid.
3. The print output is correct through the real print path, not a static render only: printing the fixture with Booklet to the virtual-PDF destination produces a document whose sheets are in the saddle-stitch page order (verified by inspecting the composed print HTML / produced document), and a Poster run produces `rows*cols` tile sheets with cut marks when enabled.
4. No silent no-op: an invalid poster grid or an invalid combination shows `[data-print-layout-error]` and nothing is sent to the printer; switching layout enables/disables the applicable controls rather than ignoring them.
5. No regression to N-up, page order, odd/even, reverse, print presets, printing, settings persistence for other fields, or offline-only behaviour (no network call added).
6. Unit tests cover the imposition math (`saddleStitchSequence`, `bookletSideOffset`, `posterTileGrid`), the main compose for booklet and poster, the validator's new cases, and the renderer layout state model; e2e covers the booklet preview + gutter/creep/subset, the poster preview + cut marks, the invalid-grid error, and a print-path proof for both layouts.
7. All DEF/ADV opened by the phase are CLOSED or REJECTED; phase-close QA returns a verdict per criterion; the phase-close commit stages every Phase 83 change (source, unit tests, e2e spec, ledgers, docs) as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** new controls - `[data-print-layout]` (layout selector: Single / N-up, Booklet, Poster), `[data-print-booklet-gutter]` and `[data-print-booklet-creep]` (numeric, apply the binding gap and per-sheet creep to the preview and output), `[data-print-booklet-subset]` (Both sides / Front side only / Back side only), `[data-print-poster-rows]` and `[data-print-poster-cols]` (grid size), `[data-print-poster-overlap]` (glue overlap), `[data-print-poster-scale]` (per-tile scale percent), `[data-print-poster-cut-marks]` (checkbox; draws `[data-print-cut-mark]` trim marks in the preview and output), `[data-print-layout-error]` (readable inline error for an invalid combination - never blank). Promised actions proven by the Phase 83 e2e spec: choose Booklet -> assert the preview shows saddle-stitch pairs and the layout-specific controls; change gutter/creep/subset -> assert the preview changes; choose Poster -> assert the tile grid and cut marks; an invalid grid -> assert `[data-print-layout-error]` and no print; a print-path run -> assert the composed page order/tile count.

**Settings impact:** none (no new `AppSettings` field). The new booklet/poster keys extend the existing `PrintSettings` shape, so they are carried by the Phase-81 `AppSettings.printPresets` snapshot and re-applied unchanged through the existing settings IPC; no new settings channel, no new IPC channel. Offline only; no network call, no password and no credential is ever stored.

## Phase 84 - True redaction: permanently remove covered text content (FEA-031, commissioned via TFL-315 / TFL-382, 2026-10-02)

**Operator request (product terms, TFL-382):** give TFlex users **true redaction** - mark text or a region on a page, render it as a redaction (configurable mark colour), and **permanently remove the covered content on save** so a "redacted" term cannot be recovered by text extraction or copy/paste from the saved file. Offline only; no network feature.

**Relationship to Phase 10 (edit content in place), Phase 3 (annotations) and Phase 52 (encrypted PDF prefix).** Phase 10's delete/erase is documented **visual redact-and-redraw**: the engine white-masks the old rect and redraws, and the original `Tj`/`TJ` operators remain in the content stream, so extraction and copy still return the "erased" text (DEF-116 REJECTED; `src/main/services/engine.ts:2361-2367`, `:2453-2456`). This phase closes that confidentiality gap by rewriting the page content stream so the covered glyph-show operators are removed, not covered. It adds one engine operation, one new pure shared module, one new IPC channel and one settings field; it adds no window, no network and no second document model.

**Capability boundary (honest, non-negotiable).** pdf-lib cannot edit existing page content streams, and the engine has no content-stream rewriter today (`extractTextFromRawPdf`/`parseContentStreamText`, `engine.ts:6794`/`:7584`, are regex **read** helpers only). This phase delivers true removal for **text-show content** and refuses everything it cannot guarantee, rather than shipping a half-redactor that appears to remove content but leaves it recoverable.

**CTO RULINGS:**

1. **Scope is one new pure shared module, the main-process engine/settings, the shared IPC contract, and one renderer tool/overlay.** Files: `src/shared/redaction.ts` (new, pure), `src/shared/types.ts` and `src/shared/ipc.ts` (contract), `src/main/services/engine.ts` (the op), `src/main/services/settings.ts` (the setting), the preload/main handler wiring, and on the renderer: a new `src/renderer/redaction/` overlay plus the tools registry, the App host wiring and the `src/renderer/engine/{engineClient,types,stubEngine}.ts` client. No new window, no new document model, no new engine op beyond the one below, no new IPC channel beyond the one below, no network.
2. **True removal means the glyph-show operators are removed from the page content stream.** The op rewrites the affected page content stream so that every glyph whose page-space box intersects a marked region is dropped (`Tj`, `TJ`, `'`, `"` operands or substrings), and only then draws the opaque mark rectangle. Adjacent text outside every mark must survive byte-for-byte in effect. An opaque rectangle drawn without removing the underlying operators is a **failure**, not a partial pass.
3. **One shared, pure source of truth for the removal geometry.** New `src/shared/redaction.ts`, pure (no `fs`, no Electron, no DOM imports), mirroring the `src/shared/printLayout.ts` / `printImposition.ts` discipline. It exports a content-stream tokenizer plus text-state tracking (`q/Q`, `cm`, `BT/ET`, `Td/TD/Tm/T*/TL`, `Tf`, `Tc/Tw/Tz`) and a `removeRedactedGlyphs(content, marks, resolveAdvance)` function that returns the rewritten content plus the count of removed glyphs; it may also export `collectTextRuns`. The engine supplies decoded stream text and a font-advance resolver; the geometry itself is shared and unit-tested in isolation.
4. **Supported font classes and the fail-loud boundary.** Glyph advances are resolved for text runs whose font metrics the engine can read (standard-14 and simple/Type0 fonts with a usable `Widths`/`W` table), reusing the existing font/ToUnicode resolution (`resolvePageFontToUnicode`, `engine.ts:7473`) and pdf-lib font metrics where available. If a mark intersects a show operator whose glyph advances cannot be resolved, or a page content stream cannot be decoded, the redaction **refuses loudly** with a typed `redaction-unsupported` error naming the page and reason; nothing is applied to that page. It never guesses positions or removes a run it cannot bound.
5. **Image and vector content is explicitly not removed and must not be a silent no-op.** `Do` XObject and path-painting operators are out of the removal set. A mark that covers no removable text returns a readable warning (`[data-redact-warning]`), and the renderer exposes an "also remove images/vector" affordance **disabled-with-tooltip**, never as a working control that quietly does nothing.
6. **One new engine op and one new IPC channel.** `engine.applyRedactions(docId, payload)` on channel `engine:applyRedactions`. Payload `ApplyRedactionsPayload { page: number; marks: RedactionMark[]; color?: string }` with `RedactionMark { rect: AnnRect }` (page-space points, the same convention as `EditTextRunPayload.rect`). Response `Result<RedactionApplyResult, EngineError>` where `RedactionApplyResult { state: EngineState; removedGlyphs: number; warnings: string[] }`. The op takes one undo snapshot (`snapshotDocWithPdf`) so undo restores the pre-redaction bytes, and it is enqueued through `_enqueue` like every other mutating op. The full contract chain is extended at every layer named in Ruling 1.
7. **Mark colour is a persisted setting.** `redactionColor?: string` (default `'#000000'`; validation: preserve-if-valid `^#[0-9a-fA-F]{6}$`, reject-if-invalid -> default), added to `AppSettings` (`src/shared/types.ts`), `DEFAULT_SETTINGS` and `normalizeSettings` (`src/main/services/settings.ts`), transported over the existing settings IPC and used by the renderer swatch and the engine's mark rectangle. No new settings channel.
8. **Marks are session state until applied.** The renderer holds pending marks (per page) and applies them in one action; applying rewrites the stream, draws the marks, clears the pending set and produces exactly ONE undo entry. Marks are not new annotation objects and are not persisted as annotations; the persistence is the removed content plus the drawn rectangle. Redaction survives save/reload through the existing `serializeDoc` path (`engine.ts:5551`).
9. **No regression** to Phase-10 text edit and delete/erase, annotations, forms/signatures, save/export, settings persistence, or the encrypted-PDF prefix; the feature is fully offline (no network call, nothing leaves the machine).

**Features**

**A. Pure removal geometry (backend-dev).** Add `src/shared/redaction.ts`: a tokenizer over a decoded content stream that tracks graphics and text state and identifies glyph-show runs with their page-space boxes, plus `removeRedactedGlyphs(content, marks, resolveAdvance)` returning the rewritten content and removed-glyph count. Unit tests cover `Tj`, `TJ` (including a partial array where only the middle glyphs fall in a mark), `'`/`"`, nested `q/Q/cm` transforms, multiple `Tf` switches, and the no-intersection case (content unchanged).

**B. Engine op, IPC chain and setting (backend-dev).** Add `applyRedactions` to `src/main/services/engine.ts` (decode each marked page's content stream, call the shared remover with a font-advance resolver, write the rewritten stream back, draw the opaque mark rectangles in `redactionColor`, snapshot undo, enqueue), the `engine:applyRedactions` channel and payload/result types to `src/shared/ipc.ts` and `src/shared/types.ts`, the preload bridge and main handler, the `redactionColor` field + `normalizeRedactionColor` in `src/main/services/settings.ts`, and the typed `redaction-unsupported` refusal. Unit tests prove a redacted term is absent from `extractTextFromRawPdf` after the op and after a save/reload, that unrelated text on the same page and other pages is unchanged, that undo restores the pre-redaction text, and that an unsupported page refuses without mutating the document.

**C. Renderer tool, overlay and colour (frontend-dev).** Add a new "Redact" tool to the tools registry (`src/renderer/state/toolsRegistry.ts`) surfaced in the dock, an overlay under `src/renderer/redaction/` modelled on `EditOverlay` (`styles.css:10305`, `EditOverlay.tsx:1426-1441`) with a region drag (`EditOverlay.pagePoint`, `edit/EditOverlay.tsx:488-499`; `normalizeDragRect`) and a text-selection mode built from the pdf.js text geometry (`PageView.textItemsToGeom`, `PageView.tsx:265-294`; `annotations/geometry.ts`), a configurable-colour swatch reusing `ColorPalette`/`AnnColorBox`, pending-mark list with clear/undo, an Apply action calling `engine.applyRedactions`, and the fail-loud surfaces (`[data-redact-warning]`, disabled-with-tooltip image/vector affordance). Extend `engineClient.ts`, the renderer `types.ts` and `stubEngine.ts` with the new op. Test hooks: `[data-redact-tool]`, `[data-redact-layer]`, `[data-redact-mode]`, `[data-redact-swatch]`, `[data-redact-mark]`, `[data-redact-apply]`, `[data-redact-clear]`, `[data-redact-undo]`, `[data-redact-warning]`, `[data-redact-unsupported]`. Unit tests cover the pending-mark state model, coordinate conversion, the colour setting round-trip and the fail-loud branches.

**D. Focused QA + adversarial diff-pass (qa, adversary).** qa proves the feature end to end on a text fixture: mark a known term, apply, save, reload, and assert the term is gone from text extraction **and** copy while a sibling term on the same page is intact; assert the mark renders in the configured colour and `redactionColor` persists across restart; assert the image-only mark warning and the unsupported-page refusal. The adversary runs a diff-pass on the save/redaction merge (a high-risk content-rewrite path): partially covered `TJ` arrays, marks spanning a transform, a mark on an encrypted/open-prefix document, a no-text mark, and the undo/save byte round-trip, filing ADV entries for confirmed breaks.

**Current-scope supersession:** this phase deliberately adds redaction, which the original v1 "Not in scope" list named ("No OCR, redaction, ..."). It is authorised the same way Phases 9-11 and 44-57 supersede their matching exclusions: the added capability is exactly true redaction as specified here, offline, with no network and no other exclusion lifted.

**Success criteria**

1. Marking a known term on a text page and applying redaction removes it: after the op, and again after save + reload, neither `engine.exportText` nor a raw content-stream read returns the redacted term, while every other term on the same page and on other pages is still returned.
2. The applied mark renders as an opaque rectangle in the configured `redactionColor`, and that colour persists across an app restart.
3. The removal is real, not a cover: the saved file's page content stream no longer contains the redacted glyph show (verified by inspecting the decoded stream, not by pixel output only).
4. No silent no-op: a mark that covers no removable text returns a visible `[data-redact-warning]`; an unsupported page or unresolvable font refuses loudly with a typed `redaction-unsupported` error and applies nothing; the image/vector affordance is disabled-with-tooltip.
5. Undo after an apply restores the pre-redaction text (the original term is extractable again), and applying again re-removes it.
6. No regression to Phase-10 text edit and delete/erase, annotations, save/export, or settings persistence; offline-only preserved (no network call added).
7. All DEF/ADV opened by the phase are CLOSED or REJECTED; phase-close QA returns a verdict per criterion; the phase-close commit stages every Phase 84 change (source, unit tests, e2e spec, ledgers, docs) as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** new controls - `[data-redact-tool]` (Redact tool in the dock), `[data-redact-mode]` (Region / Text marking mode), `[data-redact-swatch]` (mark-colour picker, persisted as `redactionColor`), `[data-redact-mark]` (a pending mark on the page), `[data-redact-apply]` (apply all pending marks: removes the covered glyphs and draws the marks), `[data-redact-clear]` (discard pending marks), `[data-redact-undo]` (undo the last apply), `[data-redact-warning]` (readable warning when a mark covers no removable text - never blank), `[data-redact-unsupported]` (image/vector removal affordance, disabled-with-tooltip). Promised actions proven by the Phase 84 e2e spec: arm Redact -> mark a term -> Apply -> assert the term is gone from extraction and copy while sibling text remains; switch mode -> assert the mode hook; change the swatch -> assert the mark colour and the persisted setting; an image-only mark -> assert `[data-redact-warning]`; an unsupported page -> assert the typed refusal applies nothing.

**Settings impact:** one new `AppSettings` field - `redactionColor?: string` (default `'#000000'`; validation: preserve-if-valid six-digit hex `^#[0-9a-fA-F]{6}$`, reject-if-invalid falls back to the default), implemented in `src/main/services/settings.ts` (`DEFAULT_SETTINGS` + `normalizeRedactionColor`) and consumed by both the renderer swatch and the engine's mark fill; transported over the existing settings IPC (no new channel). Offline only; no network call and no credential is ever stored.

## Phase 85 - Create and edit bookmarks: editable outline tree (FEA-035, commissioned via TFL-315 / TFL-383, 2026-10-02)

**Operator request (product terms, TFL-383):** give TFlex users an **editable outline / bookmarks panel** - add, rename, retarget, nest/un-nest and delete outline entries - beyond today's view-only navigation. Edits persist into the saved document's `/Outlines` tree so they survive save/reload and show in a compliant reader. Offline only; no network feature.

**Relationship to Phase 1 (viewer outline), Phase 2/32 (organize / merge) and Phase 12 (replace/renumber).** Phase 1 shipped a **read-only** outline panel (`OutlinePanel`, `SideRail.tsx:1607-1676`) backed by pdf.js (`readOutline`, `pdfjs.ts:179-203`; `resolveOutlinePage`, `pdfjs.ts:209-233`). Phase 2/32 merge and Phase 12 replace/renumber already **carry** an existing `/Outlines` tree with a page-ref remap (`carryOutlines`, `page-organize.ts:53-108`; called from `serializeDoc`, `engine.ts:5704-5717`), but nothing can create or change an entry, so a merged/reorganized document keeps stale or missing bookmarks. This phase adds the write path: one pure shared tree module, one engine op that rewrites the working document's `/Outlines`, the existing channel pattern, and the panel's edit affordances. It adds no window, no new document model, no setting and no network.

**CTO RULINGS:**

1. **Scope is one new pure shared module, the shared contract, the main-process outline writer + engine op, the preload bridge, and the renderer outline panel.** Files: `src/shared/outline.ts` (new, pure), `src/shared/types.ts` and `src/shared/ipc.ts` (contract), `src/main/services/page-organize.ts` (the writer), `src/main/services/engine.ts` (the op), `src/preload/preload.ts` (bridge), and on the renderer `src/renderer/components/SideRail.tsx`, `src/renderer/components/ContextPanel.tsx`, `src/renderer/App.tsx`, `src/renderer/engine/{engineClient,types,stubEngine}.ts` and a new `src/renderer/state/outlineEditor.ts`. No new window, no new document model, no new settings field, no second outline writer on the save path, no network.
2. **One shared, pure source of truth for the tree.** New `src/shared/outline.ts`, pure (no `fs`, no Electron, no DOM), mirroring the `src/shared/printLayout.ts` / `redaction.ts` discipline. It exports `interface OutlineEntry { title: string; page: number | null; children: OutlineEntry[] }` where `page` is a **1-based VISIBLE page** (null = no target), plus pure helpers: `normalizeOutline(input): OutlineEntry[]` (shape/depth clamp, non-string title -> dropped, page must be `null` or a positive integer), path-based edits `insertEntry(entries, path, entry)`, `renameEntry(entries, path, title)`, `retargetEntry(entries, path, page)`, `indentEntry(entries, path)` / `outdentEntry(entries, path)` and `removeEntry(entries, path)`, and `countOutline(entries)`. Every helper returns a NEW array (no in-place mutation) and is unit-tested in isolation.
3. **One new engine op and one new IPC channel.** `engine.setOutline(docId, entries: OutlineEntry[])` on channel `engine:setOutline`, returning `Result<EngineState, EngineError>`. The op resolves each entry's `page` to the working document's underlying page ref through the engine's visible-page mapping (`doc.order` / `doc.deleted`) and rewrites `doc.pdfDoc`'s catalog `/Outlines` from the full tree; it takes exactly one undo snapshot (`snapshotDocWithPdf`) so undo restores the pre-edit bytes, marks the document modified and is enqueued through `_enqueue` like every other mutating op. The full contract chain is extended at every layer named in Ruling 1.
4. **The save path does not change.** `serializeDoc`'s existing `carryOutlines` call (`engine.ts:5704-5717`) already copies the working document's `/Outlines` to the output with a page-ref remap, so writing the edited tree into `doc.pdfDoc` in the op is sufficient for persistence. Do NOT add a second outline write to `serializeDoc` / `serializeDocOptimized`; the op is the only new writer.
5. **Fail loud, never a silent no-op.** An entry whose `page` is not an integer in `[1, visibleCount]` or points at a deleted page fails the whole op with the typed `out-of-range` error and applies NOTHING (all-or-nothing). A non-string or empty trimmed title fails with the new typed `invalid-outline` error and applies nothing. The renderer shows a readable `[data-outline-error]` and reverts its model to the last accepted tree; it must never leave the panel showing an edit the engine refused.
6. **The renderer seeds and re-seeds its model from the persisted outline.** The editable model is derived from the loaded pdf.js outline (`readOutline` + `resolveOutlinePage` per node, `App.tsx:1986`) whenever the document bytes change (open, save/reload, undo/redo), so saved edits reappear after a reload. In-session edits commit through `engine.setOutline` on the same tree model; navigation (`onJump`) is unchanged.
7. **No new setting.** The outline lives in the document, not in app settings, so `Settings impact: none`. No new settings field, no new channel, no credential.
8. **No regression** to the read-only outline navigation, Phase 2/32 merge/reorder/save, Phase 12 replace/renumber, annotations, or settings persistence; the feature is fully offline (no network call, nothing leaves the machine).

**Features**

**A. Pure outline tree module + contract (backend-dev).** Add `src/shared/outline.ts` (`OutlineEntry`, `normalizeOutline`, the path-based edit helpers, `countOutline`). Add to `src/shared/types.ts` the import/re-export of `OutlineEntry`, the new `EngineError` member `'invalid-outline'` (`types.ts:427-440`), and to the `TflexAPI` interface in `src/shared/ipc.ts` the `setOutline` method after the `cropPages` block (`ipc.ts:752-764` pattern). Unit tests cover normalization, each tree edit (add/rename/retarget/indent/outdent/remove), no in-place mutation, and the fail-loud validation of page/title.

**B. Outline writer, engine op, IPC + preload (backend-dev).** Add `writeOutline(dstDoc, entries, resolvePageRef)` to `src/main/services/page-organize.ts` (build `/Outlines` with `/Title` PDFString, `/Parent`/`/First`/`/Last`/`/Next`, `/Count` = open descendant count, `/Dest = [pageRef, /XYZ null null null]`; replace any existing `/Outlines`), and `setOutline` + `_setOutlineImpl` to `src/main/services/engine.ts` modelled on `_renumberPagesImpl` (`engine.ts:3261-3291`): unknown doc -> `engine-error`; validate every entry via the shared module and the visible-page range, else return `out-of-range` / `invalid-outline` with no mutation; one `snapshotDocWithPdf`; write the tree; push undo; `doc.modified = true`; return `ok(buildState(doc))`. Wire the `engine:setOutline` channel through the main handler and `src/preload/preload.ts` (mirror the `renumberPages` bridge at `preload.ts:388`). Unit tests prove: a created/renamed/retargeted/nested/deleted tree is reflected by re-reading `/Outlines` from the working doc and after `serializeDoc` + reopen; an out-of-range page refuses and leaves the tree unchanged; undo restores the previous tree; an empty-title entry refuses.

**C. Editable outline panel (frontend-dev).** Extend `OutlinePanel` (`SideRail.tsx:1607-1676`, exported and re-parented by `ContextPanel.tsx:396-418`) from view-only to editable, and add a pure model in `src/renderer/state/outlineEditor.ts` (seed from the loaded outline, path-based selection, apply-edit-via-`setOutline`, revert-on-error). Controls: `[data-outline-row]` (selectable row), `[data-outline-add]` (add a sibling entry to the selected row, or a first entry when the outline is empty), `[data-outline-rename]` (inline title edit, commits on Enter/blur), `[data-outline-retarget]` (page target picker; invalid/out-of-range shows `[data-outline-error]` and does not call the engine), `[data-outline-indent]` / `[data-outline-outdent]` (nest / un-nest against the previous sibling), `[data-outline-delete]`, and `[data-outline-page]` (the resolved page badge on each row). Navigation via `onJump` is preserved. Extend `engineClient.ts` (`:443`/`:1456` pattern), the renderer `types.ts` (`:610`) and `stubEngine.ts` (`:1264`) with `setOutline`, and re-seed the model on document change in `App.tsx`. Unit tests cover the model seed, each edit committing the right payload, the invalid-target revert, and the empty-outline add.

**D. Focused QA + adversarial diff-pass (qa, adversary).** qa proves the phase end to end: open a fixture with an outline, add a bookmark to a known page, rename an existing one, retarget it to another page, nest and un-nest, delete one, save, reload, and assert the re-read outline has exactly the edited shape and that navigation to an edited bookmark still jumps to its page; assert an out-of-range retarget shows `[data-outline-error]` and changes nothing. The adversary runs a diff-pass on the save/outline merge (a high-risk `/Outlines` rewrite): a document with no prior outline, an outline whose entry targets a deleted page, indent/outdent at the tree root and at depth, a malformed pre-existing `/Outlines`, the undo byte round-trip, and the Phase 2/32 merge-then-edit-then-save sequence, filing ADV entries for confirmed breaks.

**Current-scope supersession:** none - this phase lifts the original v1 "Not in scope" sentence "No bookmarks/outline editing (read the outline if present; editing is out of scope)" **for exactly the add/rename/retarget/nest/delete editing specified here, offline**, the same way Phases 9-11 and 44-57 supersede their matching exclusions. Reading the outline stays as-is; no other exclusion is lifted.

**Success criteria**

1. The outline panel supports add, rename, retarget, nest/un-nest and delete of bookmark entries; each action commits through `engine.setOutline` and the panel shows the resulting tree (`[data-outline-row]` per entry, `[data-outline-page]` per target).
2. Navigation to a bookmark still works: clicking an entry jumps the workspace to its page, before and after editing.
3. Edited bookmarks persist: after save + reload, the re-read `/Outlines` tree matches the edited shape exactly (titles, page targets and nesting), and a compliant reader shows the same outline.
4. No silent no-op: an out-of-range retarget shows `[data-outline-error]` and applies nothing; the engine returns the typed `out-of-range` / `invalid-outline` error and leaves the document unmodified; the panel reverts to the last accepted tree.
5. No regression to read-only outline navigation, Phase 2/32 merge/reorder/save, Phase 12 replace/renumber, or settings persistence; offline-only preserved (no network call added).
6. Unit tests cover the pure tree module, the engine op (write + read-back, refuse-and-unchanged, undo restore) and the renderer model; e2e covers add/edit/nest/delete -> save -> reload -> navigation plus the invalid-target fail-loud.
7. All DEF/ADV opened by the phase are CLOSED or REJECTED; phase-close QA returns a verdict per criterion; the phase-close commit stages every Phase 85 change (source, unit tests, e2e spec, ledgers, docs) as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** new controls - `[data-outline-row]` (a selectable outline entry row; selecting it arms the row verbs), `[data-outline-add]` (add a sibling entry to the selection, or the first entry when the outline is empty; commits via `setOutline`), `[data-outline-rename]` (inline title edit, commits on Enter/blur; empty title -> `[data-outline-error]`, no write), `[data-outline-retarget]` (set the entry's page target; out-of-range/invalid -> `[data-outline-error]` and no engine call), `[data-outline-indent]` / `[data-outline-outdent]` (nest under the previous sibling / un-nest to the parent level; disabled-with-tooltip at the root or first child), `[data-outline-delete]` (remove the entry and its subtree), `[data-outline-page]` (the resolved page badge on a row). Promised actions proven by the Phase 85 e2e spec: add a bookmark on a known page -> assert the row appears and navigation jumps; rename -> assert the new title; retarget -> assert the new `[data-outline-page]` and navigation; indent/outdent -> assert the nesting depth; delete -> assert the row is gone; save -> reload -> assert the tree survives; retarget out of range -> assert `[data-outline-error]` and the unchanged tree.

**Settings impact:** none (the outline is persisted inside the PDF's `/Outlines` tree, not in app settings; no new `AppSettings` field, no new settings channel, no credential). Offline only; no network call is added.

## Phase 86 - Search and replace text across the document (FEA-038, commissioned via TFL-315 / TFL-425, 2026-10-02)

**Operator request (product terms, TFL-425):** let a user **find every occurrence** of a term across the document and **replace a single occurrence or all occurrences**, so renaming a term through a long document is not manual page-by-page work. The Find machinery already exists; this phase adds the write side. Offline only; no network feature.

**Relationship to the Find bar (Phase 1/16), Phase 10 (edit content in place) and Phase 84 (true redaction).** The renderer already has a document-wide, case-insensitive literal search: `buildPageIndex` / `findPageHits` (`src/renderer/search/searchIndex.ts:15/51`) over pdf.js `getTextContent()` items, walked page by page in `DocumentView.tsx:2895-2969`, rendered by `SearchBar.tsx` (`DocumentView.tsx:4201`) and highlighted through the pdf.js text layer (`PageView.tsx:859-951`). This phase **keeps that Find machinery unchanged** and adds replace on top of it. Replacement is **not** Phase 10's mask-and-redraw (`engine.editTextRun`, `engine.ts:2430`): that path leaves the original glyph-show operators in the content stream, so the old term stays extractable (`DEF-116`, documented at `types.ts:1091-1104`). Replace instead reuses the **true content-stream rewriting** added by Phase 84 (`src/shared/redaction.ts`: `tokenizeContentStream` `:439`, `removeRedactedGlyphs` `:594`, `RedactionUnsupportedError` `:59`): the matched glyphs are removed from the page content stream and the replacement text is drawn as real glyphs, so the old text is gone and the new text is real saved content. The phase adds one pure shared module, the shared contract, one engine op / one IPC channel, the preload/main wiring and the renderer Replace surface. It adds no window, no new document model, no new settings field and no network.

**Capability boundary (honest, non-negotiable).** pdf-lib cannot reuse an embedded subset font, and this engine's content-stream reader decodes simple/WinAnsi fonts and Type0 fonts only through the existing ToUnicode resolution (`resolvePageFontToUnicode`, `engine.ts:7473`). The replacement text is therefore drawn in a **StandardFont substitution** (the existing Phase 21 edit-font allowlist via `editDefaultFont`), and every occurrence whose geometry or encoding the engine cannot positively bound is **reported, never silently dropped**. This phase refuses to guess positions or to substitute a run it cannot bound.

**CTO RULINGS:**

1. **Scope is one new pure shared module, the shared contract, the main-process engine op + preload/main wiring, and the renderer Replace surface.** Files: `src/shared/searchReplace.ts` (new, pure), `src/shared/types.ts` and `src/shared/ipc.ts` (contract), `src/main/services/engine.ts` (the op), `src/main/index.ts` (handler) and `src/preload/preload.ts` (bridge), and on the renderer `src/renderer/components/SearchBar.tsx`, `src/renderer/components/DocumentView.tsx`, `src/renderer/App.tsx`, and `src/renderer/engine/{engineClient,types,stubEngine}.ts`. No new window, no new document model, no new settings field, no network.
2. **Find is untouched; replace reuses the existing search index.** `searchIndex.ts`, the page walk in `DocumentView.tsx:2895-2969`, the pdf.js highlighting in `PageView.tsx:859-951` and Find navigation are NOT modified. The Replace surface consumes the same `SearchHit[]` the Find bar already produces; each hit carries `{ page, start, end }` (`searchIndex.ts:30-34`).
3. **Replacement is a real content-stream edit, not an overlay.** For each occurrence the engine decodes the page content stream, removes the matched glyphs with the Phase-84 remover, and draws the replacement text as real glyphs at the occurrence's baseline. Success criterion 2 is proven by text extraction: after the op, and again after save + reload, `engine.exportText` must no longer return the old term on that page while every other run on the page and other pages is unchanged.
4. **One shared, pure source of truth for the geometry.** New `src/shared/searchReplace.ts`, pure (no `fs`, no Electron, no DOM), importing the tokenizer and removal from `./redaction` (no copy, no fork of the removal code). It exports a per-occurrence plan function `planReplace(content, occurrences, replacement, resolveAdvance)` where `occurrences` is `ReplaceOccurrence[]`, returning the rewritten content, the removed-glyph count, and a list of draw anchors `{ pageX, pageYBaseline, fontName, fontSize, drawnText, substituted }`; it also exports `collectTextRuns(content, resolveAdvance)` returning every show run's page-space box, baseline origin, font and size. `resolveAdvance` is the existing `RedactionAdvanceResolver` (`redaction.ts:40`). The engine consumes exactly what this module unit-tests.
5. **Occurrence geometry is derived from the existing search hits, and the engine verifies it.** The renderer converts each `SearchHit` to a page-space rect using the existing per-item text geometry (`PageView.getTextItems` / `textItemsToGeom`, `PageView.tsx:265-294`) and the matched characters' per-character width; the rect uses the `AnnRect` top-left page-points convention. The engine, per occurrence, checks that the glyphs its removal would drop actually spell the supplied `find` (case-insensitive); if they do not, that occurrence is **skipped with a readable reason** and nothing is removed for it. It never removes a run it cannot positively match.
6. **One new engine op and one new IPC channel.** `engine.replaceText(docId, payload)` on channel `engine:replaceText`. `ReplaceTextPayload { occurrences: ReplaceOccurrence[]; replacement: string; font?: EditFont; size?: number; color?: EditColor }` with `ReplaceOccurrence { page: number; rect: AnnRect; find: string }` where `page` is the 1-based VISIBLE page. It returns `Result<ReplaceTextResult, EngineError>` where `ReplaceTextResult { state: EngineState; replaced: number; skipped: ReplaceSkip[]; substitutedFonts: string[] }` and `ReplaceSkip { page: number; rect: AnnRect; find: string; reason: string }`. The op covers every occurrence in one call (grouped by page), takes exactly ONE undo snapshot (`snapshotDocWithPdf`) so replace-all is one undo entry, is enqueued through `_enqueue` like every other mutating op, and sets `doc.modified = true`. The full contract chain is extended at every layer named in Ruling 1.
7. **Fail-loud, never a silent no-op.** An occurrence that cannot be bounded, whose covered glyphs do not spell `find`, or whose page content stream cannot be decoded is returned in `skipped` with a readable reason naming the page and the cause; the renderer shows it in `[data-search-replace-report]` (never blank). A page whose stream cannot be decoded at all for a replace-all refuses the whole op with the typed `replace-unsupported` error and applies nothing (all-or-nothing). An empty `occurrences` array or an unknown document is a typed `engine-error`. An empty `replacement` is a legal delete (covered glyphs removed, nothing drawn).
8. **Font substitution is reported, not silent.** The replacement is drawn in the payload's `font` when supplied, else `AppSettings.editDefaultFont`, else `Helvetica`, validated by the existing `isEditFont` allowlist (`engine.ts:2451`). Every source font the replacement could not match is named in `substitutedFonts`, and the renderer states the substitution in the report; a source font the engine cannot measure makes that occurrence `skipped`, never a guessed draw.
9. **No regression** to the Find bar, search highlighting/navigation, Phase 10 text edit/delete, annotations, forms/signatures, save/export, Phase 84 redaction, or settings persistence; the feature is fully offline (no network call, nothing leaves the machine).

**Features**

**A. Pure replace geometry + contract (backend-dev).** Add `src/shared/searchReplace.ts` with `collectTextRuns` and `planReplace` over `./redaction`'s tokenizer and `RedactionAdvanceResolver`; add `ReplaceOccurrence`, `ReplaceTextPayload`, `ReplaceSkip`, `ReplaceTextResult` to `src/shared/types.ts` and the new `EngineError` member `'replace-unsupported'` (`types.ts:433-449`); add the `engineReplaceText: "engine:replaceText"` channel (`ipc.ts:215` pattern) and the `replaceText?` method to the `TflexAPI` interface (`ipc.ts:679-693` pattern). Unit tests cover a single-run replace, a substring replace inside a longer run (the untouched prefix/suffix survive byte-for-byte), a replace across a `TJ` array, no-match (content unchanged), a text-mismatch occurrence reported skipped, an unresolvable font, and an empty replacement (delete).

**B. Engine op, IPC + preload (backend-dev).** Add `replaceText` + `_replaceTextImpl` to `src/main/services/engine.ts` modelled on `_applyRedactionsImpl` (`engine.ts:2570`): resolve the visible page (`resolveVisiblePage`, `engine.ts:2438`), validate the payload, take ONE `snapshotDocWithPdf`, decode the page content stream (the existing decode used by redaction), call `planReplace` per occurrence, apply the rewritten stream and draw the replacement anchors (`embedEditFont` / `page.drawText`, `engine.ts:2464-2532`), collect `skipped` and `substitutedFonts`, push undo, mark modified. Wire the `engine:replaceText` channel through `src/main/index.ts` (`:876` pattern) and `src/preload/preload.ts` (`:313` pattern). Unit tests prove: a known term is absent from `extractTextFromRawPdf`/`exportText` after the op and after `serializeDoc` + reopen; a sibling term on the same page and text on other pages is unchanged; a mismatched `find` is skipped and removes nothing; an unresolvable page refuses with `replace-unsupported` and leaves the bytes unchanged; undo restores the pre-replace text; replace-all is one undo entry.

**C. Renderer Replace surface (frontend-dev).** Extend the existing Find surface: add a replace toggle `[data-search-replace-toggle]` to `SearchBar.tsx`, a replacement input `[data-search-replace-input]`, `[data-search-replace-one]`, `[data-search-replace-all]`, and a report line `[data-search-replace-report]`; host them in `DocumentView.tsx` beside the current `SearchBar` render (`:4201`) and pass the existing `hits` / `activeHitIndex`. On replace, map the target hit(s) to page-space rects via the existing `PageView.getTextItems` / `textItemsToGeom` geometry, call `engine.replaceText` through the renderer client, refresh the doc proxy (the `refreshDocProxyFor` hook used by `handleEditTextRun`, `App.tsx:3740-3752`), invalidate the search index (the existing `searchInvalidationTick` path) so stale hits clear, and show `replaced` / `skipped` with reasons in `[data-search-replace-report]`. Extend `engineClient.ts` (`:1337` pattern), the renderer `types.ts` (`:478`) and `stubEngine.ts` (`:924`) with `replaceText`. Unit tests cover the hit-to-rect mapping, the replace-one payload, the replace-all payload, the report text on skipped occurrences, and the disabled/no-hit branches.

**D. Focused QA + adversarial diff-pass (qa, adversary).** qa proves the feature end to end: open a text fixture, find a term, replace one occurrence and assert only that one changed, replace all and assert every occurrence changed and the count matches, save + reload and assert extraction returns the new term and never the old; assert a run the engine cannot bound reports a readable skip and is not changed. The adversary runs a diff-pass on the content-stream replace (a high-risk content-rewrite path): a substring match inside a longer run, a match spanning a `TJ` array, a match across a `q/Q`/`cm` transform, a document with an unresolvable/Type0 font, an empty replacement, the undo/save byte round-trip, and the Find-then-Replace-then-Find sequence, filing ADV entries for confirmed breaks.

**Current-scope supersession:** none - this phase adds search-and-replace, extending the shipped Find; it lifts no earlier exclusion and adds no network.

**Success criteria**

1. A user can search for a term and see every occurrence (the existing search index and Find bar, unchanged), then replace a single occurrence or replace all occurrences across the document; the report states how many were replaced and how many were skipped.
2. Replacement writes real, saved text content: after the op, and again after save + reload, text extraction returns the new term and no longer returns the old term on the changed page, while every other run on that page and on other pages is unchanged; the change survives save/reload.
3. Fail-loud, honest reporting: an occurrence that cannot be safely replaced (font/encoding/geometry) appears in `[data-search-replace-report]` with a readable reason and is never silently dropped; a page whose stream cannot be decoded refuses the whole op with the typed `replace-unsupported` error and applies nothing.
4. Offline only: no network, cloud, accounts or subscriptions; the feature adds no network call.
5. Side-by-side with the existing text-edit flow without regressions to it or to search/navigation: the Find bar, highlighting, next/previous navigation and Phase 10 edit/delete behave exactly as before.
6. Unit tests cover the pure geometry module (`collectTextRuns`, `planReplace`: single/substring/TJ/no-match/mismatch/empty-replacement) and the engine op (extract-after-op, extract-after-save/reload, sibling-unchanged, skip-and-unchanged, refuse-and-unchanged, undo restore, one undo entry for replace-all); e2e covers find -> replace-one -> replace-all -> save -> reload plus the fail-loud skip.
7. All DEF/ADV opened by the phase are CLOSED or REJECTED; phase-close QA returns a verdict per criterion; the phase-close commit stages every Phase 86 change (source, unit tests, e2e spec, ledgers, docs) as ONE local commit by git-agent with no push and no version bump.

**CONTROL-INDEX:** new controls - `[data-search-replace-toggle]` (reveal/hide the replace row; does not change the Find query), `[data-search-replace-input]` (the replacement text), `[data-search-replace-one]` (replace the active occurrence only; commits via `engine.replaceText` with one occurrence), `[data-search-replace-all]` (replace every occurrence across the document; one `engine.replaceText` call and one undo entry), `[data-search-replace-report]` (readable "N replaced, M skipped" plus per-skip reasons - never blank when an action ran). Promised actions proven by the Phase 86 e2e spec: toggle open -> assert the replace row; type a replacement -> replace-one -> assert only the active occurrence changed and the report names the count; replace-all -> assert every occurrence changed; save -> reload -> assert extraction returns the new term and not the old; an unbounded occurrence -> assert `[data-search-replace-report]` names a skip and the occurrence is unchanged.

**Settings impact:** none (no new `AppSettings` field). The replacement font/size/colour default from the existing `AppSettings.editDefaultFont` plus the per-run geometry, so no new settings channel and no new field; the payload's optional `font`/`size`/`color` are per-call overrides only. Offline only; no network call and no credential is ever stored.

