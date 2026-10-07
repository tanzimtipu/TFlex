# Installed-app inspection and revised plan

I launched the installed Jovrel application and inspected its live UI on 5 October 2026. This is a UI audit of the installed build, not a source audit or a full engine certification. An update to 1.50.0 was offered; the installed version was not verified. The update was dismissed without downloading/installing.

The visual direction remains Quiet Precision with the existing vivid individual-tab proposal. More refinement is needed chiefly in capability preservation, panel ownership and width allocation. The category addenda in this package are authoritative amendments to the earlier orchestrator handoffs. Original visuals remain design references; they do not replace these observed behaviors.

| Priority | Refinement | Reason |
|---|---|---|
| P1 | Correct Home source-type metadata | Non-PDF recents currently display PDF. |
| P1 | Preserve all print controls and dedicated print window | Existing flow is substantially richer than the schematic preview. |
| P1 | Preserve preference categories and application timing | General/Documents/Import & conversion/Storage already exist. |
| P1 | Make split-pane ownership explicit | Multi Mode changes navigators, dock and page-transfer affordances. |
| P1 | Protect tab titles at narrow widths | Two tab titles already truncate while utility controls consume space. |
| P2 | Preserve palette files/view actions, dock pinning and Find/Replace | Palette is broader than tools alone. |
| P2 | Remove duplicated Review lists and empty states | Both side panels repeat the same document information. |
| P2 | Improve form accessible names using real metadata | Generic widget names conceal field meaning. |
| P2 | Replace empty image-creation space with purposeful intake | Actual inputs/quality semantics must remain intact. |
| P2 | Include updater and truthful job boundaries in feedback | An update prompt/badge exists outside the older screenshots. |

Inspection coverage:

- Live: startup/Home, colorful document/empty tabs, preferences (all four categories), initial command palette, bundled one-page form widgets and field count, Review empty state and available commands, Find strip/query entry, dedicated print setup and controls, image-to-PDF empty setup, single-document/Multi Mode transitions with empty pane B, maximized/restored window layouts and dock overflow.
- Earlier run: report sample thumbnail/bookmark navigation and batch-selection behavior, documented in the existing navigator handoff. Those checks were not repeated here.
- Not executed: printing/export, imports with files, clipboard input, OCR/update jobs, actual cancellation/error recovery, FDF/XFDF/CSV round-trips, field edits/save/reopen, populated comments/replies/resolve, object manipulation, cross-document page transfer, two populated panes, large-document find/navigation/replacement, Book View/layout changes, dark/forced colors, screen reader, localization and calibrated DPI tests.

No document values were changed, saved, printed or exported. Preferences were viewed without changes. Opening the bundled form may update the normal recent-file ordering. Multi Mode was returned to single mode; Print and image creation were closed. An empty Home tab was created for inspection. No private recent file was opened.

Implementation sequence:

1. Inventory actual components, commands, settings and capability handlers in the source build being edited. Verify its parity with this installed UI; source may be newer.
2. Apply shared primitives/tokens, preserving command handlers, lifecycle and all existing controls. Correct truthful metadata and accessible labels.
3. Implement width allocation/overflow and panel ownership in single and split modes. Test each target with Find open, both panels and dock, and populated panes.
4. Migrate preference, palette, import and print surfaces using the category amendments. Add extension-only proposals after capability verification.
5. Execute actual fixture-based engine/save/output checks and native DPI/accessibility checks. Return actual app screenshots plus test evidence. Do not claim these checks were completed by this design audit.

Category amendments:

- [Preferences and Themes](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Preferences and Themes/Specifications/live-app-refinements.md>)
- [Search and Command Palette](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Search and Command Palette/Specifications/live-app-refinements.md>)
- [Print and Output](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Print and Output/Specifications/live-app-refinements.md>)
- [Forms and Validation](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Forms and Validation/Specifications/live-app-refinements.md>)
- [Comments and Review](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Comments and Review/Specifications/live-app-refinements.md>)
- [Feedback and Progress](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Feedback and Progress/Specifications/live-app-refinements.md>)
- [Drag Drop and Import](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Drag Drop and Import/Specifications/live-app-refinements.md>)
- [Responsive and Accessibility](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Responsive and Accessibility/Specifications/live-app-refinements.md>)
- [Top Bar and Tabs](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Top Bar and Tabs/Specifications/live-app-refinements.md>)
- [Dock](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Dock/Specifications/live-app-refinements.md>)
- [Panels](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Panels/Specifications/live-app-refinements.md>)
- [Canvas](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Canvas/Specifications/live-app-refinements.md>)
- [Viewing Controls](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Viewing Controls/Specifications/live-app-refinements.md>)
- [Home Screen](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Home Screen/Specifications/live-app-refinements.md>)
- [Selection and Manipulation](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Selection and Manipulation/Specifications/live-app-refinements.md>)
- [Dialogs Toolboxes and Menus](<C:/Users/tanzi/Documents/Codex/2026-10-04/i-x20/outputs/live-app-audit-v1/Dialogs Toolboxes and Menus/Specifications/live-app-refinements.md>)
