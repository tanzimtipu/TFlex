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