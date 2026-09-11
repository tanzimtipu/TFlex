# qa helper - compose screenshots/qa-comparison-reference-vs-actual.png (v2,
# fixed label/badge layout). Run: powershell.exe -ExecutionPolicy Bypass -File <this>
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
function Line($g, [string]$text, [System.Drawing.Color]$col, [float]$y) {
    $f = [System.Drawing.Font]::new('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
    $b = [System.Drawing.SolidBrush]::new($col)
    $bg = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(245, 246, 248))
    $g.FillRectangle($bg, 20, ($y - 2), 2560, 26)
    $g.DrawString($text, $f, $b, 26, $y)
    $f.Dispose(); $b.Dispose(); $bg.Dispose()
}

$W = 2600; $H = 1720
$canvas = [System.Drawing.Bitmap]::new($W, $H)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

Label $g 'TFlex frosted-glass comparison - reference mock (left) vs actual build (right)' 30 12 22 ([System.Drawing.Color]::FromArgb(20,25,40)) $true
Label $g 'Method: dev build launched via e2e/lib/launch.cjs; report.pdf at 400% zoom; Tools palette (list) open; OS composited grab (desktopCapturer) with a matching aurora backdrop form behind the window; second grab with a near-black backdrop for the see-through diff. Numbers from e2e/lib/compare_analysis.cjs (qa-comparison-metrics.json).' 30 46 11 ([System.Drawing.Color]::FromArgb(90,100,115)) $false

Label $g 'REFERENCE MOCK (qa-reference-source.png, 1681x936)' 30 88 14 ([System.Drawing.Color]::FromArgb(25,60,160)) $true
Label $g 'ACTUAL BUILD (qa-comparison-actual-desktop.png, aurora backdrop behind the window)' 1290 88 14 ([System.Drawing.Color]::FromArgb(150,30,30)) $true
$ref = Load 'qa-reference-source.png'
DrawScaled $g $ref 30 116 1185 660
$act = Load 'qa-comparison-actual-desktop.png'
$cropRect = [System.Drawing.Rectangle]::new(520, 226, 1520, 940)
$actCrop = $act.Clone($cropRect, $act.PixelFormat)
DrawScaled $g $actCrop 1290 116 1067 660

Line $g 'FAIL tint - mock glass blue: titlebar B-R +124; actual neutral gray: titlebar +8, palette +2.7, rail +27 (over the magenta backdrop region the chrome reads PINK: R>G)' ([System.Drawing.Color]::FromArgb(170,20,35)) 800
Line $g 'FAIL see-through - swapping the backdrop aurora->near-black moves the composite by only: titlebar 5.3, palette 0.2, toolbar 27.4, rail 39.5 (vs 89.5 in the unpainted workspace gutter). The wallpaper is NOT visible through the glass panels.' ([System.Drawing.Color]::FromArgb(170,20,35)) 830
Line $g 'FAIL panel corners - mock: floating cards, ALL 4 corners rounded ~16px, inset 16px with a wallpaper gutter; actual: pages rail flush left (radius 0 16 16 0), tools panel flush right overlay (radius 16 0 0 16). FAIL window corners - mock ~18px rounded, actual square 90 deg (verified top-left + bottom-right).' ([System.Drawing.Color]::FromArgb(170,20,35)) 860
Line $g 'FAIL missing "Pages" header on the pages panel (mock has "Pages" + grid toggle; actual rail top shows only "Undo last change" + thumbnails; DOM leaf texts contain no "Pages").' ([System.Drawing.Color]::FromArgb(170,20,35)) 890
Line $g 'PASS tool entries: icon + bold(600) title + description, 24/24, none clipped. PASS white canvas (page white in both). PASS titlebar glass uniform across the width (B-R 7.6..10.3 in all 12 clean columns).' ([System.Drawing.Color]::FromArgb(15,110,50)) 920
Label $g 'Accepted platform/content differences (not defects): Windows min/max/close + Retry/settings/theme/Open controls vs macOS traffic lights; search behind a toolbar icon + Ctrl+F vs the mock titlebar search field; zoom 400% vs mock 372%; tab label is the harness temp-copy name; tool description texts differ (longer sentences, all fully visible).' 30 952 11 ([System.Drawing.Color]::FromArgb(90,100,115)) $false

