$paths = @('HKLM:\Software\Classes\acrobat','HKCU:\Software\Classes\acrobat','HKCR:\acrobat')
foreach ($p in $paths) {
  Write-Output ("== " + $p + " ==")
  if (Test-Path $p) {
    (Get-ItemProperty $p) | Format-List | Out-String | Write-Output
    Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Write-Output $_.Name }
  } else { Write-Output "ABSENT" }
}
Write-Output "== HKLM Classes *acrobat* names =="
Get-ChildItem 'HKLM:\Software\Classes' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like '*acrobat*' } | ForEach-Object { Write-Output $_.PSChildName }
Write-Output "== HKCU Classes *acrobat* names =="
Get-ChildItem 'HKCU:\Software\Classes' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like '*acrobat*' } | ForEach-Object { Write-Output $_.PSChildName }
Write-Output "== HKLM extension defaults =="
foreach ($e in @('.aaui','.bpdx','.fdf','.pdx','.rmf','.sequ','.xdp','.xfdf','.pdf')) {
  $k = 'HKLM:\Software\Classes\' + $e
  if (Test-Path $k) {
    $v = (Get-ItemProperty -Path $k -ErrorAction SilentlyContinue).'(default)'
    Write-Output ($e + " -> " + $v)
  } else { Write-Output ($e + " -> ABSENT") }
}
Write-Output "== HKCU UserChoice for family exts =="
foreach ($e in @('.aaui','.bpdx','.fdf','.pdx','.rmf','.sequ','.xdp','.xfdf','.pdf')) {
  $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\' + $e + '\UserChoice'
  Write-Output ($e + " UserChoice -> " + (Test-Path $k))
}
