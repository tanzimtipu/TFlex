param([string]$Mode)

Add-Type -AssemblyName System.Drawing

$shots = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\screenshots"))

if ($Mode -eq "edge") {
  # Crop the palette left-edge zone (x 1400-1750, y 480-680) from both
  # full screenshots: frosted = title continues blurred under the glass,
  # light = title cut off sharply at the opaque edge.
  $crop = New-Object System.Drawing.Rectangle(1580, 480, 340, 220)
  foreach ($t in @("frosted", "light")) {
    $src = [System.Drawing.Image]::FromFile((Join-Path $shots "qa-glass-blur-full-$t.png"))
    $bmp = New-Object System.Drawing.Bitmap($crop.Width, $crop.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $crop.Width, $crop.Height)), $crop, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $bmp.Save((Join-Path $shots "qa-glass-edge-$t.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose(); $src.Dispose()
    Write-Host "saved qa-glass-edge-$t.png"
  }
  # Side-by-side of the two edge crops.
  $a = [System.Drawing.Image]::FromFile((Join-Path $shots "qa-glass-edge-frosted.png"))
  $b = [System.Drawing.Image]::FromFile((Join-Path $shots "qa-glass-edge-light.png"))
  $comboW = [int]($a.Width * 2 + 30)
  $comboH = [int]($a.Height + 40)
  $combo = [System.Drawing.Bitmap]::new($comboW, $comboH)
  $g = [System.Drawing.Graphics]::FromImage($combo)
  $g.Clear([System.Drawing.Color]::White)
  $f = New-Object System.Drawing.Font("Segoe UI", 14)
  $br = [System.Drawing.Brushes]::Black
  $g.DrawImage($a, 0, 40)
  $g.DrawImage($b, ($a.Width + 30), 40)
  $g.DrawString("FROSTED - text diffuses through the glass", $f, $br, 5, 8)
  $g.DrawString("LIGHT - text cut off at the opaque edge", $f, $br, ($a.Width + 35), 8)
  $g.Dispose()
  $combo.Save((Join-Path $shots "qa-glass-edge-comparison.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $combo.Dispose(); $a.Dispose(); $b.Dispose()
  Write-Host "saved qa-glass-edge-comparison.png"
}
elseif ($Mode -eq "themes") {
  # Three themes side by side (full workspace shots, downscaled 50%).
  $names = @("dark", "light", "frosted")
  $imgs = @()
  foreach ($t in $names) { $imgs += [System.Drawing.Image]::FromFile((Join-Path $shots "qa-glass-theme-$t.png")) }
  $w = [int]($imgs[0].Width * 0.5); $h = [int]($imgs[0].Height * 0.5)
  $combo = New-Object System.Drawing.Bitmap(($w * 3 + 40), ($h + 50))
  $g = [System.Drawing.Graphics]::FromImage($combo)
  $g.Clear([System.Drawing.Color]::FromArgb(60, 60, 60))
  $f = New-Object System.Drawing.Font("Segoe UI", 13)
  $labels = @("DARK - opaque near-black", "LIGHT - opaque white", "FROSTED - translucent + blur 22px")
  for ($i = 0; $i -lt 3; $i++) {
    $x = $i * ($w + 20)
    $g.DrawImage($imgs[$i], $x, 45, $w, $h)
    $g.DrawString($labels[$i], $f, [System.Drawing.Brushes]::White, ($x + 8), 10)
  }
  $g.Dispose()
  $combo.Save((Join-Path $shots "qa-glass-themes-side-by-side.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $combo.Dispose()
  foreach ($im in $imgs) { $im.Dispose() }
  Write-Host "saved qa-glass-themes-side-by-side.png"
}
