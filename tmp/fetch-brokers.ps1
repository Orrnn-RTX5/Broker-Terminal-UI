try {
  $r = Invoke-WebRequest -Uri 'https://fxtrustsuperbackned.orrnn.com/api/v2/broker/servers' -UseBasicParsing -TimeoutSec 20
  Write-Output ("status=" + [int]$r.StatusCode + " len=" + $r.RawContentLength)
  Set-Content -Path 'tmp/broker-servers.json' -Value $r.Content -Encoding utf8
  Write-Output 'wrote tmp/broker-servers.json'
} catch {
  Write-Output ('ERR ' + $_.Exception.Message)
}
