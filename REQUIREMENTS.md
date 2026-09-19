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
authorises the OTA release workflow. All other original exclusions remain in force.

Where a later phase sets a visual or motion rule that differs from the general look-and-feel
guidance, the later phase controls for that feature. In particular, Phase 14's glass motion
may use its stated 200–400 ms spring transitions; all unrelated UI keeps the 150–250 ms,
non-bouncy baseline.

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


