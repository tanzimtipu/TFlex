# qa composer for the DEF-182..DEF-187 retest. Builds the per-defect retest
# screenshots + the overall side-by-side from the crops written by
# e2e/lib/retest_182_187_metrics.cjs and the grab/facts from the two capture
# runs. Run: powershell.exe -ExecutionPolicy Bypass -File <this>
Add-Type -AssemblyName System.Drawing

$S = "C:\Users\tanzi\OneDrive\App Development\TFlex\screenshots"
function Load([string]$n) { [System.Drawing.Bitmap]::new((Join-Path $S $n)) }
function DrawScaled($g, $img, [int]$x, [int]$y, [int]$w, [int]$h) {
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, $x, $y, $w, $h)
}
function Label($g, [string]$text, [float]$x, [float]$y, [float]$size, [System.Drawing.Color]$col, [bool]$bold) {
    $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $f = [System.Drawing.Font]::new('Segoe UI', $size, $style)
    $b = [System.Drawing.SolidBrush]::new($col)
    $g.DrawString($text, $f, $b, $x, $y)
    $f.Dispose(); $b.Dispose()
}
function Swatch($g, [int]$x, [int]$y, [int]$r, $gg, $b, [string]$name, [string]$sub) {
    $br = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, [int]$r, [int]$gg, [int]$b))
    $g.FillRectangle($br, $x, $y, 150, 60)
    $br.Dispose()
    Label $g $name $x ($y + 64) 10 ([System.Drawing.Color]::FromArgb(20,25,40)) $true
    Label $g $sub $x ($y + 80) 9 ([System.Drawing.Color]::FromArgb(90,100,115)) $false
}
function NewCanvas([int]$w, [int]$h, [string]$title, [string]$sub) {
    $c = [System.Drawing.Bitmap]::new($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($c)
    $g.Clear([System.Drawing.Color]::White)
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    Label $g $title 30 12 20 ([System.Drawing.Color]::FromArgb(20,25,40)) $true
    Label $g $sub 30 44 10 ([System.Drawing.Color]::FromArgb(90,100,115)) $false
    return @($c, $g)
}
function Save($c, $g, [string]$name) {
    $c.Save((Join-Path $S $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $c.Dispose()
    Write-Output "composed screenshots/$name"
}
$NAVY = [System.Drawing.Color]::FromArgb(20,25,40)
$GRAY = [System.Drawing.Color]::FromArgb(90,100,115)
$PASS = [System.Drawing.Color]::FromArgb(15,110,50)
$FAIL = [System.Drawing.Color]::FromArgb(170,20,35)
$REFC = [System.Drawing.Color]::FromArgb(25,60,160)
$ACTC = [System.Drawing.Color]::FromArgb(150,30,30)

# ---------------- def-182-retest.png : color comparison ----------------
$c, $g = NewCanvas 1520 620 'DEF-182 retest - frosted glass tint: reference blue vs actual' 'Method: dev build via e2e/lib/launch.cjs, report.pdf 400%, Tools palette (list), OS composited grabs over an aurora form backdrop and a near-black form backdrop (identical window bounds 560,266 1440x860); 8x8 flat non-white patch medians, e2e/lib/retest_182_187_metrics.cjs.'
Label $g 'REFERENCE titlebar strip (qa-reference-source.png): mean 125.6,178.4,249.8   B-R +124.2' 30 78 11 $REFC $true
DrawScaled $g (Load 'retest-titlebar-strip-ref.png') 30 98 950 67
Label $g 'ACTUAL titlebar strip, AURORA backdrop: mean 119.1,172.0,246.0   B-R +126.9' 30 185 11 $ACTC $true
DrawScaled $g (Load 'retest-titlebar-strip-aurora.png') 30 205 950 58
Label $g 'ACTUAL titlebar strip, NEAR-BLACK backdrop: mean 118.1,172.0,242.4   B-R +123.9 (tint persists = painted tint, not backdrop bleed)' 30 285 11 $ACTC $true
DrawScaled $g (Load 'retest-titlebar-strip-dark.png') 30 305 950 58
Label $g 'PASS - glass reads blue on every surface: titlebar B-R +126.9, toolbar +110.1, rail +102.8, palette +115.9 (checklist bar: >= 100; reference +124.2).' 30 390 11 $PASS $true
Label $g 'The over-magenta rail region reads BLUE (104.0,125.5,207.5, B-R +103.5) - it read PINK (R>G) when filed. Tint is backdrop-independent on purpose (same blue over aurora and near-black).' 30 412 10 $GRAY $false
Swatch $g 30 445 126 178 250 'reference titlebar' 'mock mean'
Swatch $g 210 445 119 172 246 'actual titlebar (aurora)' 'delta to mock: 14.1 RGB-sum'
Swatch $g 390 445 119 172 242 'actual titlebar (dark)' 'B-R +123.9'
Swatch $g 570 445 107 125 210 'actual rail (aurora)' 'B-R +102.8'
Swatch $g 750 445 97 135 213 'actual palette (aurora)' 'B-R +115.9'
Swatch $g 930 445 104 126 208 'rail over magenta bloom' 'B-R +103.5 - was pink'
Save $c $g 'def-182-retest.png'

# ---------------- def-183-retest.png : transparency check ----------------
$c, $g = NewCanvas 1560 1260 'DEF-183 retest - wallpaper compositing through the glass (aurora vs near-black backdrop)' 'Two OS composited grabs, identical window bounds (560,266 1440x860 verified in grabmeta). See-through delta = sum of |RGB| differences of the glass patch medians. Wallpaper is through rail/palette/toolbar; titlebar still blocked.'
Label $g 'AURORA' 30 74 12 $NAVY $true
Label $g 'NEAR-BLACK' 340 74 12 $NAVY $true
Label $g 'RESULT' 660 74 12 $NAVY $true
Label $g 'PAGES RAIL (floating card interior)' 30 96 10 $GRAY $false
DrawScaled $g (Load 'retest-panel-rail-aurora.png') 30 114 120 380
DrawScaled $g (Load 'retest-panel-rail-dark.png') 340 114 120 380
Label $g 'delta 58.3  PASS' 660 130 12 $PASS $true
Label $g 'glass 107.2,125.1,210.0 (aurora)' 660 152 10 $GRAY $false
Label $g 'vs 91.0,123.0,170.0 (dark)' 660 168 10 $GRAY $false
Label $g 'was 39.5 on contaminated strips;' 660 184 9 $GRAY $false
Label $g 'wallpaper clearly crosses the card' 660 198 9 $GRAY $false
Label $g 'TOOLS PANEL (floating card interior)' 30 510 10 $GRAY $false
DrawScaled $g (Load 'retest-panel-palette-aurora.png') 30 528 180 380
DrawScaled $g (Load 'retest-panel-palette-dark.png') 340 528 180 380
Label $g 'delta 36.7  PASS' 660 544 12 $PASS $true
Label $g 'glass 97.1,135.4,213.0 vs 97.8,130.8,181.6' 660 560 10 $GRAY $false
Label $g 'was 0.2 - bit-identical before the fix' 660 576 9 $GRAY $false
Label $g 'TOOLBAR band: delta 37.5  PASS' 660 600 11 $PASS $true
Label $g 'TITLEBAR (caption strip, free glass)' 30 930 10 $GRAY $false
DrawScaled $g (Load 'retest-titlebar-strip-aurora.png') 30 950 300 18
DrawScaled $g (Load 'retest-titlebar-strip-dark.png') 340 950 300 18
Label $g 'delta 5.0  FAIL' 660 950 12 $FAIL $true
Label $g 'aurora 119.1,172.0,246.0 vs dark 118.1,172.0,242.4' 660 972 10 $GRAY $false
Label $g 'flat film - no wallpaper structure (mock strip shows it).' 660 990 9 $GRAY $false
Label $g 'Cause (DOM probe, def182-187-stacking-probe.json): .app-header AND .titlebar both' 660 1006 9 $GRAY $false
Label $g 'paint rgba(126,178,250,0.65) + blur(22px) at the same point -> effective film ~0.88,' 660 1020 9 $GRAY $false
Label $g 'wallpaper contribution ~12%. One of the two must stop painting.' 660 1034 9 $GRAY $false
Label $g 'Unpainted gutters (control): left delta 138.8, right delta 110.4 - wallpaper reaches the OS acrylic (DEF-181 fix intact).' 30 1060 10 $GRAY $false
Label $g 'VERDICT: OPEN, scope narrowed to the titlebar. Rail 58.3 / toolbar 37.5 / palette 36.7 now composite the wallpaper; the titlebar (delta 5.0) does not.' 30 1085 11 $FAIL $true
Label $g 'DEF-183 stays OPEN for the titlebar double-glass stack; the panel half of the defect is fixed.' 30 1107 10 $GRAY $false
Label $g 'canvas control: paper white unchanged on both backdrops (delta 0 on white patches; DEF-099 untouched)' 30 1130 9 $GRAY $false
Save $c $g 'def-183-retest.png'

# ---------------- def-184-retest.png : floating panels ----------------
$c, $g = NewCanvas 1760 1180 'DEF-184 + DEF-186 retest - floating inset glass cards with wallpaper gutters' 'Left: pages rail. Right: tools panel. Crops from the aurora grab; corner close-ups from both grabs. DOM facts: rail x0=16px y0=103px w=220 h=745 radius 16px; palette x1=1424/1440 (16px inset) radius 16px.'
Label $g 'PAGES RAIL - reference' 30 74 11 $REFC $true
DrawScaled $g (Load 'retest-panel-rail-ref.png') 30 96 205 800
Label $g 'PAGES RAIL - actual (aurora)' 280 74 11 $ACTC $true
DrawScaled $g (Load 'retest-panel-rail-aurora.png') 280 96 240 760
Label $g 'TOOLS PANEL - reference' 570 74 11 $REFC $true
DrawScaled $g (Load 'retest-panel-tools-ref.png') 570 96 262 806
Label $g 'TOOLS PANEL - actual (aurora)' 880 74 11 $ACTC $true
DrawScaled $g (Load 'retest-panel-palette-aurora.png') 880 96 360 760
Label $g 'CORNER + GUTTER CLOSE-UPS (6x)' 1280 74 11 $NAVY $true
DrawScaled $g (Load 'retest-rail-topleft-gutter.png') 1280 96 300 225
DrawScaled $g (Load 'retest-palette-topright-gutter.png') 1280 330 300 225
DrawScaled $g (Load 'retest-rail-bottomleft-gutter.png') 1280 564 285 238
DrawScaled $g (Load 'retest-palette-bottomright-gutter.png') 1280 810 285 238
Label $g 'PASS - pages rail: floating card inset 16px from the LEFT window edge (DOM x0=16px, was flush 0),' 30 910 10 $PASS $true
Label $g 'top gap 24px below the toolbar band (mock ~15px), bottom gap 12px, ALL four corners rounded 16px (was right-only).' 30 928 10 $PASS $false
Label $g 'PASS - tools panel: floating card inset 16px from the RIGHT edge (x1=1424/1440, was flush 1.0), all four corners 16px,' 30 950 10 $PASS $true
Label $g 'and the document canvas now clips BESIDE it (last page pixel x=1067 < panel x0=1080; it previously extended under the panel).' 30 968 10 $PASS $false
Label $g 'PASS - wallpaper gutters visible around both cards (left gutter delta 138.8, right 110.4 across backdrops; close-ups above).' 30 990 10 $PASS $true
Label $g 'Note (accepted minor deviation): rail top gap is 24px vs the mock ~15px; the floating-card geometry itself matches.' 30 1012 9 $GRAY $false
Label $g 'Note: maximized windows keep square corners by design (app-maximized) - the mock depicts a floating window.' 30 1030 9 $GRAY $false
Save $c $g 'def-184-retest.png'

# ---------------- def-185-retest.png : Pages header ----------------
$c, $g = NewCanvas 1500 460 'DEF-185 retest - Pages panel header' 'Rail top band: reference (qa-reference-source.png) vs actual (aurora grab), 3x crops.'
Label $g 'REFERENCE rail top' 30 74 11 $REFC $true
DrawScaled $g (Load 'retest-rail-top-ref.png') 30 96 560 157
Label $g 'ACTUAL rail top (aurora)' 640 74 11 $ACTC $true
DrawScaled $g (Load 'retest-rail-top-aurora.png') 640 96 660 181
Label $g 'PASS - "Pages" label present at the panel top (DOM rail leaf texts now begin with "Pages"); bold dark-navy on glass, matching the mock header style.' 30 300 11 $PASS $true
Label $g 'Accepted minor deviation: the view-toggle (grid/list) row sits BELOW the header, left-aligned; the mock places the grid toggle on the header row top-right.' 30 325 10 $GRAY $false
Label $g 'Thumbnails start below the header + toggle row, above them nothing else - panel identity is unambiguous.' 30 345 10 $GRAY $false
Save $c $g 'def-185-retest.png'

# ---------------- def-187-retest.png : rounded window corners ----------------
$c, $g = NewCanvas 1560 900 'DEF-187 retest - rounded window shell (16px), all four corners' 'Top row from the near-black grab, bottom row from the aurora grab, 8x nearest-neighbor. Edge-inset profiles: insets decay 11px over ~12 rows = 16px radius.'
DrawScaled $g (Load 'retest-corner-window-tl.png') 30 90 360 360
DrawScaled $g (Load 'retest-corner-window-tr.png') 410 90 360 360
DrawScaled $g (Load 'retest-corner-window-bl.png') 30 470 360 360
DrawScaled $g (Load 'retest-corner-window-br.png') 410 470 360 360
Label $g 'top-left (dark backdrop)' 30 456 10 $NAVY $true
Label $g 'top-right (dark backdrop)' 410 456 10 $NAVY $true
Label $g 'bottom-left (aurora backdrop)' 30 836 10 $NAVY $true
Label $g 'bottom-right (aurora backdrop)' 410 836 10 $NAVY $true
Label $g 'PASS - all four corners rounded: inset profile decays from 11px to 0 over ~12 rows' 800 100 11 $PASS $true
Label $g '(16px radius; the mock measures ~18px - within its band). Wallpaper is visible in the' 800 122 11 $PASS $false
Label $g 'corner notches: the shell composites as a rounded floating sheet over the desktop.' 800 144 11 $PASS $false
Label $g 'Implementation: .app border-radius 16px + overflow hidden; the main-process window is' 800 174 10 $GRAY $false
Label $g 'transparent (transparent: true + backgroundMaterial acrylic), so the corners show the' 800 192 10 $GRAY $false
Label $g 'wallpaper, not a painted square. Maximized windows intentionally stay square.' 800 210 10 $GRAY $false
Label $g 'Previous state (DEF-187 as filed): hard 90-degree corners at top-left and bottom-right.' 800 240 10 $GRAY $false
Save $c $g 'def-187-retest.png'

# ---------------- def-188-retest.png : new defect, text contrast ----------------
$c, $g = NewCanvas 1700 560 'DEF-188 (new) - secondary text contrast collapses over the blue glass' 'Found during the DEF-182..187 retest: the fixed glass is now mid-blue over colorful backdrops, but secondary text stayed dark slate -> dark-on-dark.'
Label $g 'REFERENCE first tool entry (title spread 138, description spread 57 - readable)' 30 74 11 $REFC $true
DrawScaled $g (Load 'retest-entry1-ref.png') 30 96 720 168
Label $g 'ACTUAL first tool entry (aurora backdrop): title spread 71, description spread 16' 30 280 11 $ACTC $true
DrawScaled $g (Load 'retest-entry1-aurora.png') 30 302 800 184
Label $g 'Measured (text-vs-glass luma spread, e2e/lib/retest_182_187_contrast.cjs):' 880 96 11 $NAVY $true
Label $g 'description  16 (aurora) / 11 (near-black)   mock 57' 880 120 11 $FAIL $true
Label $g 'title        71 (aurora)                      mock 138' 880 142 11 $GRAY $false
Label $g '"Undo last change" row  28                    mock n/a' 880 164 11 $FAIL $true
Label $g 'The descriptions are barely legible over the blue glass and disappear on the dark' 880 194 10 $GRAY $false
Label $g 'backdrop. Phase-14 criterion: tool text fully visible; the mock keeps muted-but-readable' 880 212 10 $GRAY $false
Label $g 'descriptions on light glass. Fix direction: lighten the glass or lift the muted-foreground' 880 230 10 $GRAY $false
Label $g 'token on frosted (secondary text needs ~4.5:1 against the composited surface).' 880 248 10 $GRAY $false
Label $g 'Also affected: rail "Undo last change" (28), tools group labels over the magenta region.' 880 274 10 $GRAY $false
Save $c $g 'def-188-retest.png'

# ---------------- qa-retest-reference-vs-actual.png : overall ----------------
$c, $g = NewCanvas 2620 1600 'TFlex glass retest 2026-09-13 - reference mock (left) vs actual build (right) - DEF-182..DEF-187' 'Dev build via e2e/lib/launch.cjs, report.pdf 400%, Tools palette (list), aurora backdrop form behind the window, OS composited grab. Window bounds 560,266 1440x860 identical across the aurora and near-black runs.'
Label $g 'REFERENCE MOCK (qa-reference-source.png)' 30 78 13 $REFC $true
Label $g 'ACTUAL BUILD (qa-comparison-actual-desktop.png, window crop)' 1290 78 13 $ACTC $true
DrawScaled $g (Load 'qa-reference-source.png') 30 102 1185 660
$act = Load 'qa-comparison-actual-desktop.png'
$cropRect = [System.Drawing.Rectangle]::new(520, 226, 1520, 940)
$actCrop = $act.Clone($cropRect, $act.PixelFormat)
DrawScaled $g $actCrop 1290 102 1067 660
$actCrop.Dispose(); $act.Dispose()
Label $g 'DEF-182 PASS - tint blue everywhere: titlebar B-R +126.9 vs mock +124.2 (was +8 gray; rail read PINK over magenta).' 30 790 11 $PASS $true
Label $g 'DEF-183 OPEN (narrowed) - wallpaper now crosses rail (58.3), toolbar (37.5), palette (36.7); TITLEBAR still blocked (5.0): .app-header + .titlebar double-paint 0.65 film + blur(22px).' 30 814 11 $FAIL $true
Label $g 'DEF-184 PASS - pages rail is a floating card: inset 16px left, 12px bottom, 24px below the toolbar band, all four corners 16px, wallpaper gutters.' 30 838 11 $PASS $true
Label $g 'DEF-186 PASS - tools panel is a floating card: inset 16px right, all corners 16px, canvas clips beside it (page ends x=1067 < panel x0=1080); backdrop-dependent again (36.7, was 0.2).' 30 862 11 $PASS $true
Label $g 'DEF-185 PASS - "Pages" header present at the rail top (bold dark-navy on glass). DEF-187 PASS - all four window corners rounded ~16px, wallpaper in the notches.' 30 886 11 $PASS $true
Label $g 'DEF-188 NEW - secondary text contrast collapses over the blue glass (description spread 16/11 vs mock 57; "Undo last change" 28): dark-on-dark on every backdrop.' 30 910 11 $FAIL $true
Label $g 'Accepted differences (unchanged from the original comparison): Windows caption controls vs macOS traffic lights; search behind a toolbar icon; zoom 400% vs mock 372%; tab label is the harness temp-copy name; tool descriptions longer than the mock ellipses.' 30 934 10 $GRAY $false
$ry = 970
Label $g 'PAGES RAIL - mock' 30 $ry 11 $NAVY $true
DrawScaled $g (Load 'retest-panel-rail-ref.png') 30 ($ry+22) 145 566
Label $g 'PAGES RAIL - actual' 200 $ry 11 $ACTC $true
DrawScaled $g (Load 'retest-panel-rail-aurora.png') 200 ($ry+22) 160 507
Label $g 'TOOLS PANEL - mock' 390 $ry 11 $REFC $true
DrawScaled $g (Load 'retest-panel-tools-ref.png') 390 ($ry+22) 180 553
Label $g 'TOOLS PANEL - actual' 600 $ry 11 $ACTC $true
DrawScaled $g (Load 'retest-panel-palette-aurora.png') 600 ($ry+22) 235 496
Label $g 'WINDOW CORNERS - actual (TL dark, TR dark, BL aurora, BR aurora)' 870 $ry 11 $NAVY $true
DrawScaled $g (Load 'retest-corner-window-tl.png') 870 ($ry+22) 200 200
DrawScaled $g (Load 'retest-corner-window-tr.png') 1080 ($ry+22) 200 200
DrawScaled $g (Load 'retest-corner-window-bl.png') 870 ($ry+232) 200 200
DrawScaled $g (Load 'retest-corner-window-br.png') 1080 ($ry+232) 200 200
Label $g 'TITLEBAR TINT - mock / aurora / dark' 1320 $ry 11 $NAVY $true
DrawScaled $g (Load 'retest-titlebar-strip-ref.png') 1320 ($ry+22) 560 40
DrawScaled $g (Load 'retest-titlebar-strip-aurora.png') 1320 ($ry+72) 560 34
DrawScaled $g (Load 'retest-titlebar-strip-dark.png') 1320 ($ry+116) 560 34
Label $g 'evidence set: def-182..185+187-retest.png composites, def182-187-metrics.json, def182-187-contrast.json,' 1320 ($ry+170) 9 $GRAY $false
Label $g 'def182-187-stacking-probe.json, qa-comparison-actual-desktop{,-dark}.png, retest-* crops.' 1320 ($ry+186) 9 $GRAY $false
Save $c $g 'qa-retest-reference-vs-actual.png'
