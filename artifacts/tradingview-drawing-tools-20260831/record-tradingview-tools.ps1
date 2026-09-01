param(
  [int]$ChromeProcessId = 20348,
  [string]$OutputDirectory = "C:\Users\ADMIN\rtx5-broker-webterminal-ui\artifacts\tradingview-drawing-tools-20260831\source-frames",
  [int]$StartOrder = 1,
  [int]$EndOrder = 17
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$nativeSource = @'
using System;
using System.Runtime.InteropServices;

public static class DrawingToolsInput {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@

Add-Type $nativeSource -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function Move-Pointer {
  param([int]$X, [int]$Y, [int]$Steps = 24)

  $start = [System.Windows.Forms.Cursor]::Position
  for ($index = 1; $index -le $Steps; $index += 1) {
    $nextX = [int]($start.X + (($X - $start.X) * $index / $Steps))
    $nextY = [int]($start.Y + (($Y - $start.Y) * $index / $Steps))
    [DrawingToolsInput]::SetCursorPos($nextX, $nextY) | Out-Null
    Start-Sleep -Milliseconds 10
  }
}

function Click-Point {
  param([int]$X, [int]$Y)

  Move-Pointer -X $X -Y $Y
  Start-Sleep -Milliseconds 120
  [DrawingToolsInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [DrawingToolsInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
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
  @{ Order = 1;  Slug = 'trendline';                 MenuY = 251; Points = @(@(430, 315), @(670, 255)) },
  @{ Order = 2;  Slug = 'ray';                       MenuY = 291; Points = @(@(720, 300), @(900, 245)) },
  @{ Order = 3;  Slug = 'info-line';                 MenuY = 331; Points = @(@(960, 330), @(1130, 270)) },
  @{ Order = 4;  Slug = 'extended-line';             MenuY = 371; Points = @(@(1190, 290), @(1360, 350)) },
  @{ Order = 5;  Slug = 'trend-angle';               MenuY = 411; Points = @(@(1420, 330), @(1610, 260)) },
  @{ Order = 6;  Slug = 'horizontal-line';           MenuY = 452; Points = @(,@(980, 410)) },
  @{ Order = 7;  Slug = 'horizontal-ray';            MenuY = 491; Points = @(,@(580, 445)) },
  @{ Order = 8;  Slug = 'vertical-line';             MenuY = 531; Points = @(,@(760, 500)) },
  @{ Order = 9;  Slug = 'crossline';                 MenuY = 571; Points = @(,@(900, 545)) },
  @{ Order = 10; Slug = 'parallel-channel';          MenuY = 648; Points = @(@(410, 610), @(620, 560), @(500, 685)) },
  @{ Order = 11; Slug = 'regression-trend';          MenuY = 688; Points = @(@(700, 655), @(960, 590)) },
  @{ Order = 12; Slug = 'flat-top-bottom';           MenuY = 728; Points = @(@(1040, 620), @(1240, 620), @(1160, 705)) },
  @{ Order = 13; Slug = 'disjoint-channel';          MenuY = 768; Points = @(@(1360, 620), @(1510, 575), @(1430, 705)) },
  @{ Order = 14; Slug = 'pitchfork';                 MenuY = 845; Points = @(@(600, 755), @(720, 700), @(760, 845)) },
  @{ Order = 15; Slug = 'schiff-pitchfork';          MenuY = 886; Points = @(@(850, 755), @(970, 700), @(1010, 845)) },
  @{ Order = 16; Slug = 'modified-schiff-pitchfork'; MenuY = 925; Points = @(@(1110, 755), @(1230, 700), @(1270, 845)) },
  @{ Order = 17; Slug = 'inside-pitchfork';          MenuY = 965; Points = @(@(1370, 755), @(1490, 700), @(1530, 845)) }
)

$chrome = Get-Process -Id $ChromeProcessId
[DrawingToolsInput]::SetForegroundWindow($chrome.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait('^2')
Start-Sleep -Milliseconds 1200
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Start-Sleep -Milliseconds 300

foreach ($tool in ($tools | Where-Object { $_.Order -ge $StartOrder -and $_.Order -le $EndOrder })) {
  # The right edge of the group button opens the full Lines/Channels/Pitchforks menu.
  Click-Point -X 43 -Y 237
  Start-Sleep -Milliseconds 500
  Click-Point -X 145 -Y $tool.MenuY
  Start-Sleep -Milliseconds 500

  foreach ($point in $tool.Points) {
    Move-Pointer -X $point[0] -Y $point[1]
    Start-Sleep -Milliseconds 500
    Click-Point -X $point[0] -Y $point[1]
    Start-Sleep -Milliseconds 650
  }

  Start-Sleep -Milliseconds 900
  $frameName = "{0:D2}-{1}" -f $tool.Order, $tool.Slug
  Save-Frame -Name $frameName
  Write-Output ("captured {0}" -f $frameName)
}

Move-Pointer -X 1810 -Y 940
Start-Sleep -Milliseconds 800
Save-Frame -Name '18-all-tools-complete'
