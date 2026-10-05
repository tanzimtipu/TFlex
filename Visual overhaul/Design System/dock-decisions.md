# Dock extension to Quiet Precision

Proposed on 5 October 2026; user approval of the visual direction remains pending.

Recommended layout: Focus Dock, a compact floating command surface centered in the document viewport. Alternate: attached Command Shelf using horizontal icon/label pairs. Both share the same registry and tokens.

Carry forward the icon proposal unchanged: graphite at rest, violet for active tools, green for success, red for actual destructive actions; rounded outline vectors; 4 px spacing unit; 14 px dock radius; 9 px button radius; 12 px medium labels; 140 ms state transitions.

New dock commitments: approximately five primary commands, deterministic responsive overflow, stable More/Tools utilities, customization inside More, no detached search banner, measured collision avoidance and scroll-safe bottom spacing. Avoid usage-based automatic reordering and default auto-hide.

The numerical dock extension is in `dock.tokens.json`, which inherits `quiet-precision.tokens.json`. This file adds decisions without replacing or silently approving the prior proposed design system.
