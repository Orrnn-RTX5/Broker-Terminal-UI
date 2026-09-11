Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinInfo {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hwnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    public delegate bool EnumThreadDelegate(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumThreadWindows(int dwThreadId, EnumThreadDelegate lpfn, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
}
"@

$rtx = Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue
foreach ($p in $rtx) {
    Write-Host "Process PID: $($p.Id)"
    foreach ($thread in $p.Threads) {
        $tid = $thread.Id
        [WinInfo]::EnumThreadWindows($tid, [WinInfo+EnumThreadDelegate]{
            param($h, $lp)
            $rect = New-Object WinInfo+RECT
            [WinInfo]::GetWindowRect($h, [ref]$rect)
            $vis = [WinInfo]::IsWindowVisible($h)
            $iconic = [WinInfo]::IsIconic($h)
            $sb = New-Object System.Text.StringBuilder 256
            [void][WinInfo]::GetWindowText($h, $sb, 256)
            $title = $sb.ToString()
            $w = $rect.Right - $rect.Left
            $h_size = $rect.Bottom - $rect.Top
            Write-Host "  Window HWND: $h TID: $tid Rect: ($($rect.Left), $($rect.Top)) ${w}x${h_size} Vis: $vis Title: '$title'"
            if ($vis -and $w -gt 10 -and $h_size -gt 10) {
                [WinInfo]::ShowWindow($h, 9) # SW_RESTORE
                [WinInfo]::SetWindowPos($h, [IntPtr]::Zero, 50, 50, 1400, 900, 0x0040)
                [WinInfo]::SetForegroundWindow($h)
                Write-Host "  -> Brought to foreground."
            }
            return $true
        }, [IntPtr]::Zero)
    }
}
