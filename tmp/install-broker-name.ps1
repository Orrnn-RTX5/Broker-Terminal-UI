$ErrorActionPreference = 'Stop'
$installedTerminalPath = 'C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\RTX Terminal.exe'

Write-Host "Stopping any running RTX Terminal instances..."
Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$installerPath = Join-Path (Get-Location) 'draft\RTX.Terminal.Setup.1.0.24.exe'
Write-Host "Running installer: $installerPath"
$installer = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -PassThru
$installer.WaitForExit()

if ($installer.ExitCode -ne 0) {
    throw "Installer failed with exit code: $($installer.ExitCode)"
}

Start-Sleep -Seconds 2

$installedHash = (Get-FileHash -LiteralPath 'C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\resources\app.asar').Hash
$builtHash = (Get-FileHash -LiteralPath (Join-Path (Get-Location) 'draft\win-unpacked\resources\app.asar')).Hash

Write-Host "Installed app.asar hash: $installedHash"
Write-Host "Built win-unpacked hash: $builtHash"

if ($installedHash -ne $builtHash) {
    throw "Hash mismatch! Installed package was not updated."
}

Write-Host "Launching installed terminal with remote debugging port 9225..."
$previousElectronMode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
try {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $installedTerminalPath
    $start.WorkingDirectory = Split-Path -Parent $installedTerminalPath
    $start.Arguments = '--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1 --force-renderer-accessibility'
    $start.UseShellExecute = $true
    $launched = [Diagnostics.Process]::Start($start)
    Write-Host "Launched RTX Terminal PID: $($launched.Id)"
} finally {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $previousElectronMode, 'Process')
}
