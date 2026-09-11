$ErrorActionPreference='Stop'
$installedTerminalPath='C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\RTX Terminal.exe'
$openTerminals=Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -eq $installedTerminalPath }
foreach($terminal in $openTerminals){
 [void]$terminal.CloseMainWindow()
 if(-not $terminal.WaitForExit(5000)){throw 'Desktop is waiting for its close confirmation'}
}
$previousElectronMode=[Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE','Process')
try {
 [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$null,'Process')
 $start=New-Object Diagnostics.ProcessStartInfo
 $start.FileName=$installedTerminalPath
 $start.WorkingDirectory=Split-Path -Parent $installedTerminalPath
 $start.Arguments='--force-renderer-accessibility'
 $start.UseShellExecute=$true
 $launched=[Diagnostics.Process]::Start($start)
 Write-Output "Desktop reopened normally; PID $($launched.Id)"
} finally {[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$previousElectronMode,'Process')}

