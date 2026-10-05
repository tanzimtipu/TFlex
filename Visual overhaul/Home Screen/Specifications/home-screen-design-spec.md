# Home Screen — Orbit Desk

Recommended design: Orbit Desk. Alternative: Library Welcome, a shorter introduction followed by a full-width recent list and sample row. Continue the shared Quiet Precision surfaces, violet controls and colorful document tabs. The home screen is an application workspace, not a marketing landing page; opening and resuming documents must be the fastest path.

## Brand character

The supplied screenshots show a dark rounded-square Jovrel mark with a circular violet/amber motif. Use that circular geometry as inspiration for thin open concentric arcs at the edge of the home header. Pair violet with restrained amber solely in this brand illustration. Keep text and interactive controls on opaque, contrast-safe surfaces. Do not apply rainbow colors to recent rows or make primary actions change hue.

The mock uses the product name and an original CSS orbit illustration, not a reconstructed logo. Production must inspect and reuse the repository's actual logo/wordmark assets and derive precise brand colors from them. The screenshot only supports an approximate motif; don't replace, distort or animate the logo itself. Use a small original logo next to the existing brand name in chrome where appropriate; avoid a giant repeated logo in the page.

## Composition

Use a centered, fluid content region, approximately 1040–1200 logical px maximum at wide desktop sizes, with 32px normal padding and 18–24px constrained padding. The header contains a short title, one sentence and three actions: Open files (primary), From images and Merge PDFs (secondary, preserving actual commands). “A clear space for your documents” is proposed copy, not a mandatory product tagline. Avoid user names/account claims unless actual identity is present. Main action remains visible without scrolling at the supported desktop window size.

Below: an asymmetric 1.6:1 layout with Continue working on the left and Explore Jovrel on the right. Recent rows show real basename, useful containing-folder shorthand, actual source/working format and relative opened time. Resume the real document/session using existing behavior. Full location belongs in accessible description/tooltip/details, not a row of long paths. Duplicate basenames need enough location context to distinguish them. Do not label XLSX/DOC/image source files “PDF” unless describing an actual converted result separately. Handle unavailable/moved files with a truthful recovery path, and preserve recent-list privacy/removal behavior.

Samples are task-oriented: Read and navigate, Try form fields, Explore recognition. Their previews must be real rendered first pages or an honest fallback based on file type; do not use generic sparkle tiles. Open sample copies using existing sample semantics so exploration does not accidentally overwrite bundled assets. The mock's lines, example filenames and timestamps are schematic fixtures, not actual user history or rendered PDF previews.

Respect existing commands absent from the mock: update checking, customize-home affordances, additional import actions, preferences and account remain reachable in their approved application-menu/top-bar locations. Home does not create new file converters. Drag/drop may be surfaced only with the app's real supported input types and behavior. Empty recent state should show a concise invitation and the same useful actions/samples; do not leave a blank table or fabricate document history. If samples aren't available, offer actual supported workflows rather than nonexistent fixtures.

## Subtle motion

Use thin decorative violet/amber arcs with about 0.18–0.28 opacity, behind and beside the header, never behind text at full intensity. Recommended slow 18-second easing cycle moving through roughly 20 degrees, rather than a complete distracting rotation or a fast hue loop. Use transforms on a small decorative layer; don't animate layout, text, file thumbnails, buttons or document contents. Avoid animated filters, large blur layers and continuous canvas redraws. Static shape remains attractive when animation is disabled.

Respect prefers-reduced-motion and the existing application/OS animation setting immediately. Provide a discoverable way to pause decorative motion if retained as a persistent animation. Suspend animation when Home is not visible, the window is hidden/minimized or the app's power/performance policy requests it; resume according to user preference, never override a pause. Screen-reader output ignores decorative arcs. The preview includes Pause/Resume motion and reduced-motion CSS; production needs visibility/app-lifecycle integration and actual settings persistence.

## Implementation and acceptance

Reuse home routing, file open/create/merge commands, recent store and sample registry. Build a shared recent-row/sample-preview component rather than a parallel data store. Preserve tabs/session state when visiting Home. Connect all visible actions to actual handlers and capabilities. No new account/network requirements for a local start page. Use the Typography tokens and Buttons/Dialogs specifications for interactions.

Check populated/empty/missing-file history, duplicate names, source-format truth, actual sample assets, errors, long filenames/localization, keyboard/screen-reader operation, light/dark, text/DPI scaling and supported restored window bounds. Check motion pause, reduced motion, app visibility and absence of expensive repaints. Capture resulting screenshots with the actual logo and thumbnails. The standalone preview is a design reference, not production code or final brand artwork.


Supporting text refinement: use #667085 in light mode instead of the earlier #70798A muted token for small body/helper text. This raises contrast on both white and #F5F6F8 surfaces. Apply this by semantic text role; do not indiscriminately recolor disabled icons or document content.
