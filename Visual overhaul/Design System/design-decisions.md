# Jovrel visual overhaul — shared decisions

Date: 5 October 2026.

Status: proposed, awaiting user feedback on the first icon direction. Do not treat the recommendation as user approval of every token.

Working direction: **Quiet Precision**. Use restrained graphite surfaces and glyphs, one violet interaction accent, precise rounded geometry and clear text labels. The document remains the visual focal point.

Shared baseline: 4 px spacing unit; 9 px interactive-control radius; 14 px dock radius; Segoe UI Variable with system fallback; 12 px medium tool labels; 140 ms color/surface transitions; reduced-motion support. Icons use a 24-unit grid, round caps/joins and 1.65-unit strokes.

Semantic colors: neutral = ordinary available commands; violet = selected/active; green = verified success; red = actual destructive action/error. Avoid permanent workspace-specific color schemes.

Next categories should inherit `quiet-precision.tokens.json`. Evolve tokens in one place when feedback changes the direction. Do not introduce unrelated icon weights, corner shapes, highlight hues, shadows or motion curves in individual components.

Review outstanding: compare SVGs at smallest production size; confirm ambiguous screenshot controls; inventory all unseen icons; decide whether selected navigation uses a soft surface or a slim rail. Dock layout, panels, brand mark and tabs are future categories.
