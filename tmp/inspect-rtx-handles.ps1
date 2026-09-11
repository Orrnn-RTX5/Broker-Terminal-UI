$procs = Get-Process -Name 'RTX Terminal' -ErrorAction SilentlyContinue
foreach ($p in $procs) {
    Write-Host "PID: $($p.Id) Handles: $($p.HandleCount) MainWindowHandle: $($p.MainWindowHandle) Title: '$($p.MainWindowTitle)'"
}
