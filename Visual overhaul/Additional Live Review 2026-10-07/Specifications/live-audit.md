# Additional live audit

Freshly launched C:\Program Files\Jovrel\Jovrel.exe on 7 October 2026. Tested Home, bundled report opening, outline navigation, maximized/restored layouts, panel expansion, Fit Page, extraction validation and Preferences. Captured window sizes were 2560 × 1440 maximized and 981 × 641 restored. These are capture dimensions, not a measurement of CSS viewport or display scaling.

## Findings

| ID | Priority | Observation | Reproduction and evidence |
|---|---|---|---|
| AR-01 | P1 | Resizing loses the visible reading anchor while navigation continues to say page 10. | Open report, choose Chapter 5 / page 10 in Outline, wait for correct content, restore window. The viewport shows a blank lower portion of an earlier page and a subsequent page labelled 9, while navigation and compact rail indicate 10. Remains after another observation. Maximizing recovers Chapter 5. `outline-jump-settled.png`, `resize-anchor-mismatch.png`, `maximized-location-recovers.png`. |
| AR-02 | P1 | Compact navigator expansion does not expose the selected Outline. | At 981 × 641 the full navigator becomes a numbered page rail. Click Expand panel: remains the rail, without outline content. Checked with accessibility-target input and a separate click at the visible button. `compact-expand-no-effect.png`. |
| AR-03 | P1 | Compact inspector expansion does not reveal inspector content. | Click Expand inspector at restored size, then observe again. Remains an empty narrow strip. Checked both accessibility-target and visible-position clicks. `compact-inspector-direct-click.png`. |
| AR-04 | P2 | Fit Page does not recover the intended page location in the resized state. | After AR-01 click Fit Page and observe again: indicator 10, earlier page content still visible. Treat as the same anchor/state family, not a separate rendering-engine diagnosis. `fit-page-keeps-wrong-anchor.png`. |
| AR-05 | P2 | Bundled sample references pollute Recents as missing disk files. | On fresh Home, report, scanned, long and form samples are marked Missing under `samples/...`. The Explore report card opens a working copy. The likely source-identity/resolution problem needs repository confirmation; this does not prove external real files are incorrectly marked missing. `home-sample-recents-missing.png`. |
| AR-06 | P2 | Enabled dock/navigation controls become extremely faint when idle. | Move away from the dock and observe later: available controls resemble disabled controls and are difficult to read. Interaction brightens them. The tree distinguishes disabled Comic View from enabled Extract/Next, but their idle visual appearance is weak. No numeric contrast ratio was measured. This extends the earlier readability concerns. `idle-controls-outline.png`, `maximized-location-recovers.png`. |
| AR-07 | P2 | Out-of-range extraction error describes an empty selection instead of the invalid input. | Enter `999` in a 34-page report's Extract dialog. Extract is correctly disabled, but helper says “Enter at least one page (e.g. 1–3).” It should identify allowed range 1–34 and the invalid token. No extraction submitted. `range-validation-generic.png`. |
| AR-08 | P2 | Theme preference and visible appearance disagree. | Preferences says Dark and says the default applies immediately, while the shell/dialog remain visibly light. Reconfirms a prior observation; no theme setting was changed and no cause was established. `preferences-theme-state-copy.png`. |
| AR-09 | P3 | Animations helper text is ambiguous about checkbox polarity. | Checked Animations has the explanation “Turns off every animation ...”. The label should make clear that checked enables motion and unchecked disables it. `preferences-theme-state-copy.png`. |

## Working checks and limits

The Chapter 5 bookmark correctly reached page 10 after settling at maximized size. Outline selection returned after maximizing, so do not claim its preference was erased permanently. The Extract modal fits the restored window; its out-of-range action is safely disabled. Escape closes Extract and Preferences. Samples open after asynchronous preparation. Immediate captures sometimes show old content during transitions; only the settled resize mismatch is classified as persistent here. No load time or FPS has been measured.

Accessibility-index clicks did not reliably activate Extract after resizing, while clicking its visible position did. That is an automation/geometry uncertainty, not evidence that Extract is broken for ordinary mouse users. Panel expansion was cross-checked with visible clicks and still did not reveal content. Diagnose the actual app event/state path before assigning a root cause.

This was a focused additional pass, not an exhaustive test of every format, screen reader, monitor scale, output operation or pending redesign area. Book View defects remain covered by its separate package. Home's empty strip, sample section and irrelevant controls remain visible, but were already reported and are not counted as new findings here.

## Window minimum recommendation

Keep approximately 960 × 640 logical pixels as a provisional desktop minimum after fixing responsive drawers and anchor preservation. The tested 981 × 641 window is already large enough to host a useful single-page reader with drawers. Raising the minimum to hide these defects would prevent useful smaller-window workflows. Derive the final minimum from the available work area, OS scaling, titlebar/footer and largest essential dialog; clamp to the display work area so the app cannot become larger than a small screen. Validate 100%, 125%, 150% and 200% display scaling during implementation, since those were not tested here.
