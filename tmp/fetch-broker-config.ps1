$urls = @(
  'https://nexa.orrnn.com/api/v2/broker/config?broker_id=Nexa',
  'https://fxtrustbrokerbackend.orrnn.com/api/v2/broker/config?broker_id=TEST',
  'https://service.achieverfinancials.com/api/v2/broker/config?broker_id=achiever-financials',
  'https://fxtrustsuperbackned.orrnn.com/api/v1/brokers/Nexa',
  'https://fxtrustsuperbackned.orrnn.com/api/v1/brokers'
)
foreach ($url in $urls) {
  Write-Output ("==== " + $url)
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 12
    Write-Output ("status=" + [int]$r.StatusCode)
    $content = $r.Content
    if ($content.Length -gt 2500) { $content = $content.Substring(0, 2500) }
    Write-Output $content
  } catch {
    Write-Output ('ERR ' + $_.Exception.Message)
  }
  Write-Output ''
}
