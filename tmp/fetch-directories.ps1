$urls = @(
  'https://superbackend.orrnn.com/api/v2/broker/servers',
  'https://fxtrustsuperbackned.orrnn.com/api/v2/broker/servers'
)
foreach ($url in $urls) {
  Write-Output ("==== " + $url)
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
    $json = $r.Content | ConvertFrom-Json
    if ($json -is [array]) {
      Write-Output ("count=" + $json.Count)
      foreach ($b in $json) {
        Write-Output ("- " + $b.broker_id + " | " + $b.broker_name + " | " + $b.server_url + " | theme=" + $b.theme_color + " | logo=" + $b.logo_url)
      }
    } else {
      Write-Output $r.Content.Substring(0, [Math]::Min(1500, $r.Content.Length))
    }
  } catch {
    Write-Output ('ERR ' + $_.Exception.Message)
  }
  Write-Output ''
}
