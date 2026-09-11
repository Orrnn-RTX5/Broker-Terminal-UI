[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
$installedPath = 'C:\Users\ADMIN\AppData\Local\Programs\rtx-terminal\RTX Terminal.exe'
Write-Host "Launching $installedPath directly in foreground..."
& $installedPath
