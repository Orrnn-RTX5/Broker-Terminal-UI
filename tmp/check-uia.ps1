Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$allWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $allWindows) {
    $name = $w.Current.Name
    $pid = $w.Current.ProcessId
    $className = $w.Current.ClassName
    if ($name) {
        Write-Host "Window: '$name' (PID: $pid, Class: $className)"
    }
}
