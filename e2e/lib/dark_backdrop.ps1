# qa helper - not a test. Solid near-black fullscreen backdrop (rgb 11,16,32)
# used as the SECOND backdrop for the glass see-through diff (DEF-183 retest):
# run dark_backdrop.ps1, then the capture spec with QA_COMP_SUFFIX=-dark, then
# compare the two composited grabs. Kill the process when done.
Add-Type -AssemblyName System.Windows.Forms

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$form.Bounds = $bounds
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(255, 11, 16, 32)
$form.TopLevel = $true
$form.Show()
[System.Windows.Forms.Application]::Run($form)