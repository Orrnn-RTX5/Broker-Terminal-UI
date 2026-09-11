param([Parameter(Mandatory=$true)][string]$Screenshot)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class RtxDirectCapture { [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect); [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags); }'
$terminal=Get-Process -Name 'RTX Terminal' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if(-not $terminal){throw 'Desktop terminal unavailable'}
$captureRect=New-Object RtxDirectCapture+RECT
[void][RtxDirectCapture]::GetWindowRect($terminal.MainWindowHandle,[ref]$captureRect)
$captureBitmap=New-Object System.Drawing.Bitmap(($captureRect.Right-$captureRect.Left),($captureRect.Bottom-$captureRect.Top))
$captureGraphics=[System.Drawing.Graphics]::FromImage($captureBitmap)
try {
 $captureDc=$captureGraphics.GetHdc()
 try {if(-not [RtxDirectCapture]::PrintWindow($terminal.MainWindowHandle,$captureDc,2)){throw 'Window capture failed'}}
 finally {$captureGraphics.ReleaseHdc($captureDc)}
 $captureBitmap.Save([System.IO.Path]::GetFullPath($Screenshot),[System.Drawing.Imaging.ImageFormat]::Png)
} finally {$captureGraphics.Dispose();$captureBitmap.Dispose()}
