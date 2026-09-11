# qa helper - not a test. Draws a fullscreen borderless aurora backdrop
# (same palette class as the reference mock: deep blue / purple / magenta /
# cyan) so TFlex's frosted glass composites a colorful backdrop behind it.
# Run in a background pwsh process; kill the process when done.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$form.Bounds = $bounds
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(255, 18, 26, 82)
$form.TopLevel = $true
# TopMost: the backdrop must sit above other desktop windows (the qa session
# browser covers the screen) but below the freshly-activated TFlex window.
$form.TopMost = $true

$bmp = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# base vertical gradient: deep blue -> indigo
$rect = New-Object System.Drawing.Rectangle(0, 0, $form.Width, $form.Height)
$base = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
    [System.Drawing.Color]::FromArgb(255, 24, 34, 120),
    [System.Drawing.Color]::FromArgb(255, 46, 36, 140),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillRectangle($base, $rect)

function Add-Blob([int]$cx, [int]$cy, [int]$rx, [int]$ry, [int]$r, [int]$gg, [int]$b, [int]$a) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse($cx - $rx, $cy - $ry, 2 * $rx, 2 * $ry)
    $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
    $pgb.CenterColor = [System.Drawing.Color]::FromArgb($a, $r, $gg, $b)
    $pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $r, $gg, $b))
    $script:g.FillPath($pgb, $path)
    $pgb.Dispose()
    $path.Dispose()
}

# magenta bloom center-left (behind TFlex's left half)
Add-Blob ([int]($form.Width * 0.30)) ([int]($form.Height * 0.45)) 520 420 232 92 208 235
# deep pink lower-left
Add-Blob ([int]($form.Width * 0.12)) ([int]($form.Height * 0.80)) 380 320 255 110 170 200
# cyan streak upper-right
Add-Blob ([int]($form.Width * 0.78)) ([int]($form.Height * 0.22)) 460 260 92 208 255 235
# purple right-mid
Add-Blob ([int]($form.Width * 0.88)) ([int]($form.Height * 0.62)) 420 340 130 92 235 215
# violet top-center
Add-Blob ([int]($form.Width * 0.52)) ([int]($form.Height * 0.08)) 420 240 150 110 250 210
# teal bottom-right
Add-Blob ([int]($form.Width * 0.70)) ([int]($form.Height * 0.92)) 380 280 60 190 235 200

$g.Dispose()
$form.BackgroundImage = $bmp
$form.Show()
[System.Windows.Forms.Application]::Run($form)
