# Colorful tab revision

User preference: every new tab has its own tasteful modern color. Earlier recommendations to remove automatic tab colors are replaced by stable session color identities. See tab-identity.tokens.json and the rewritten design specification/orchestrator prompt. Rich colors are scoped to tabs; this does not introduce rainbow dialogs or menus.

Inactive tabs use 20% identity tints; active tabs use full identity color and a contrasting inset keyline. Colors survive rename, reorder, overflow and restoration. Allocate unused identities first. Extend with verified variants after palette exhaustion, preserving readable filenames and status labels. The twelve-color demo cycles only after exhaustion; its allocator is not production code.
