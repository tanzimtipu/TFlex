/**
 * Phase 31 — What's New changelog.
 *
 * Single source of truth for the release notes shown in the About dialog for
 * the RUNNING version. It is bundled into the app, so the notes render with no
 * network call. The OTA feed carries the INCOMING version's notes separately
 * (normalised into `UpdateState.notes` by the update service).
 *
 * Maintenance contract: a release is not releasable without an entry for its
 * package.json version. The release-gate unit test enforces this, and the
 * GitHub Release body for each version is generated from its entry here, so
 * the feed and the installed app show the same content.
 *
 * Ordering: newest first. When cutting a release, add the new entry at the top.
 */

export interface WhatsNewEntry {
  version: string;
  date?: string;
  highlights: string[];
}

/** Ordered newest first. */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '1.49.0',
    date: '2026-10-04',
    highlights: [
      'A single modern button and icon system now runs across the whole app.',
      'Every dialog and auxiliary window shares one shell for a consistent look.',
      'App-wide visual refresh with calmer colour, elevation and empty-state styling.',
      "The action dock's plus picker now lists only tools that can actually run there, and each row you add or grey out can be removed.",
      'Book View no longer flickers when you turn single or spread pages.',
      'The active tab in the tab strip now sits flush and aligned along its top edge.',
      'Edit Text and Add Text now share a symmetric hover box and consistent Cancel, Confirm and Escape behaviour.',
      'The home screen\'s fixed Open tile no longer jiggles in edit mode and is renamed "Open Files".',
    ],
  },
  {
    version: '1.48.0',
    date: '2026-10-03',
    highlights: [
      'True redaction permanently removes whatever you mark, text or a region, from the saved file so it cannot be copied or recovered by text extraction, with a configurable mark colour that is remembered and an honest refusal when it cannot remove something.',
      'The document outline is now editable: add, rename, retarget, nest or un-nest and delete bookmark entries, and your edited outline is saved into the PDF so other readers show it.',
      'Search and replace works across the whole document: replace a single occurrence or every one with real saved text, and the report states exactly what changed and what was skipped.',
      'Remove blank pages by scanning for blank or near-blank pages with an adjustable ink threshold, then delete the confirmed pages in one pass.',
      'Sanitize a PDF to strip active content such as JavaScript, embedded files and launch or open actions, producing a safer file.',
      'Apply sequential Bates numbering with a configurable prefix, suffix, start number, padding and position to the pages you select, and the labels survive save.',
      'Fixed: the Jovrel app icon on the print window.',
    ],
  },
  {
    version: '1.47.0',
    date: '2026-10-02',
    highlights: [
      'Windows now shows the Jovrel icon correctly in every Explorer folder view - Extra large, Large, Medium, Tiles and Content - with crisp native frames instead of stretched or stale art.',
      'Book View reads like a real book: a spine-hinged page flip, spread-aware page numbers, and an animated entry, with a single/two-page layout toggle.',
      'Conversion and 3D notices now render inside the canvas beside Book View and fold away to a small "i" you can reopen.',
      `Encrypted forms render as one Adobe-grade field layer: tick boxes persist reliably and the save report tells the truth about what was skipped.`,
      'Tabs share one calmer size and stronger colours, with a smaller dirty dot that stays visible at the squeezed width.',
      'Dock edit-mode now uses an iOS-style jiggle instead of a vibration.',
    ],
  },
  {
    version: '1.46.0',
    date: '2026-10-01',
    highlights: [
      'The app is now Jovrel: the accent across buttons, selection and focus rings is the Jovrel violet, with a matching app icon and favicon.',
      'New Book View: open any document in a clean, read-only, in-canvas book mode that hides the side rails and action dock so you can read straight through.',
      "Form fields render as a single Adobe-grade layer: values land in the document's own fields with proper appearances, so nothing is drawn on top and other readers show the values.",
      'All colorful tabs now share one size and a calmer colour, so the active tab stays legible and merged into the canvas.',
      'The conversion and 3D notices fold into a small "i" you can click to read again.',
      'Fixed: Preferences aligns each setting\'s label and control in their own columns, and the collapsed protection notice stays pinned to the canvas top-left.',
      "The dock's edit pen now uses the Edit stage colour.",
    ],
  },
  {
    version: '1.45.4',
    date: '2026-10-01',
    highlights: [
      'Drag a tab and it now follows your pointer with the neighbouring tabs animating to open a gap at the drop slot; release outside the bar and the tab tears out translucent, drag it back to reattach.',
      'Tabs got a colourful restyle: 26px height, four rounded corners, and the active tab merges into the canvas with no gap.',
      'Fixed: after dragging a tab to a new position, the active tab could stay hidden at the edge of the squeezed strip - it now scrolls back into view reliably once the drag animation settles.',
      'The Outline panel now keeps its square corner, matching the rest of the window frame.',
    ],
  },
  {
    version: '1.45.3',
    date: '2026-09-30',
    highlights: [
      'The About dialog now closes when you press Escape, like every other dialog in the app.',
      "Reopening a sample document from the Home screen's Recent list now works - it opens the sample instead of showing a 'Could not open file' error.",
    ],
  },
  {
    version: '1.45.2',
    date: '2026-09-30',
    highlights: [
      'Tab titles no longer get selected when you click and drag a tab, and you can now drag a tab from anywhere on it - including tearing it out into its own window.',
      'With many tabs open they shrink and overlap like a browser instead of scrolling, so the active tab always stays visible and clickable.',
      'A protected document\u2019s notice now appears as a rounded card and folds itself into a small "i" after a few seconds; click the "i" any time to read the details again.',
      'Filling forms is now native: values go into the document\u2019s own fields, with proper appearances, instead of being drawn on top - so no field is missed and other readers show the values. Merging form documents no longer scrambles field positions.',
      'Adding or removing tools in a dock or on the Home row now animates, and the dock\u2019s edit button sits inside the dock.',
      'The Ctrl+K tool list no longer shows greyed-out entries you cannot use, and "Page thumbnails" and "Bookmarks" work from it.',
      'Preferences now uses vertical categories with properly aligned labels, and buttons in the panels look like buttons.',
      'Documents open at Fit page, and the outline panel no longer leaves empty space below its last row.',
    ],
  },
  {
    version: '1.45.1',
    date: '2026-09-30',
    highlights: [
      'Document tabs have a new look: a colourful style with a rounded, flat colour on each tab. A switch in Settings brings back the classic style, and every tab is now the same size.',
      'Tabs can be rearranged by dragging, the title text on a tab can be selected and copied, and a tab can be torn out into its own window and dragged back into the tab bar.',
      'Tool docks can be edited: a pen button on the dock lets you remove tools and add any tool that belongs on that dock with one click, and the dock resizes to fit.',
      "The Home screen\u2019s tool row can be edited the same way, with up to 14 tools of your choosing; Open always stays.",
      'Fixed: dragging a non-PDF file onto the window now opens it (Word, Excel, PowerPoint and OpenDocument files, images, comics and e-books were refused before).',
    ],
  },
  {
    version: '1.45.0',
    date: '2026-09-30',
    highlights: [
      'Open far more than PDFs: Word, Excel, PowerPoint and OpenDocument documents, images (PNG, JPEG, TIFF, SVG), and text, Markdown, RTF, CSV and HTML all import as PDFs.',
      'Read e-books and comics in the app: EPUB, MOBI, AZW and CBZ/CBT open in a reading view with chapters, or as pages.',
      'Export a PDF back out: a structural Word (.docx), spreadsheet (.xlsx) or presentation (.pptx) file, or a page or range as PNG or JPEG at 72 to 600 DPI.',
      "Fill a document\u2019s form fields from a CSV spreadsheet in one step.",
      'Engineering PDFs (.pdf/E) list their layers with on/off switches and show their CAD and engineering metadata; 3D content is detected and explained instead of showing a blank page.',
      'Form data can be exported and imported as FDF or XFDF, with a clear report of which field names matched, which did not, and which received no data.',
      'Saving keeps more of the original document: named destinations and the initial view now survive a save.',
      'Check a document before you send it: PDF/A archival and PDF/X print validation report what a file declares and every finding.',
    ],
  },
  {
    version: '1.44.0',
    date: '2026-09-28',
    highlights: [
      'Password-protected PDFs now open: Jovrel asks for the password when one is needed, and you can read and edit the document normally.',
      'The app shows what protection a document carries (the encryption and the permissions it asks for) - it displays them honestly and does not pretend to enforce them.',
      'You can now create password-protected PDFs: AES-256 by default or AES-128, with a choice of permissions. Saving an opened protected file removes the protection, and the app tells you that.',
    ],
  },
  {
    version: '1.43.0',
    date: '2026-09-28',
    highlights: [
      'Editing text is much better: selecting text focuses the text field, dragging moves the text itself, Confirm leaves no duplicate behind, and bold or italic no longer jumps the box back.',
      "The first page's thumbnail no longer runs under the Undo button, and no control is clipped at the panel edge.",
      'PDF tabs are now shown in full colour, and text boxes have thicker rounded borders.',
      'OCR: cancelling actually stops the scan, and the suspects list now lives in the Inspector instead of crowding the context panel.',
      'Sign-in is more reliable: a stale sign-in attempt could block the browser flow.',
      'Opening an encrypted PDF now explains itself clearly instead of showing an unreadable error.',
    ],
  },
  {
    version: '1.42.0',
    date: '2026-09-28',
    highlights: [
      'Sign in from your own browser now - Google opens in your default browser instead of a pop-up window, and Jovrel finishes the sign-in when you come back.',
      "Added a 'Make Jovrel the default PDF app' button in Preferences, so PDFs can show the Jovrel icon and type.",
    ],
  },
  {
    version: '1.41.2',
    date: '2026-09-28',
    highlights: [
      'Google sign-in now completes: the app finishes the sign-in in the background and takes you straight in.',
      'When a sign-in step fails, the app records the exact reason (never any password, token or personal data) so it can be fixed quickly.',
    ],
  },
  {
    version: '1.41.1',
    date: '2026-09-28',
    highlights: [
      'Fixed: Jovrel installed itself inside the old TFlex folder instead of its own. It now installs to C:\\Program Files\\Jovrel, and the leftover folder is cleaned up.',
      'If you already installed 1.41.0 into the wrong folder, this update puts you in the right one.',
    ],
  },
  {
    version: '1.41.0',
    date: '2026-09-27',
    highlights: [
      'TFlex is now Jovrel - the same app with a new name and a new look: the Jovrel mark appears in the title bar, the welcome screen, About and the print window.',
      'Windows sees it as Jovrel too, including the installer, the shortcuts and the PDF file icon.',
      'Your settings, signatures and sign-in carry over automatically - there is nothing to set up again.',
    ],
  },
  {
    version: '1.40.1',
    date: '2026-09-27',
    highlights: [
      'Deleting a signature now removes it from your account as well, not just from this device.',
      'Annotation controls stay inside the page at the edges, and the comment box no longer covers them.',
      'Creating text or a comment no longer opens the comment box by itself - it opens when you select the annotation.',
    ],
  },
  {
    version: '1.40.0',
    date: '2026-09-27',
    highlights: [
      'Google sign-in now finishes properly: the browser window closes by itself and the app picks up your session.',
      'If a sign-in step fails, the app shows the real reason instead of a generic message.',
    ],
  },
  {
    version: '1.39.0',
    date: '2026-09-27',
    highlights: [
      'Sign-up and sign-in work from the installed app now: it can finally reach the account service, and it no longer hides the real reason when something is wrong.',
      'Google sign-in opens the provider in a proper window and returns to the app.',
      'Password reset works, and the account form tells you exactly what to fix (missing name, invalid email, short password).',
    ],
  },
  {
    version: '1.38.0',
    date: '2026-09-27',
    highlights: [
      'Signing in works now - the account window could not reach the server before - and it looks like the rest of TFlex, with a Google button and password reset.',
      'Every file tab has its own colour, and opening Multi View animates.',
      'Create from images: paste an image straight from the clipboard, including a copied file, with a working preview.',
      'Watermark can be placed at an exact X/Y position, and the long tool windows are now squarer and easier to use.',
      "Fixes: 'Edit mode off' is the first edit tool and no longer leaves a neighbour looking selected, and the first thumbnail no longer overlaps Undo.",
    ],
  },
  {
    version: '1.37.0',
    date: '2026-09-27',
    highlights: [
      'Accounts are on by default: sign in with email or Google from the top right, and your preferences and signatures follow you to any device.',
      'Your account now has a proper profile button - your photo, or your initials - with your profile, the sync status and sign-out one click away.',
      "Signature images sync through the app's own secure endpoint, and the database only stores metadata.",
    ],
  },
  {
    version: '1.36.0',
    date: '2026-09-26',
    highlights: [
      'Optional accounts: sign in with email or Google, verify your email, and keep your preferences and signatures in sync across devices.',
      'Accounts are OFF by default in this build - they are being battle-tested before they are switched on for everyone.',
      'Syncing keeps device-specific things local (window size, recent files) and shares only your preferences and signatures.',
    ],
  },
  {
    version: '1.35.0',
    date: '2026-09-26',
    highlights: [
      'The one, two and four-page view now glides between layouts instead of snapping.',
      "Motion is everywhere it belongs: menus, dock buttons, the stage rail and the outline now animate through the app's motion system.",
      'No two different controls share an icon any more - the Multi View toggle and the two-page view are easy to tell apart.',
    ],
  },
  {
    version: '1.34.0',
    date: '2026-09-26',
    highlights: [
      'Every tool now has its own icon - no two tools look alike in the dock or the tool search.',
      'Watermark lives in one place: the Review dock. Pinning it no longer shows it in other stages, and the tool search always names the dock it is pinned to.',
    ],
  },
  {
    version: '1.33.0',
    date: '2026-09-26',
    highlights: [
      'The Inspector now matches the other panels in every theme - no more see-through panel in Edit mode.',
      'The old Edit toolbar is retired: its tools now live in the dock and the Edit panel.',
      'Selected options and the selected page use a softer, professional highlight.',
      'A clean separator between the side rail and the context panel, and a subtle glow in place of the blue line on the Inspector.',
    ],
  },
  {
    version: '1.32.0',
    date: '2026-09-26',
    highlights: [
      'Multi View: the page and zoom controls now sit side by side at the edges of each page.',
      'A new page-layout control at the top-right of the canvas shows one, two or four pages of a document at a time.',
      'Merge PDF can now start from scratch - pick several files and combine them without opening one first.',
      'Every tool in the Ctrl+K palette has a pin button, and the top bar has icons for tool search (Ctrl+K) and find (Ctrl+F).',
      'A calmer, more professional colour system: four semantic colours for icons and text, consistent in all three themes.',
      'The Open label is readable at rest and the top-bar buttons lost their boxes; the Create-from-images window follows the app window size.',
    ],
  },
  {
    version: '1.31.0',
    date: '2026-09-25',
    highlights: [
      'Multi View: the page previews in the thumbnail panel now sit neatly inside their page borders.',
      'Multi View: opening a PDF from either pane always asks which file to open, without moving the divider.',
      'Multi View: the tool dock now appears with a single document open too, and nothing overlaps the thumbnail panel.',
      "Multi View's dock now behaves exactly like single view - the same tools, and the same layout changes as the window narrows.",
    ],
  },
  {
    version: '1.30.0',
    date: '2026-09-25',
    highlights: [
      'TFlex now installs for all users in C:\\Program Files, with its own uninstaller in Settings > Apps.',
      'Bigger, brighter icons and labels, with a colour accent for every tool family - in all three themes.',
      'The text panel now lives only in the Inspector, fixed in place - no more floating panel to drag.',
      'Editing text shows your text at its original size and format, and the text field is ready the moment you select text.',
      'Fixed the violent flicker when a document opened in the second pane of Multi View.',
    ],
  },
  {
    version: '1.29.0',
    date: '2026-09-25',
    highlights: [
      'The tool dock keeps every tool on a single row and reflows as the window narrows - collapsing panels, then labels, then arrows.',
      'The Inspector sits flush against the canvas and puts the text controls at its top.',
      'Editing text keeps your selection visible, with Confirm, Delete and Cancel on the bar.',
      'A narrower thumbnail panel and a flush Outline give the page more room, and the stage rail stays out of the way on the welcome screen.',
      'Printing now opens in its own window.',
      'Multi Mode panes are slimmer and carry the full set of page actions.',
    ],
  },
  {
    version: '1.28.0',
    date: '2026-09-23',
    highlights: [
      'A new workspace organised by stage of work: Pages, Edit, Review and Deliver (Ctrl+1 to Ctrl+4). Pick a stage and the tools for that stage come to you.',
      'An action dock at the bottom of the page offers the next likely steps for whatever you have selected - rotate, extract, sign, export and more - and you can pin your favourites to it.',
      'Press Ctrl+K for a command palette that searches every tool, recent file and action, and learns the ones you use most.',
      'A new inspector on the right shows the properties of whatever is selected, with the actions that apply to it.',
      'Page thumbnails now carry their own quick actions, and a tidier title bar puts Open, Save, Save As, Print and Multi Mode within reach.',
      'Everything that was there before is still here: all 94 tools are reachable in two clicks or from Ctrl+K.',
    ],
  },
  {
    version: '1.27.2',
    date: '2026-09-23',
    highlights: [
      'Zooming now moves the page and its sheet as one piece - the white page outline no longer snaps to the new size before the animation starts.',
      'Restoring TFlex from the taskbar takes a single window transition instead of two, and the app parks its page-rendering work while minimised so it uses less CPU in the background.',
    ],
  },
  {
    version: '1.27.1',
    date: '2026-09-23',
    highlights: [
      'Page zoom is now smooth: the page grows into its new layout instead of snapping inside an already-resized box, and the view stays anchored where you were reading.',
      'Maximising from the minimised state is snappier: the title-bar state now updates with the window instead of lagging behind it.',
    ],
  },
  {
    version: '1.27.0',
    date: '2026-09-22',
    highlights: [
      'The window now behaves like a normal Windows app: double-click the title bar to maximise, drag it to a screen edge to snap, and an auto-hide taskbar pops up as expected.',
      'TFlex now appears as a PDF reader in Windows - choose it in Open with or set it as your default, and double-clicking a PDF opens it (including while TFlex is already running).',
      'Printing to Microsoft Print to PDF now happens entirely inside TFlex - choose where to save and the PDF is created with no extra Windows print window.',
      'The print window can be used as its own window and moved anywhere on the desktop, including outside the TFlex window.',
      'Multi View: one file name per pane instead of two, the tab separator uses a pipe, and undoing a page you moved between files now returns it to its original file.',
      'Smaller fixes: dragging a PDF onto TFlex opens it, zooming animates, and the frosted top bar looks right again.',
    ],
  },
  {
    version: '1.26.0',
    date: '2026-09-22',
    highlights: [
      'Multi Mode: the All Tools panel now resizes both documents equally, and the page area stays usable even at the smallest window size.',
      'Multi Mode shows a single workspace tab instead of two, with both file names on either side of the divider.',
      'The divider between the two documents is now clearly visible and easy to grab.',
      'Dragging a page between documents shows a clear line exactly where the page will land.',
      'The new-document button is disabled while Multi Mode is on (turn the mode off to create one), and closing the workspace always returns you to a real document.',
    ],
  },
  {
    version: '1.25.0',
    date: '2026-09-22',
    highlights: [
      'Multi Mode: view and work on two PDFs side by side in one workspace, with a single toolbar that applies to whichever document you are using.',
      'Drag and drop pages between the two documents - from the thumbnail strip or straight from the page - and hold Ctrl to copy rather than move.',
      'Each document gets its own thumbnail strip in the middle of the workspace, so you always know which pages belong to which file.',
      'Print: the print window can be dragged out of the way, and Vertical page order genuinely stacks the pages while Horizontal prints them side by side.',
      'The page background is now solid in every theme, and Multi Mode shows a single All Tools badge.',
    ],
  },
  {
    version: '1.24.0',
    date: '2026-09-21',
    highlights: [
      'Print your documents: a full print dialog with a live preview - printer, copies and collation, page range, fit/actual/shrink/custom scaling, orientation, duplex and colour.',
      'Print layouts: up to 16 pages per sheet with page order, odd/even pages only, reverse order, and an option to include or leave out annotations.',
      'Start printing from the new title-bar button, File > Print, or Ctrl+P.',
      'Rotating a page is now instant and smooth - the thumbnail no longer flashes blank, and rotated thumbnails render correctly.',
      "About now shows What's New: the highlights of the version you are running, earlier releases, and the notes of an available update.",
    ],
  },
  {
    version: '1.23.1',
    date: '2026-09-21',
    highlights: [
      'Text typed in the properties panel now appears on the page as you type.',
      'Every annotation type - arrows, shapes, notes and text boxes - now moves cleanly in one step, with no ghosts or leftover copies.',
      'Notes and text boxes grow to fit multiple lines instead of clipping.',
      'Annotation colour pickers close as soon as a colour is chosen.',
    ],
  },
  {
    version: '1.23.0',
    date: '2026-09-21',
    highlights: [
      'The text properties panel now floats over the page: drag it anywhere, and opening it no longer shifts the page.',
      'Edit text directly in the panel text field and watch it update on the page as you type.',
      'Adjust character spacing (tracking) for any text.',
      'Choose from new bundled font families, in addition to the three standard fonts.',
      'Move and recolour annotations directly on the page - changes apply immediately, and Cancel undoes them.',
      'Arrow leader lines stop neatly at the arrowhead.',
      'Add comments and replies to annotations; commented items show a small badge.',
      'The page view is now flush with the window edges, reclaiming the empty space around it.',
    ],
  },
  {
    version: '1.22.0',
    date: '2026-09-20',
    highlights: [
      'Annotation text objects (text boxes, callouts and notes) now support the full text-style set: font, size, bold, italic, underline, colour, highlight, alignment and line spacing.',
      'The text properties panel stays open while you place, select or move an annotation.',
      'Highlights on annotations save and reopen cleanly, with no duplicates.',
    ],
  },
  {
    version: '1.21.0',
    date: '2026-09-20',
    highlights: [
      'New Animation off switch in Preferences, for an instant, animation-free interface.',
      'Placing or selecting an annotation no longer closes the text properties panel.',
      'Rounded side panels and cleaner one-piece dropdown menus.',
    ],
  },
  {
    version: '1.20.0',
    date: '2026-09-20',
    highlights: [
      'Open, Save and Save As now sit in the title bar beside the logo, for quicker access.',
      'A new text properties panel brings Word- and Adobe-style text controls, with live updates and clean save-and-reopen.',
      'Smoother motion throughout: menus morph open and closed, and panels and dialogs animate in and out, with support for reduced-motion settings.',
    ],
  },
];

/**
 * Looks up the changelog entry for an EXACT version string. No prefix/suffix
 * fuzzing: '1.23', 'v1.23.0' and '1.23.0 ' all return null. Returns null when
 * absent so the UI can render its explicit "no release notes" empty state.
 */
export function whatsNewFor(version: string): WhatsNewEntry | null {
  return WHATS_NEW.find((entry) => entry.version === version) ?? null;
}

/**
 * The entries OLDER than the running version's, newest first, for the compact
 * history list. The boundary is the entry for the EXACT `version` string: only
 * entries positioned AFTER it in the newest-first list are returned. When the
 * running version has no entry there is no reliable "older than" boundary, so
 * the result is an empty list - never a positional guess, and never newer
 * releases labelled as "Earlier releases". `limit` caps how many are returned;
 * `limit <= 0` returns an empty list.
 */
export function whatsNewHistory(version: string, limit?: number): WhatsNewEntry[] {
  const index = WHATS_NEW.findIndex((entry) => entry.version === version);
  if (index < 0) return [];
  const older = WHATS_NEW.slice(index + 1);
  if (limit === undefined) return older;
  if (limit <= 0) return [];
  return older.slice(0, limit);
}