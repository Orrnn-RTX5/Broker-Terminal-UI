$previousElectronMode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
try {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
    $p = Start-Process -FilePath 'C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\RTX Terminal.exe' -PassThru
    Write-Host "Started PID $($p.Id)"
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 1
        $proc = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
        if ($null -eq $proc) {
            Write-Host "Sec $($i): Process exited!"
            break
        } else {
            Write-Host "Sec $($i): Running, HandleCount: $($proc.HandleCount), MainWindowHandle: $($proc.MainWindowHandle)"
        }
    }
} finally {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $previousElectronMode, 'Process')
}
