$ErrorActionPreference='Stop'
$installedTerminalPath='C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\RTX Terminal.exe'
$openTerminals=Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -eq $installedTerminalPath }
foreach($terminal in $openTerminals){
 [void]$terminal.CloseMainWindow()
 if(-not $terminal.WaitForExit(5000)){throw 'Desktop is waiting for its close confirmation'}
}
$installer=Start-Process -FilePath (Join-Path (Get-Location) 'draft\RTX.Terminal.Setup.1.0.24.exe') -ArgumentList '/S' -WindowStyle Hidden -PassThru
$installer.WaitForExit()
if($installer.ExitCode -ne 0){throw "Installer failed: $($installer.ExitCode)"}
$installedHash=(Get-FileHash -LiteralPath 'C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\resources\app.asar').Hash
$builtHash=(Get-FileHash -LiteralPath (Join-Path (Get-Location) 'draft\win-unpacked\resources\app.asar')).Hash
if($installedHash -ne $builtHash){throw 'Installed package does not match the build'}
$previousElectronMode=[Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE','Process')
try {
 [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$null,'Process')
 $start=New-Object Diagnostics.ProcessStartInfo
 $start.FileName=$installedTerminalPath
 $start.WorkingDirectory=Split-Path -Parent $installedTerminalPath
 $start.Arguments='--force-renderer-accessibility --remote-debugging-port=9225 --remote-debugging-address=127.0.0.1'
 $start.UseShellExecute=$true
 $launched=[Diagnostics.Process]::Start($start)
 Write-Output "Installed matching package $installedHash; launched PID $($launched.Id)"
} finally {[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$previousElectronMode,'Process')}

