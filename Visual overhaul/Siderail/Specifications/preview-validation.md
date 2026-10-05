# Siderail preview validation

Rendered in local headless Microsoft Edge and inspected the normal light and narrow dark previews.

Passed: Pages/Edit/Review/Deliver each becomes the single selected workspace and updates the corresponding example panel in both layouts; Settings preserves the selected workspace; panel collapse works separately; reselecting the same workspace retains collapsed state; a different workspace opens its example panel. Both designs render in light/dark and fit 736/520/360/320px without horizontal page overflow. No JavaScript page errors. Literal fragment format/size and token JSON checked.

Computed label contrast: selected light 4.73:1, inactive light 7.96:1, selected dark 6.59:1, inactive dark 8.59:1. All exceed 4.5:1.

Limits: panels contain illustrative static data. Commands report preview outcomes and do not modify documents. Collapse hides example panel content while retaining its header; production must use the established panel primitive, actual canvas sizing and state controller. The expanded design stacks its panel at narrow chat widths; this is not a production desktop-layout prescription. Real session/draft preservation, navigation semantics, forced-colors, Windows DPI/text scaling, short-height scrolling and app shortcuts require implementation checks. Inline uses host Lucide glyphs; offline uses the original shared icon concepts.
