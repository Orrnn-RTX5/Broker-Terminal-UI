$installedTerminalPath = 'C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\RTX Terminal.exe'
$previousElectronMode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
try {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $installedTerminalPath
    $start.WorkingDirectory = Split-Path -Parent $installedTerminalPath
    $start.Arguments = '--force-renderer-accessibility'
    $start.UseShellExecute = $true
    $proc = [Diagnostics.Process]::Start($start)
    Write-Host "Started RTX Terminal PID: $($proc.Id)"
} finally {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $previousElectronMode, 'Process')
}

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
    Write-Host "Window found: HWND $($t.MainWindowHandle) Title: '$($t.MainWindowTitle)'"
    [WinUtil]::ShowWindow($t.MainWindowHandle, 9)
    [WinUtil]::SetForegroundWindow($t.MainWindowHandle)
}

# Keep the script alive so background task manager doesn't kill the child process
Wait-Process -Id $proc.Id
