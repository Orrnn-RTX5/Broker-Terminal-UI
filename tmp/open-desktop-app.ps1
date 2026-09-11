$ErrorActionPreference = 'Stop'
$installedTerminalPath = 'C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\RTX Terminal.exe'

# Kill any lingering instances
Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# Re-run silent installer to be 100% sure everything is cleanly placed
$installerPath = Join-Path (Get-Location) 'draft\RTX.Terminal.Setup.1.0.24.exe'
Write-Host "Running installer: $installerPath"
$installer = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -PassThru
$installer.WaitForExit()

Start-Sleep -Seconds 1

# Check hashes
$installedHash = (Get-FileHash -LiteralPath 'C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\resources\app.asar').Hash
$builtHash = (Get-FileHash -LiteralPath (Join-Path (Get-Location) 'draft\win-unpacked\resources\app.asar')).Hash
Write-Host "Installed Hash: $installedHash"
Write-Host "Built Hash:     $builtHash"

if ($installedHash -ne $builtHash) {
    throw "Installed app.asar does not match build!"
}

# Launch interactive desktop app
$previousElectronMode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
try {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $installedTerminalPath
    $start.WorkingDirectory = Split-Path -Parent $installedTerminalPath
    $start.Arguments = '--force-renderer-accessibility'
    $start.UseShellExecute = $true
    $proc = [Diagnostics.Process]::Start($start)
    Write-Host "Successfully launched RTX Terminal (PID $($proc.Id))"
} finally {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $previousElectronMode, 'Process')
}

# Wait for window to show and bring to front
Start-Sleep -Seconds 3
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinUtil {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$terminals = Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
foreach ($t in $terminals) {
    [WinUtil]::ShowWindow($t.MainWindowHandle, 9) # 9 = SW_RESTORE
    [WinUtil]::SetForegroundWindow($t.MainWindowHandle)
    Write-Host "Brought window (HWND $($t.MainWindowHandle)) to foreground"
}
