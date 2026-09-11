param([string]$Click, [string]$Screenshot)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$terminal=Get-Process -Name 'RTX Terminal' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $terminal) { throw 'Desktop terminal window not found' }
$appRoot=[System.Windows.Automation.AutomationElement]::FromHandle($terminal.MainWindowHandle)
if($Click){
  $element=$appRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$Click))
  if(-not $element) { throw "Visible control not found: $Click" }
  $invokePattern=$null
  $expandPattern=$null
  $togglePattern=$null
  if($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invokePattern)) { $invokePattern.Invoke() }
  elseif($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$expandPattern)) { $expandPattern.Expand() }
  elseif($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$togglePattern)) { $togglePattern.Toggle() }
  else { throw "No supported click pattern: $Click" }
}
if($Screenshot){
  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class RtxThemeWindow { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'
  [void][RtxThemeWindow]::SetForegroundWindow($terminal.MainWindowHandle)
  Start-Sleep -Milliseconds 300
  $rect=$appRoot.Current.BoundingRectangle
  $bitmap=New-Object System.Drawing.Bitmap([int]$rect.Width,[int]$rect.Height)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen([int]$rect.X,[int]$rect.Y,0,0,$bitmap.Size)
    $bitmap.Save([System.IO.Path]::GetFullPath($Screenshot),[System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
$elements=$appRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$rows=for($i=0;$i -lt $elements.Count;$i++){
  $entry=$elements.Item($i)
  if(-not $entry.Current.IsOffscreen -and $entry.Current.Name -and $entry.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit){
    [PSCustomObject]@{ Type=$entry.Current.ControlType.ProgrammaticName; Name=$entry.Current.Name }
  }
}
$rows | Select-Object -First 95 | ConvertTo-Json -Compress
