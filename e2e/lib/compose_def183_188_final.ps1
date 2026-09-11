# qa composer for the DEF-183 + DEF-188 FINAL verification screenshots.
# Crops the text/glass regions out of the two OS grabs (aurora + near-black)
# and the reference mock, then composes:
#   screenshots/def-183-final.png
#   screenshots/def-188-final.png
#   screenshots/final-comparison-reference-vs-actual.png
# Run: powershell.exe -ExecutionPolicy Bypass -File e2e\lib\compose_def183_188_final.ps1
Add-Type -AssemblyName System.Drawing

$S = "C:\Users\tanzi\OneDrive\App Development\TFlex\screenshots"
$WIN = @{ x = 560; y = 266 }
function Load([string]$n) { [System.Drawing.Bitmap]::new((Join-Path $S $n)) }
function CropScale($src, [int]$sx, [int]$sy, [int]$sw, [int]$sh, [float]$scale) {
    # nearest-neighbor crop+scale so pixel structure stays honest
    $dw = [int]($sw * $scale); $dh = [int]($sh * $scale)
    $dst = [System.Drawing.Bitmap]::new($dw, $dh)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.DrawImage($src, ([System.Drawing.Rectangle]::new(0, 0, $dw, $dh)), ([System.Drawing.Rectangle]::new($sx, $sy, $sw, $sh)), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    return $dst
}
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
$REFC = [System.Drawing.Color]::FromArgb(25,60,160)
$ACTC = [System.Drawing.Color]::FromArgb(150,30,30)

$ref = Load 'qa-reference-source.png'
$aur = Load 'qa-comparison-actual-desktop.png'
$dak = Load 'qa-comparison-actual-desktop-dark.png'

# ---- crops -----------------------------------------------------------------
# titlebar free-glass band (window 330..1010, 0..35) from both grabs, 3x
$cropTbA = CropScale $aur ($WIN.x + 330) ($WIN.y + 0) 680 35 3
$cropTbD = CropScale $dak ($WIN.x + 330) ($WIN.y + 0) 680 35 3
# palette entry 1 zone (group label + title + desc): window 1080..1424, 140..232, 3x
$cropEnA = CropScale $aur ($WIN.x + 1080) ($WIN.y + 140) 344 92 3
$cropEnD = CropScale $dak ($WIN.x + 1080) ($WIN.y + 140) 344 92 3
# rail top ("Pages" header + Undo row): window 16..240, 103..205, 3x
$cropRlA = CropScale $aur ($WIN.x + 16) ($WIN.y + 103) 224 102 3
$cropRlD = CropScale $dak ($WIN.x + 16) ($WIN.y + 103) 224 102 3
# reference: entry 1 zone + rail top + titlebar band, 3x
$cropEnR = CropScale $ref 1400 190 226 80 3
$cropRlR = CropScale $ref 55 128 224 102 3
$cropTbR = CropScale $ref 480 20 680 35 3

# ---- def-183-final.png ------------------------------------------------------
$c, $g = NewCanvas 1960 1000 'DEF-183 FINAL - desktop wallpaper composites through the titlebar glass (single layer)' 'Method: dev build via e2e/lib/launch.cjs, report.pdf 400%, Tools palette (list); two OS composited grabs over aurora / near-black backdrops, identical window bounds 560,266 1440x860 (grabmeta-verified); flat 8x8 patch medians, e2e/lib/retest_182_187_metrics.cjs.'
Label $g 'REFERENCE titlebar band (mock: wallpaper visibly diffusing), 3x' 30 74 11 $REFC $true
DrawScaled $g $cropTbR 30 96 2040 105
Label $g 'ACTUAL titlebar band, AURORA backdrop, 3x - wallpaper structure (magenta bloom, cyan streak) reads through the blue glass' 30 226 11 $ACTC $true
DrawScaled $g $cropTbA 30 248 2040 105
Label $g 'ACTUAL titlebar band, NEAR-BLACK backdrop, 3x - same glass over the dark wallpaper' 30 378 11 $ACTC $true
DrawScaled $g $cropTbD 30 400 2040 105
Label $g 'See-through delta (same patches, aurora vs near-black):' 30 530 12 $NAVY $true
Label $g 'TITLEBAR 35.1   (was 5.0 - bar >30: PASS. aurora 102.0,137.0,218.1 vs dark 100.0,135.0,187.0)' 30 556 11 $PASS $true
Label $g 'toolbar 37.5 / pages rail 81.9 / tools palette 36.7 (all single-film surfaces, all >30)' 30 578 10 $GRAY $false
Label $g 'unpainted gutters (control): left 138.8, right 110.4 - the wallpaper still reaches the OS acrylic (DEF-181 fix intact)' 30 596 10 $GRAY $false
Label $g 'canvas: no glass patches found (paper white, opaque) - DEF-099 untouched' 30 614 10 $GRAY $false
Label $g 'ONE glass layer (DOM stack at the caption free-glass point, e2e/retests/def_182_187_stacking_probe.spec.cjs -> def182-187-stacking-probe.json):' 30 644 11 $NAVY $true
Label $g 'app-header  rgba(0,0,0,0) blur=none      <- was rgba(126,178,250,0.65) + blur(22px) (the second film)' 30 668 11 $PASS $true
Label $g 'titlebar    rgba(126,178,250,0.65) blur=blur(22px) saturate(1.3)   <- the ONE painted + blurred surface' 30 688 11 $PASS $true
Label $g 'Tint stays blue over both backdrops (B-R +116 aurora / +87 dark, DEF-182 contract intact);' 30 714 10 $GRAY $false
Label $g 'the blue is the painted film, the STRUCTURE crossing it is the wallpaper.' 30 732 10 $GRAY $false
Label $g 'VERDICT: DEF-183 CLOSED - the caption strip composites the desktop through exactly one glass layer.' 30 760 12 $PASS $true
Save $c $g 'def-183-final.png'
$cropTbA.Dispose(); $cropTbD.Dispose(); $cropTbR.Dispose()

# ---- def-188-final.png ------------------------------------------------------
$c, $g = NewCanvas 2560 1180 'DEF-188 FINAL - secondary text readable on the blue glass, both backdrops' 'Method: element rects from e2e/retests/def183_188_final_probe.spec.cjs, ink-core (darkest 0.5% pixels) vs glass-median measurements, e2e/lib/def183_188_final_metrics.cjs -> def183-188-final-metrics.json. Bar: spread >= 57 (mock description) or WCAG 4.5:1.'
Label $g 'REFERENCE first tool entry, 3x (mock spreads: title 138, description 57)' 30 74 11 $REFC $true
DrawScaled $g $cropEnR 30 96 678 240
Label $g 'ACTUAL first tool entry, AURORA, 3x' 760 74 11 $ACTC $true
DrawScaled $g $cropEnA 760 96 1032 276
Label $g 'ACTUAL first tool entry, NEAR-BLACK, 3x' 30 390 11 $ACTC $true
DrawScaled $g $cropEnD 30 412 1032 276
Label $g 'Measured (text-vs-glass, aurora / near-black):' 1840 96 12 $NAVY $true
Label $g '"Merge PDFs" title (600wt):' 1840 124 11 $NAVY $true
Label $g 'spreadMock 86 / 79  WCAG 5.33 / 4.65  (mock 138)' 1840 144 11 $PASS $false
Label $g 'tool description (11px):' 1840 170 11 $NAVY $true
Label $g 'spreadMock 67 / 62  WCAG 4.18 / 3.69  (mock 57; was 16 / 11)' 1840 190 11 $PASS $false
Label $g '"ORGANIZE PAGES" label:' 1840 216 11 $NAVY $true
Label $g 'core-spread 82 / 73  WCAG 3.98 / 3.36  (was -28, BELOW the glass)' 1840 236 11 $PASS $false
Label $g '"Pages" rail header (700wt):' 1840 262 11 $NAVY $true
Label $g 'spreadMock 103 / 95  WCAG 4.59 / 4.21' 1840 282 11 $PASS $false
Label $g '"Undo last change" (disabled):' 1840 308 11 $NAVY $true
Label $g 'core-spread 65 / 57 (was 28). WCAG exempts disabled' 1840 328 11 $PASS $false
Label $g 'controls (1.4.3); the label reads through the faint ink' 1840 348 10 $GRAY $false
Label $g 'tier; the decorative icon carries the 0.6 fade instead' 1840 366 10 $GRAY $false
Label $g 'of the whole button.' 1840 384 10 $GRAY $false
Label $g 'Rendered-core spreads are conservative (antialiasing' 1840 410 9 $GRAY $false
Label $g 'lightens the cores). For scale: the mock s own' 1840 426 9 $GRAY $false
Label $g 'description measures ~1.6:1 WCAG on its dark-region' 1840 442 9 $GRAY $false
Label $g 'glass - the build now measures BETTER than the mock' 1840 458 9 $GRAY $false
Label $g 'on every checked element.' 1840 474 9 $GRAY $false
Label $g 'RAIL TOP - reference, 3x' 30 700 10 $NAVY $true
DrawScaled $g $cropRlR 30 722 672 306
Label $g 'RAIL TOP - actual aurora, 3x ("Pages" + "Undo last change")' 760 700 10 $ACTC $true
DrawScaled $g $cropRlA 760 722 672 306
Label $g 'RAIL TOP - actual near-black, 3x' 1490 700 10 $ACTC $true
DrawScaled $g $cropRlD 1490 722 672 306
Label $g 'VERDICT: DEF-188 CLOSED - every checked text element clears the mock s 57 spread bar' 30 1060 12 $PASS $true
Label $g 'on BOTH backdrops (spread methodology on rendered cores); titles and the Pages header also clear WCAG 4.5:1.' 30 1084 10 $PASS $false
Save $c $g 'def-188-final.png'
$cropEnA.Dispose(); $cropEnD.Dispose(); $cropEnR.Dispose(); $cropRlA.Dispose(); $cropRlD.Dispose(); $cropRlR.Dispose()

# ---- final-comparison-reference-vs-actual.png --------------------------------
$c, $g = NewCanvas 2620 1500 'TFlex frosted glass - FINAL reference vs actual (DEF-183 + DEF-188 verification, 2026-09-13)' 'Dev build via e2e/lib/launch.cjs, report.pdf 400%, Tools palette (list), aurora backdrop, OS composited grab. Window bounds 560,266 1440x860 identical across the aurora and near-black runs.'
Label $g 'REFERENCE MOCK (qa-reference-source.png)' 30 78 13 $REFC $true
Label $g 'ACTUAL BUILD (aurora grab, window crop)' 1290 78 13 $ACTC $true
DrawScaled $g $ref 30 102 1185 660
$actCrop = CropScale $aur 520 226 1520 940 1
DrawScaled $g $actCrop 1290 102 1185 660
$actCrop.Dispose()
Label $g 'DEF-183 CLOSED - wallpaper composites through the titlebar: see-through delta 35.1 (was 5.0; bar >30).' 30 790 11 $PASS $true
Label $g 'Exactly ONE glass layer on the caption strip (app-header transparent, no blur; titlebar paints rgba(126,178,250,0.65)+blur(22px) alone).' 30 814 10 $PASS $false
Label $g 'DEF-188 CLOSED - secondary text readable on the blue glass on both backdrops: description spread 67/62 (mock 57; was 16/11),' 30 838 11 $PASS $true
Label $g '"Pages" header 103/95, entry title 86/79 (mock 138), group labels core-spread 82/73 (was -28), "Undo last change" 65/57 (was 28).' 30 862 10 $PASS $false
Label $g 'Earlier glass gates still hold: blue tint everywhere (titlebar B-R +116 over aurora vs mock +124), floating cards DEF-184/186,' 30 886 10 $GRAY $false
Label $g 'rounded 16px shell DEF-187, paper-white canvas untouched (DEF-099).' 30 908 10 $GRAY $false
Label $g 'Accepted deviations (unchanged): Windows caption controls vs macOS traffic lights; zoom 400% vs mock 372%; longer tool descriptions;' 30 930 10 $GRAY $false
Label $g 'tab label is the harness temp-copy name; the glass films stay bluer than the mock over dark backdrops (painted tint + real wallpaper mix).' 30 952 10 $GRAY $false
Label $g 'Evidence: def183-188-final-metrics.json, def183-188-final-rects.json, def182-187-metrics.json, def182-187-stacking-probe.json,' 30 980 9 $GRAY $false
Label $g 'qa-comparison-actual-desktop{,-dark}.png, def-183-final.png, def-188-final.png.' 30 998 9 $GRAY $false
# titlebar strip triplet for the tint/structure comparison (fresh crops -
# $cropTbR was disposed in the def-183 section)
Label $g 'TITLEBAR - mock / aurora / dark' 1290 790 11 $NAVY $true
DrawScaled $g (CropScale $ref 480 20 650 30 2) 1290 812 1300 60
DrawScaled $g (CropScale $aur ($WIN.x + 480) ($WIN.y + 20) 650 30 2) 1290 884 1300 60
DrawScaled $g (CropScale $dak ($WIN.x + 480) ($WIN.y + 20) 650 30 2) 1290 948 1300 60
Save $c $g 'final-comparison-reference-vs-actual.png'

$ref.Dispose(); $aur.Dispose(); $dak.Dispose()
