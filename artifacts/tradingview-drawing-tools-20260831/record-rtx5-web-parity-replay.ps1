param(
  [int]$ChromeProcessId = 20348,
  [string]$OutputDirectory = "C:\Users\ADMIN\rtx5-broker-webterminal-ui\artifacts\tradingview-drawing-tools-20260831\account-200001\rtx5-parity-final-frames",
  [string]$VideoPath = "C:\Users\ADMIN\rtx5-broker-webterminal-ui\artifacts\tradingview-drawing-tools-20260831\account-200001\rtx5-parity-all-17-account-200001-verified.mp4",
  [string]$BrowserTabShortcut = '^2',
  [int]$MaxVideoSeconds = 180,
  [int]$TimeframeButtonX = 771
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$nativeSource = @'
using System;
using System.Runtime.InteropServices;

public static class RtxParityReplayInput {
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
  param([int]$X, [int]$Y, [int]$Steps = 8)

  $start = [System.Windows.Forms.Cursor]::Position
  for ($index = 1; $index -le $Steps; $index += 1) {
    $nextX = [int]($start.X + (($X - $start.X) * $index / $Steps))
    $nextY = [int]($start.Y + (($Y - $start.Y) * $index / $Steps))
    [RtxParityReplayInput]::SetCursorPos($nextX, $nextY) | Out-Null
    Start-Sleep -Milliseconds 12
  }
}

function Click-Point {
  param([int]$X, [int]$Y)

  Move-Pointer -X $X -Y $Y
  Start-Sleep -Milliseconds 120
  [RtxParityReplayInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [RtxParityReplayInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
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

# These coordinates are measured replay inputs for the current 1920x1080 QA viewport.
# They are evidence automation only and are never imported by the application runtime.
$tools = @(
  @{ Order = 1;  Slug = 'trendline';                 MenuY = 255; Points = @(@(500, 320), @(680, 265)) },
  @{ Order = 2;  Slug = 'ray';                       MenuY = 294; Points = @(@(740, 345), @(890, 295)) },
  @{ Order = 3;  Slug = 'info-line';                 MenuY = 332; Points = @(@(950, 365), @(1100, 310)) },
  @{ Order = 4;  Slug = 'extended-line';             MenuY = 370; Points = @(@(1170, 300), @(1330, 365)) },
  @{ Order = 5;  Slug = 'trend-angle';               MenuY = 408; Points = @(@(1410, 370), @(1580, 315)) },
  @{ Order = 6;  Slug = 'horizontal-line';           MenuY = 446; Points = @(,@(1210, 440)) },
  @{ Order = 7;  Slug = 'horizontal-ray';            MenuY = 484; Points = @(,@(590, 475)) },
  @{ Order = 8;  Slug = 'vertical-line';             MenuY = 522; Points = @(,@(810, 520)) },
  @{ Order = 9;  Slug = 'crossline';                 MenuY = 560; Points = @(,@(970, 555)) },
  @{ Order = 10; Slug = 'parallel-channel';          MenuY = 637; Points = @(@(500, 610), @(690, 560), @(575, 650)) },
  @{ Order = 11; Slug = 'regression-trend';          MenuY = 675; Points = @(@(1030, 610), @(1510, 570)) },
  @{ Order = 12; Slug = 'flat-top-bottom';           MenuY = 713; Points = @(@(1030, 600), @(1210, 630), @(1110, 650)) },
  @{ Order = 13; Slug = 'disjoint-channel';          MenuY = 751; Points = @(@(1360, 600), @(1530, 570), @(1440, 650)) },
  @{ Order = 14; Slug = 'pitchfork';                 MenuY = 827; Points = @(@(520, 500), @(660, 430), @(660, 650)) },
  @{ Order = 15; Slug = 'schiff-pitchfork';          MenuY = 866; Points = @(@(790, 500), @(930, 430), @(930, 650)) },
  @{ Order = 16; Slug = 'modified-schiff-pitchfork'; MenuY = 904; Points = @(@(1060, 500), @(1200, 430), @(1200, 650)) },
  @{ Order = 17; Slug = 'inside-pitchfork';          MenuY = 942; Points = @(@(1330, 500), @(1470, 430), @(1470, 650)) }
)

$chrome = Get-Process -Id $ChromeProcessId
$windowHandle = $chrome.MainWindowHandle
$interferingWindow = Get-Process -Name 'YO HRMX' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($interferingWindow -and $interferingWindow.MainWindowHandle -ne 0) {
  [RtxParityReplayInput]::ShowWindow($interferingWindow.MainWindowHandle, 6) | Out-Null
}
$ffmpegPath = (Get-Command ffmpeg.exe).Source
$ffmpegArgs = @(
  '-y',
  '-f', 'gdigrab',
  '-framerate', '5',
  '-i', 'desktop',
  '-t', [string]$MaxVideoSeconds,
  '-loglevel', 'error',
  '-nostats',
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

[RtxParityReplayInput]::ShowWindow($windowHandle, 3) | Out-Null
[RtxParityReplayInput]::SetWindowPos($windowHandle, [IntPtr](-1), 0, 0, 0, 0, 3) | Out-Null
[RtxParityReplayInput]::SetForegroundWindow($windowHandle) | Out-Null
Start-Sleep -Milliseconds 800
[System.Windows.Forms.SendKeys]::SendWait($BrowserTabShortcut)
Start-Sleep -Milliseconds 900
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Start-Sleep -Milliseconds 350

# Keep the replay on the verified XAUUSD M1 chart. The active overlay is cleaned
# and checked separately before this evidence-only recorder starts.
Click-Point -X $TimeframeButtonX -Y 140
Start-Sleep -Seconds 4
Save-Frame -Name '00-clean-xauusd-m1'

$recorder.Start() | Out-Null
Start-Sleep -Seconds 1
$replayTimer = [System.Diagnostics.Stopwatch]::StartNew()

try {
  foreach ($tool in $tools) {
    Click-Point -X 20 -Y 222
    Start-Sleep -Milliseconds 350
    Click-Point -X 145 -Y $tool.MenuY
    Start-Sleep -Milliseconds 350

    foreach ($point in $tool.Points) {
      Move-Pointer -X $point[0] -Y $point[1]
      Start-Sleep -Milliseconds 300
      Click-Point -X $point[0] -Y $point[1]
      Start-Sleep -Milliseconds 450
    }

    Start-Sleep -Milliseconds 500
    $frameName = "{0:D2}-{1}" -f $tool.Order, $tool.Slug
    Write-Output ("captured {0} at {1:N2}s" -f $frameName, $replayTimer.Elapsed.TotalSeconds)
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Start-Sleep -Milliseconds 250
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
  [RtxParityReplayInput]::SetWindowPos($windowHandle, [IntPtr](-2), 0, 0, 0, 0, 3) | Out-Null
  if ($interferingWindow -and $interferingWindow.MainWindowHandle -ne 0) {
    [RtxParityReplayInput]::ShowWindow($interferingWindow.MainWindowHandle, 9) | Out-Null
  }
}
