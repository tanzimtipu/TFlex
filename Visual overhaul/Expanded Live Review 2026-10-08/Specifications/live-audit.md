# Live audit — Jovrel 1.51.0

Date: 8 October 2026. Installed executable: `C:\Program Files\Jovrel\Jovrel.exe`. Main fixture: bundled `report.pdf`, 34 pages, opened as a copy. P1 means blocked workflow; P2 means confusing, inaccessible or substantially degraded UI; P3 means polish. “Repeated” means previously reported by the user or an earlier audit. “New detail” may extend an existing issue rather than identify a separate root cause. Design refinements are not assertions that the PDF engine is malfunctioning.

## Findings

| ID | Priority | Finding and classification | Evidence |
|---|---|---|---|
| ER01 | P1 | Compact inspector cannot be opened. Repeated AR03, reproduced in Edit text mode. | 16–18 |
| ER02 | P2 | Text inspector requires horizontal scrolling at its normal full-window width; a formatting icon is cut off. New detail. | 14 |
| ER03 | P2 | Compact dock exposes a partial tool label between Text and the right scroll arrow. New detail. | 16 |
| ER04 | P2 | Compact application menu extends beyond the right edge and has a horizontal scrollbar. Repeated. | 04 |
| ER05 | P2 | Home menu offers document operations such as Undo/Redo/Recognize Text as enabled entries. Repeated. | 04 |
| ER06 | P2 | Save a copy remains enabled on an active empty Home tab while Print correctly disables. New state-specific detail. | 15 |
| ER07 | P3 | Brand mark touches the left window edge. Repeated. | 01, 15 |
| ER08 | P3 | Zero-document Home retains an empty white tab band. Repeated. | 01 |
| ER09 | P2 | Continue working metadata does not occupy consistent columns. Repeated. | 01, 15 |
| ER10 | P2 | Bundled fixture recents are marked Missing, including the report just opened through Explore. Repeated AR05, fresh evidence. | 15 |
| ER11 | P3 | Explore fixtures and sample-dependent introductory copy remain in the shipping Home design. Repeated product requirement. | 01, 15 |
| ER12 | P3 | Home background arcs have too little visual presence to establish the logo-based identity. Repeated design refinement, not measured animation failure. | 01, 15 |
| ER13 | P2 | Dock Tools opens a general palette dominated by recent files rather than a dock-oriented tool picker. New detail of the reported More/Tools confusion. | 06 |
| ER14 | P2 | Non-pinnable commands appear in a palette reached through dock Tools; blanket Ctrl+Enter pin help contradicts those rows. New detail. | 07 |
| ER15 | P2 | The customization plus menu and general palette expose substantially different catalogs. New detail; eligibility must be verified against actual handlers. | 08 |
| ER16 | P3 | Reading feature terminology varies between Open comic view, Open reading view and Book View. New detail. | 08, 16 |
| ER17 | P2 | Idle enabled dock/footer controls fade until they resemble disabled controls. Repeated AR06. | 05, 11 |
| ER18 | P3 | Image creation starts with a disproportionately empty dialog body and remote footer. New layout refinement. | 02, 03 |
| ER19 | P2 | Export invalid range message is generic, repeats invalid text, and field accessibility name is the example rather than its purpose. New detail. | 10 |
| ER20 | P2 | All-pages image export previews a single report.png without explaining the 34-file result or naming scheme. New information gap; actual output untested. | 09 |
| ER21 | P3 | Output checks show Not analysed without a clear analysis path or explanation. New information gap. | 09 |
| ER22 | P2 | Primary Export icon is dark on purple and visually weak. Repeated; contrast ratio not measured. | 09 |
| ER23 | P2 | Review repeats Bates/Watermarks/Signatures empty summaries on both sides; Edit defaults to an unexplained CROPBOX / Box — inspector. Repeated contextual-information issue. | 11, 13 |
| ER24 | P2 | Stamp dialog describes two incompatible placement workflows. New confirmed copy defect. | 12 |

## Reproduction and required behavior

### ER01–ER03: panel and dock containment

Open report → Edit → Text, then restore to compact size. The inspector collapses automatically. Click Expand inspector, wait for settled state, and repeat by the visible control at approximately (962,114) in the 985 × 645 capture. Both inputs leave the collapsed inspector unchanged. This independently reproduces the earlier compact-access failure in a new mode. In the same settled state the dock clips the next item to a fragment (“In…”). A previously saved customization includes disabled Open comic view; this review does not assert that it is a factory default.

At maximized size the ordinary 260-value inspector still shows a horizontal scrollbar and clips the far-right formatting control. Reflow into complete groups; do not merely hide overflow and make controls unreachable. Compact panels should open as usable drawers with explicit user-controlled state. Compact docks should show whole items and reveal complete next items through scrolling or overflow.

### ER04–ER06: context and availability

At compact Home, open the right application menu. Its right content crosses the app edge, shortcuts are cropped and a horizontal scrollbar appears. Undo/Redo/Recognize Text are exposed without a document. Command execution was not attempted, so the defect is availability/presentation rather than a proven document mutation.

Open a document, create an empty tab and wait. Print disables with “Open a document to print”; Save a copy remains enabled with Ctrl+Shift+S. Use the active tab's document context, not the existence of a document in another tab, to derive capabilities. Opening/saving behavior was not invoked. Keep Preferences/Help/Open accessible on Home; remove irrelevant document controls from Home chrome and menus as requested by the user.

