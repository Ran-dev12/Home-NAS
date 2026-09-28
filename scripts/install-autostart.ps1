# Start HomeNAS automatically, hidden, whenever you sign in to Windows.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1          # install
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove  # uninstall
#
# Output goes to data\homenas.log. Run `npm run build` once before installing.

param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskName = 'HomeNAS'
$root = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host 'HomeNAS will no longer start automatically.'
  exit 0
}

if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  throw 'Build the web interface first: npm run build'
}
$node = (Get-Command node -ErrorAction Stop).Source
New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null

$command = "Set-Location -LiteralPath '$root'; & '$node' server\index.ts --prod *>> data\homenas.log"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$command`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'HomeNAS home storage server' -Force | Out-Null

Write-Host "HomeNAS will start in the background whenever $env:USERNAME signs in."
Write-Host "Start it now without signing out:  Start-ScheduledTask -TaskName $taskName"
