// Phase 14.1 — the page toolbar is now the COMMAND BAR.
//
// The grouped glass command bar lives in CommandBar.tsx (GlassControlGroup
// capsules: Open / Navigation / Save / Zoom / Tools / Actions). This file
// keeps the historical `Toolbar` name and prop contract as the alias the
// rest of the app (DocumentView + the Phase-13 unit tests) imports — the
// restructuring is additive, so no call site changed shape. The command
// bar adds one prop (`onOpenFile`) for the accent Open button the
// reference places in the command bar instead of the title bar.

import { CommandBar, type CommandBarProps } from './CommandBar';

export type ToolbarProps = CommandBarProps;

export function Toolbar(props: ToolbarProps) {
  return <CommandBar {...props} />;
}