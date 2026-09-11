$installedPath = 'C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\RTX Terminal.exe'

# Terminate existing instances first
Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$previousElectronMode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
try {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
    $proc = Start-Process -FilePath $installedPath -WindowStyle Maximized -PassThru
    Write-Host "Started RTX Terminal PID: $($proc.Id)"
} finally {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $previousElectronMode, 'Process')
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinUtil {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@

# Wait for window and maximize
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    $terminals = Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
    if ($terminals) {
        foreach ($t in $terminals) {
            Write-Host "Found window HWND: $($t.MainWindowHandle) on PID: $($t.Id). Maximizing and bringing to top..."
            [WinUtil]::ShowWindow($t.MainWindowHandle, 3) # SW_MAXIMIZE
            [WinUtil]::BringWindowToTop($t.MainWindowHandle)
            [WinUtil]::SetForegroundWindow($t.MainWindowHandle)
            Write-Host "Window brought to top!"
        }
        break
    }
}

Write-Host "Terminal is now running in foreground. Keeping background process alive..."
Wait-Process -Id $proc.Id
