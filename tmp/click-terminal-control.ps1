param([string]$Name)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class RtxClick { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e); }'
[void][RtxClick]::SetProcessDPIAware()
$p=Get-Process -Name 'RTX Terminal' | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
[void][RtxClick]::SetForegroundWindow($p.MainWindowHandle)
Start-Sleep -Milliseconds 400
$root=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$el=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$Name))
if(-not $el -or $el.Current.IsOffscreen){throw 'Target is not visible'}
$r=$el.Current.BoundingRectangle
Write-Output "$Name : $r"
[void][RtxClick]::SetForegroundWindow($p.MainWindowHandle)
[void][RtxClick]::SetCursorPos([int]($r.X+$r.Width/2),[int]($r.Y+$r.Height/2))
[RtxClick]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
[RtxClick]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