### ER07–ER12: Home structure

Inspect the initial Home and active empty tab. Brand inset is inadequate; no-document tab band is blank. Rows with Missing badges and extra actions push type/date columns into different positions compared with ordinary rows. Reserve shared column tracks and stable action slots, with a compact alternative below the width threshold.

The report fixture can open through Explore while its recent entry says Missing. Resolve bundled virtual resource identity independently from ordinary filesystem existence. The user wants Explore removed from production; do not leave invalid recent references behind when gating fixtures out. Remove “pick a sample below” copy from production. Give logo arcs a visible but restrained saturated segment or light sweep; screenshot evidence only establishes weak appearance, not whether animation is running. Keep decorative-motion pause separate from global animation settings.

### ER13–ER17: dock and tool discovery

Click dock Tools. The initial palette shows 105 results with 10 Recent entries before tools. Search “Edit stage”; both Edit stage and Edit content remain visible, with pin controls correctly disabled and accessibility descriptions stating they cannot be added. The disabled safeguard works; the problem is exposing unsupported choices in a flow understood as adding dock tools and blanket pin guidance.

Close palette → More → Customize dock → plus. In this session the plus menu lists only Undo, Redo, Open reading view. This differs from the much wider registry exposed by the general palette. Existing pinned tools, stage restrictions and document capabilities may account for some differences: inspect code before changing eligibility. Use one canonical registry and an explicit dedicated Add to dock path; retain non-pinnable commands in the general command palette.

Unify naming only where features are actually the same; Book View and comic reading may be separate modes. Explain distinct modes if so. Do not remove a legitimate user pin simply because its current document is unsupported; show a clear disabled reason or offer a reversible contextual hiding preference.

Idle captures show extreme fading of dock/footer. This is a persistent presentation problem, not proof that commands disable. Available controls should remain legible at rest; focused/hovered states can increase surface emphasis without hiding availability.

### ER18–ER22: task dialogs and export

Home → Create PDF from images with nothing selected: a large blank body separates the few top controls from the footer. Use a deliberate empty/drop state and content-driven size, growing to an ordered thumbnail list after selection. Compact dialog fits and footer remains reachable; preserve that behavior.

Deliver → Custom range → type `1,999` on the 34-page report. Export correctly disables. Error text only says to enter a range between 1 and 34; a second readout echoes `1,999`. Replace that with “Page 999 is outside this document (1–34)” and a validated count when valid. A new untouched custom-range field immediately presents an error; prefer instructional help until blur/submit, with validation after actual editing. Accessibility tree names this field “1-34”; label it “Pages to export” and associate help/error text.

All pages + PNG shows output name report.png. Show selected count and filename/folder strategy, matching actual export semantics. No export was performed, so no filename collision or output-loss defect is claimed. Output checks “Protection: Not analysed” and “Export fidelity: Not analysed” lack a discoverable next step; provide real analysis or explain why information is unavailable. Never fabricate a pass. Export glyph is visually dark against purple; inherit the primary button foreground and measure contrast in implementation.

### ER23–ER24: useful inspector content and accurate copy

Review presents the same empty Bates numbering, Watermarks, Signatures summaries in the left footer and right body. Left should own navigation/list/filter/action discovery; right should inspect the selected object. Avoid duplicate status panels and preserve access to these commands through clear actions.

Edit without a selected object presents CROPBOX, Box, —. Show selection guidance or page summary; expose crop controls only when crop is active, with readable units and scope. Visible PDF text plus “No editable content” does not by itself prove text extraction failure; inspect the actual edit-layer capabilities before claiming one.

Stamp introduction: “After confirming, the next click on a page drops the stamp at that location.” Its page selector/helper simultaneously says the stamp is centered on the picked page at a default size. These are incompatible promises. Match instructions and primary label to the actual implementation; if both modes exist make placement mode explicit. No stamp was committed, so behavior beyond the dialog is unverified.

## Working checks to preserve

- Invalid export range `1,999` blocks export; All pages restores availability.
- Setting export DPI to 0 clamps to 72. Restored to 150.
- Image JPEG quality 0 clamps to 10; do not remove numeric bounds.
- Unsupported palette pins are disabled, not silently accepted.
- Stamp dialog and image creation dialog dismiss with Escape without document edits.
- Empty tab closes and returns to the document after settling.
- Compact image dialog has reachable footer actions.
- Print correctly disables on an active empty tab.

## Limits and next verification

This is broad UI sampling, not exhaustive certification. OCR suspect lists, populated comments, real imports/exports, print output, dark theme switching, long-document performance and multi-monitor/DPI behavior were not exercised in this pass. Earlier book/resize bugs remain regression targets; they are not newly re-confirmed here unless listed above. Do not infer a crash from the initially unavailable development window. A failed UIA click on an off-screen fixture was an automation-bounds error, not an app defect. Transient resize/animation captures were discarded in favor of settled evidence.

Minimum window size: start evaluating **960 × 640 logical DIP** after fixing compact drawers and containment. This is provisional, not a measured guarantee. Verify 100/125/150/200% scaling and available work areas; avoid a minimum that prevents fitting on a user's display. A larger minimum will not fix the maximized text-inspector overflow. Required reflow and page anchoring must work at every supported width.
