# Thumbnails and Outline

Recommended: Document Navigator, with full-height Pages / Outline views. Alternative: Split Navigator, preserving both views at once.

- Visuals/interactive-navigator-preview.html: offline reference with light / dark and layout controls. Click the Pages / Outline selector, page previews, selection checkboxes, Clear and More to explore the state separation. Action lists are visual references; they do not run document-editing commands. The schematic previews are not real PDF rasters.
- Visuals/navigator-comparison-board.png: Pages, Outline and Split in both themes.
- Specifications/design-decisions.md: installed-app observations, geometry, states, performance, accessibility and acceptance criteria.
- Implementation/orchestrator-prompt.md: complete implementation handoff.
- Assets: two original vector additions, using the established 24-unit / 1.65-stroke icon grammar. The inline reference uses host Lucide icons; the offline export uses these additions and existing icon assets.
- Shared navigator.tokens.json resides in the sibling Design System folder.

Prototype checks validate reference interactions and responsive layout only. Production behavior must be verified in the application as listed in the specification. Panel collapse, separator resizing, document mutation, full hierarchy keyboard navigation and lazy PDF rendering are specified for implementation, not simulated by this reference.
