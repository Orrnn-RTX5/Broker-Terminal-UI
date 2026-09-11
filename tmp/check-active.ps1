Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinUtil {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@

$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
foreach ($p in $procs) {
    if ($p.MainWindowTitle -like '*RTX*' -or $p.MainWindowTitle -like '*Achiever*' -or $p.ProcessName -like '*RTX*') {
        Write-Host "Found Window Process:"
        Write-Host "  PID: $($p.Id)"
        Write-Host "  Name: $($p.ProcessName)"
        Write-Host "  Title: $($p.MainWindowTitle)"
        Write-Host "  HWND: $($p.MainWindowHandle)"
        [WinUtil]::ShowWindow($p.MainWindowHandle, 9) # SW_RESTORE
        [WinUtil]::SetForegroundWindow($p.MainWindowHandle)
        Write-Host "  Brought to foreground."
    }
}
