Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@

$rtxPids = (Get-Process | Where-Object { $_.Path -like '*rtx-terminal*' -or $_.ProcessName -eq 'RTX Terminal' }).Id
Write-Host "RTX PIDs: $($rtxPids -join ', ')"

$foundWindows = [System.Collections.Generic.List[IntPtr]]::new()

$callback = [WinAPI+EnumWindowsProc]{
    param($hwnd, $lparam)
    if ([WinAPI]::IsWindowVisible($hwnd)) {
        $pid = 0
        [void][WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$pid)
        if ($rtxPids -contains $pid) {
            $sb = New-Object System.Text.StringBuilder 256
            [void][WinAPI]::GetWindowText($hwnd, $sb, $sb.Capacity)
            $title = $sb.ToString()
            Write-Host "Found window HWND: $hwnd PID: $pid Title: '$title'"
            $foundWindows.Add($hwnd)
        }
    }
    return $true
}

[WinAPI]::EnumWindows($callback, [IntPtr]::Zero)

if ($foundWindows.Count -gt 0) {
    $mainHwnd = $foundWindows[0]
    [WinAPI]::ShowWindow($mainHwnd, 9) # SW_RESTORE
    [WinAPI]::SetForegroundWindow($mainHwnd)
    Write-Host "Restored and brought HWND $mainHwnd to foreground."

    Start-Sleep -Milliseconds 500
    $rect = New-Object WinAPI+RECT
    [void][WinAPI]::GetWindowRect($mainHwnd, [ref]$rect)
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    if ($w -gt 100 -and $h -gt 100) {
        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $gfx = [System.Drawing.Graphics]::FromImage($bmp)
        $hdc = $gfx.GetHdc()
        try {
            [void][WinAPI]::PrintWindow($mainHwnd, $hdc, 2)
        } finally {
            $gfx.ReleaseHdc($hdc)
            $gfx.Dispose()
        }
        $bmp.Save('tmp/desktop-live-foreground.png', [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        Write-Host "Saved screenshot to tmp/desktop-live-foreground.png"
    }
}