$y2 = 986
Label $g 'PAGES PANEL - mock' 30 $y2 12 ([System.Drawing.Color]::FromArgb(20,25,40)) $true
Label $g 'blue floating card, "Pages" header, all corners rounded' 30 1004 9 ([System.Drawing.Color]::FromArgb(90,100,115)) $false
Label $g 'PAGES PANEL - actual' 320 $y2 12 ([System.Drawing.Color]::FromArgb(150,30,30)) $true
Label $g 'flush rail, no header, veil-heavy backdrop tint' 320 1004 9 ([System.Drawing.Color]::FromArgb(90,100,115)) $false
Label $g 'TOOLS PANEL - mock' 670 $y2 12 ([System.Drawing.Color]::FromArgb(20,25,40)) $true
Label $g 'blue frosted card, wallpaper diffuses through' 670 1004 9 ([System.Drawing.Color]::FromArgb(90,100,115)) $false
Label $g 'TOOLS PANEL - actual' 1010 $y2 12 ([System.Drawing.Color]::FromArgb(150,30,30)) $true
Label $g 'near-opaque white overlay, identical across backdrops' 1010 1004 9 ([System.Drawing.Color]::FromArgb(90,100,115)) $false
Label $g 'CORNERS - mock' 1520 $y2 12 ([System.Drawing.Color]::FromArgb(20,25,40)) $true
Label $g 'pages TL / window TL (both rounded)' 1520 1004 9 ([System.Drawing.Color]::FromArgb(90,100,115)) $false
Label $g 'CORNERS - actual' 1820 $y2 12 ([System.Drawing.Color]::FromArgb(150,30,30)) $true
Label $g 'rail TR (16px) / window TL (square)' 1820 1004 9 ([System.Drawing.Color]::FromArgb(90,100,115)) $false
Label $g 'TITLEBAR STRIP - mock' 2130 $y2 12 ([System.Drawing.Color]::FromArgb(20,25,40)) $true
Label $g 'vivid blue frosted' 2130 1004 9 ([System.Drawing.Color]::FromArgb(90,100,115)) $false
Label $g 'TITLEBAR STRIP - actual' 2130 1122 12 ([System.Drawing.Color]::FromArgb(150,30,30)) $true
Label $g 'flat light gray' 2130 1140 9 ([System.Drawing.Color]::FromArgb(90,100,115)) $false

$rp = Load 'ref-panel-pages.png';    DrawScaled $g $rp 30 1030 267 560
$ar = Load 'act-panel-rail.png';     DrawScaled $g $ar 320 1030 316 560
$rt = Load 'ref-panel-tools.png';    DrawScaled $g $rt 670 1030 333 560
$ap = Load 'act-panel-palette.png';  DrawScaled $g $ap 1010 1030 475 560
$rc1 = Load 'ref-corner-pages-topleft.png';    DrawScaled $g $rc1 1520 1030 280 280
$ac1 = Load 'act-corner-rail-topright.png';    DrawScaled $g $ac1 1810 1030 280 187
$rc2 = Load 'ref-corner-window-topleft.png';   DrawScaled $g $rc2 1520 1330 280 280
$ac2 = Load 'act-corner-window-topleft.png';   DrawScaled $g $ac2 1810 1330 280 280
$rst = Load 'ref-strip-titlebar.png';          DrawScaled $g $rst 2130 1030 440 31
$ast = Load 'act-strip-titlebar.png';          DrawScaled $g $ast 2130 1160 440 25

Label $g 'qa evidence set: qa-reference-source.png, qa-comparison-actual-desktop{,-dark}.png, qa-comparison-actual-window.png, qa-comparison-facts{,-dark}.json, qa-comparison-metrics.json, corner/panel crops (ref-corner-*, act-corner-*), panel crops (ref-panel-*, act-panel-*), strip crops. Defects DEF-182..DEF-187.' 30 1612 12 ([System.Drawing.Color]::FromArgb(90,100,115)) $false

$canvas.Save((Join-Path $S 'qa-comparison-reference-vs-actual.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $canvas.Dispose()
Write-Output 'composed screenshots/qa-comparison-reference-vs-actual.png (v2)'