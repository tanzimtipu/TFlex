# qa helper: crop a region of a PNG and upscale it for visual inspection.
# Usage: pwsh -File crop_png.ps1 -Src <png> -X <int> -Y <int> -W <int> -H <int> -Scale <float> -Out <png>
param(
    [Parameter(Mandatory = $true)][string]$Src,
    [Parameter(Mandatory = $true)][int]$X,
    [Parameter(Mandatory = $true)][int]$Y,
    [Parameter(Mandatory = $true)][int]$W,
    [Parameter(Mandatory = $true)][int]$H,
    [double]$Scale = 1.0,
    [Parameter(Mandatory = $true)][string]$Out
)
Add-Type -AssemblyName System.Drawing
$srcImg = [System.Drawing.Bitmap]::new($Src)
$rect = [System.Drawing.Rectangle]::new($X, $Y, $W, $H)
$crop = $srcImg.Clone($rect, $srcImg.PixelFormat)
$dw = [int][math]::Round($W * $Scale)
$dh = [int][math]::Round($H * $Scale)
$up = [System.Drawing.Bitmap]::new($dw, $dh)
$g = [System.Drawing.Graphics]::FromImage($up)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.DrawImage($crop, 0, 0, $dw, $dh)
$g.Dispose()
$up.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$up.Dispose()
$crop.Dispose()
$srcImg.Dispose()
Write-Output "saved $Out ($dw x $dh)"