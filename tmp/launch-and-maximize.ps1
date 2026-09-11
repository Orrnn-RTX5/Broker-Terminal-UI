$installedPath = 'C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\RTX Terminal.exe'

# Terminate existing instances first
Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$previousElectronMode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
try {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
    $proc = Start-Process -FilePath $installedPath -WindowStyle Maximized -PassThru
    Write-Host "Started PID $($proc.Id)"
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

# Poll for MainWindowHandle
$foundHandle = [IntPtr]::Zero
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    $terminals = Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
    if ($terminals) {
        foreach ($t in $terminals) {
            $foundHandle = $t.MainWindowHandle
            Write-Host "Found active window HWND: $foundHandle on PID: $($t.Id)"
            [WinUtil]::ShowWindow($foundHandle, 3) # SW_MAXIMIZE
            [WinUtil]::BringWindowToTop($foundHandle)
            [WinUtil]::SetForegroundWindow($foundHandle)
            Write-Host "Successfully brought window to top and maximized!"
        }
        break
    } else {
        Write-Host "Waiting for window creation... ($i)"
    }
}

if ($foundHandle -eq [IntPtr]::Zero) {
    Write-Host "Warning: Window handle was not found within 15 seconds."
}
