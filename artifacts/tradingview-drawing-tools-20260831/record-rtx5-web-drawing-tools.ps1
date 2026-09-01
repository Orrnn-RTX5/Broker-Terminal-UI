param(
  [int]$ChromeProcessId = 20348,
  [string]$OutputDirectory = "C:\Users\ADMIN\rtx5-broker-webterminal-ui\artifacts\tradingview-drawing-tools-20260831\rtx5-web-frames",
  [string]$VideoPath = "C:\Users\ADMIN\rtx5-broker-webterminal-ui\artifacts\tradingview-drawing-tools-20260831\rtx5-web-all-17.mp4",
  [int]$StartOrder = 1,
  [int]$EndOrder = 17,
  [int]$MaxVideoSeconds = 180
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$nativeSource = @'
using System;
using System.Runtime.InteropServices;

public static class RtxDrawingToolsInput {
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int command);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@

Add-Type $nativeSource -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function Move-Pointer {
  param([int]$X, [int]$Y, [int]$Steps = 6)

  $start = [System.Windows.Forms.Cursor]::Position
  for ($index = 1; $index -le $Steps; $index += 1) {
    $nextX = [int]($start.X + (($X - $start.X) * $index / $Steps))
    $nextY = [int]($start.Y + (($Y - $start.Y) * $index / $Steps))
    [RtxDrawingToolsInput]::SetCursorPos($nextX, $nextY) | Out-Null
    Start-Sleep -Milliseconds 8
  }
}

function Click-Point {
  param([int]$X, [int]$Y)

  Move-Pointer -X $X -Y $Y
  Start-Sleep -Milliseconds 90
  [RtxDrawingToolsInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [RtxDrawingToolsInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
}

function Save-Frame {
  param([string]$Name)

  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $target = Join-Path $OutputDirectory ("{0}.png" -f $Name)
    $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$tools = @(
  @{ Order = 1;  Slug = 'trendline';                 MenuY = 255; Points = @(@(520, 320), @(700, 260)) },
  @{ Order = 2;  Slug = 'ray';                       MenuY = 294; Points = @(@(760, 340), @(900, 300)) },
  @{ Order = 3;  Slug = 'info-line';                 MenuY = 332; Points = @(@(980, 360), @(1120, 310)) },
  @{ Order = 4;  Slug = 'extended-line';             MenuY = 370; Points = @(@(1200, 280), @(1360, 360)) },
  @{ Order = 5;  Slug = 'trend-angle';               MenuY = 408; Points = @(@(1440, 360), @(1610, 300)) },
  @{ Order = 6;  Slug = 'horizontal-line';           MenuY = 446; Points = @(,@(880, 420)) },
  @{ Order = 7;  Slug = 'horizontal-ray';            MenuY = 484; Points = @(,@(560, 465)) },
  @{ Order = 8;  Slug = 'vertical-line';             MenuY = 522; Points = @(,@(800, 520)) },
  @{ Order = 9;  Slug = 'crossline';                 MenuY = 560; Points = @(,@(950, 555)) },
  @{ Order = 10; Slug = 'parallel-channel';          MenuY = 637; Points = @(@(500, 610), @(700, 560), @(580, 680)) },
  @{ Order = 11; Slug = 'regression-trend';          MenuY = 675; Points = @(@(760, 650), @(1020, 590)) },
  @{ Order = 12; Slug = 'flat-top-bottom';           MenuY = 713; Points = @(@(1080, 620), @(1260, 660), @(1160, 730)) },
  @{ Order = 13; Slug = 'disjoint-channel';          MenuY = 751; Points = @(@(1360, 620), @(1530, 580), @(1460, 720)) },
  @{ Order = 14; Slug = 'pitchfork';                 MenuY = 827; Points = @(@(570, 760), @(690, 710), @(740, 860)) },
  @{ Order = 15; Slug = 'schiff-pitchfork';          MenuY = 866; Points = @(@(830, 760), @(950, 700), @(1010, 850)) },
  @{ Order = 16; Slug = 'modified-schiff-pitchfork'; MenuY = 904; Points = @(@(1100, 760), @(1220, 700), @(1280, 850)) },
  @{ Order = 17; Slug = 'inside-pitchfork';          MenuY = 942; Points = @(@(1390, 760), @(1510, 700), @(1570, 850)) }
)

$chrome = Get-Process -Id $ChromeProcessId
$windowHandle = $chrome.MainWindowHandle
$ffmpegPath = (Get-Command ffmpeg.exe).Source
$ffmpegArgs = @(
  '-y',
  '-f', 'gdigrab',
  '-framerate', '15',
  '-i', 'desktop',
  '-t', [string]$MaxVideoSeconds,
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-crf', '23',
  '-pix_fmt', 'yuv420p',
  $VideoPath
)

$recorder = New-Object System.Diagnostics.Process
$recorder.StartInfo = New-Object System.Diagnostics.ProcessStartInfo
$recorder.StartInfo.FileName = $ffmpegPath
$recorder.StartInfo.UseShellExecute = $false
$recorder.StartInfo.RedirectStandardInput = $true
$recorder.StartInfo.CreateNoWindow = $true
$recorder.StartInfo.Arguments = ($ffmpegArgs | ForEach-Object { '"{0}"' -f $_ }) -join ' '

[RtxDrawingToolsInput]::ShowWindow($windowHandle, 3) | Out-Null
[RtxDrawingToolsInput]::SetWindowPos($windowHandle, [IntPtr](-1), 0, 0, 0, 0, 3) | Out-Null
[RtxDrawingToolsInput]::SetForegroundWindow($windowHandle) | Out-Null
Start-Sleep -Milliseconds 800
[System.Windows.Forms.SendKeys]::SendWait('^1')
Start-Sleep -Milliseconds 700
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Start-Sleep -Milliseconds 350

$recorder.Start() | Out-Null
Start-Sleep -Seconds 1

try {
  foreach ($tool in ($tools | Where-Object { $_.Order -ge $StartOrder -and $_.Order -le $EndOrder })) {
    Click-Point -X 20 -Y 222
    Start-Sleep -Milliseconds 250
    Click-Point -X 145 -Y $tool.MenuY
    Start-Sleep -Milliseconds 250

    foreach ($point in $tool.Points) {
      Move-Pointer -X $point[0] -Y $point[1]
      Start-Sleep -Milliseconds 250
      Click-Point -X $point[0] -Y $point[1]
      Start-Sleep -Milliseconds 350
    }

    Start-Sleep -Milliseconds 350
    $frameName = "{0:D2}-{1}" -f $tool.Order, $tool.Slug
    Write-Output ("completed {0}" -f $frameName)
  }

  Move-Pointer -X 1810 -Y 940
  Start-Sleep -Milliseconds 700
}
finally {
  if (!$recorder.HasExited) {
    $recorder.StandardInput.WriteLine('q')
    $recorder.StandardInput.Flush()
    if (!$recorder.WaitForExit(20000)) {
      $recorder.Kill()
    }
  }
  Save-Frame -Name '18-all-tools-complete'
  [RtxDrawingToolsInput]::SetWindowPos($windowHandle, [IntPtr](-2), 0, 0, 0, 0, 3) | Out-Null
}
