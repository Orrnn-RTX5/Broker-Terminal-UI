$list = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*rtx*' -or $_.CommandLine -like '*rtx*' }
foreach ($x in $list) {
    Write-Host "PID: $($x.ProcessId) Name: $($x.Name) Path: $($x.ExecutablePath)"
}
