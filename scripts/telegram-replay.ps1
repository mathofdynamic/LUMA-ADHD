[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^-?\d+$')]
  [string]$GroupId,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$WorkerBaseUrl,

  [string]$DatabaseName = 'luma-adhd'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tokenFile = Join-Path $repoRoot '.telegram-env'
$configFile = Join-Path $repoRoot 'wrangler.jsonc'
$wranglerPath = Join-Path $repoRoot 'node_modules\wrangler\bin\wrangler.js'

if (-not (Test-Path -LiteralPath $tokenFile)) {
  throw 'Missing local .telegram-env'
}
if (-not (Test-Path -LiteralPath $configFile)) {
  throw 'Missing wrangler.jsonc'
}
if (-not (Test-Path -LiteralPath $wranglerPath)) {
  throw 'Missing local Wrangler installation'
}

$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& git -C $repoRoot check-ignore --quiet -- .telegram-env 2>$null
$ignoredExitCode = $LASTEXITCODE
& git -C $repoRoot ls-files --error-unmatch -- .telegram-env 2>$null
$trackedExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction

if ($ignoredExitCode -ne 0) {
  throw '.telegram-env is not ignored by Git'
}
if ($trackedExitCode -eq 0) {
  throw '.telegram-env is tracked by Git'
}

$gatewayToken = $null
foreach ($line in (Get-Content -LiteralPath $tokenFile)) {
  if ($line -match '^\s*@?([^:]+)\s*:\s*"([^"]+)"\s*$' -and
    $matches[1].Trim() -eq 'Luma_CenterBot') {
    $gatewayToken = $matches[2]
  }
}
if ([string]::IsNullOrWhiteSpace($gatewayToken)) {
  throw 'Missing local gateway Telegram token'
}

Add-Type -AssemblyName System.Net.Http
$http = [System.Net.Http.HttpClient]::new()
$secretFile = $null

function Invoke-Telegram(
  [string]$Token,
  [string]$Method,
  [hashtable]$Query = @{}
) {
  $uri = "https://api.telegram.org/bot$Token/$Method"
  if ($Query.Count -gt 0) {
    $parts = foreach ($entry in $Query.GetEnumerator()) {
      [System.Uri]::EscapeDataString([string]$entry.Key) + '=' +
        [System.Uri]::EscapeDataString([string]$entry.Value)
    }
    $uri += '?' + ($parts -join '&')
  }

  $response = $http.GetAsync($uri).Result
  $body = $response.Content.ReadAsStringAsync().Result
  if (-not $response.IsSuccessStatusCode) {
    throw "Telegram HTTP failure for $Method"
  }
  $parsed = $body | ConvertFrom-Json
  if (-not $parsed.ok) {
    throw "Telegram API failure for $Method"
  }
  return $parsed
}

try {
  $me = Invoke-Telegram $gatewayToken 'getMe'
  if ([string]$me.result.username -cne 'Luma_CenterBot' -or -not $me.result.is_bot) {
    throw 'Gateway token does not resolve to Luma_CenterBot'
  }

  $secretBytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($secretBytes)
  $rng.Dispose()
  $webhookSecret = [Convert]::ToBase64String($secretBytes).
    TrimEnd('=').Replace('+', '-').Replace('/', '_')

  $secretFile = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText(
    $secretFile,
    (@{ TELEGRAM_WEBHOOK_SECRET = $webhookSecret } | ConvertTo-Json -Compress)
  )

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & node $wranglerPath secret bulk --config $configFile $secretFile 2>&1 | Out-Null
  $secretExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($secretExitCode -ne 0) {
    throw 'Worker webhook secret update failed'
  }

  $webhookUrl = $WorkerBaseUrl.TrimEnd('/') + '/telegram/webhook/gateway'
  $canaryStatus = 0
  for ($canaryAttempt = 1; $canaryAttempt -le 10; $canaryAttempt += 1) {
    $canaryRequest = [System.Net.Http.HttpRequestMessage]::new(
      [System.Net.Http.HttpMethod]::Post,
      $webhookUrl
    )
    $canaryRequest.Headers.Add('X-Telegram-Bot-Api-Secret-Token', $webhookSecret)
    $canaryRequest.Content = [System.Net.Http.StringContent]::new(
      '{}',
      [System.Text.Encoding]::UTF8,
      'application/json'
    )
    $canaryResponse = $http.SendAsync($canaryRequest).Result
    $canaryStatus = [int]$canaryResponse.StatusCode
    $canaryRequest.Dispose()
    if ($canaryStatus -eq 400) {
      break
    }
    if ($canaryAttempt -lt 10) {
      Start-Sleep -Seconds 2
    }
  }
  if ($canaryStatus -ne 400) {
    throw 'Worker webhook secret canary failed'
  }

  $setPayload = @{
    url = $webhookUrl
    secret_token = $webhookSecret
    allowed_updates = @('message')
  } | ConvertTo-Json -Compress
  $setResponse = $http.PostAsync(
    ('https://api.telegram.org/bot' + $gatewayToken + '/setWebhook'),
    [System.Net.Http.StringContent]::new(
      $setPayload,
      [System.Text.Encoding]::UTF8,
      'application/json'
    )
  ).Result
  $setBody = $setResponse.Content.ReadAsStringAsync().Result
  $setJson = $setBody | ConvertFrom-Json
  if (-not $setResponse.IsSuccessStatusCode -or -not $setJson.ok) {
    throw 'Gateway webhook reset failed'
  }

  $webhookInfo = Invoke-Telegram $gatewayToken 'getWebhookInfo'
  if ([string]$webhookInfo.result.url -cne $webhookUrl -or
    -not [string]::IsNullOrWhiteSpace([string]$webhookInfo.result.last_error_message)) {
    throw 'Gateway webhook verification failed after reset'
  }

  $replayQuery = @"
SELECT m.telegram_update_id AS update_id,
       m.telegram_message_id AS message_id,
       u.external_key AS external_key,
       u.display_name AS display_name,
       u.username AS username
FROM messages m
JOIN users u ON u.id = m.author_user_id
JOIN chats c ON c.id = m.chat_id
WHERE m.origin = 'telegram'
  AND m.content_text = 'LUMA ADHD LIVE TEST 001'
  AND c.telegram_chat_id = '$GroupId'
ORDER BY m.created_at DESC
LIMIT 1;
"@

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $d1Output = & node $wranglerPath d1 execute $DatabaseName --remote `
    --command $replayQuery --json 2>&1 | Out-String
  $d1ExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($d1ExitCode -ne 0) {
    throw 'Unable to load the received inbound update for replay'
  }

  try {
    $d1Json = @($d1Output | ConvertFrom-Json)
    $d1Envelope = $d1Json | Select-Object -First 1
    $replayRow = @($d1Envelope.results) | Select-Object -First 1
  } catch {
    throw 'Unable to parse the received inbound update for replay'
  }
  if ($null -eq $replayRow -or
    [string]::IsNullOrWhiteSpace([string]$replayRow.update_id) -or
    [string]::IsNullOrWhiteSpace([string]$replayRow.message_id) -or
    [string]::IsNullOrWhiteSpace([string]$replayRow.external_key)) {
    throw 'The expected received inbound update was not found for replay'
  }

  $telegramUserId = ([string]$replayRow.external_key) -replace '^telegram:user:', ''
  if ($telegramUserId -notmatch '^\d+$') {
    throw 'The received inbound sender mapping is invalid for replay'
  }
  $displayName = [string]$replayRow.display_name
  if ([string]::IsNullOrWhiteSpace($displayName)) {
    $displayName = 'LUMA operator'
  }

  $from = [ordered]@{
    id = [long]$telegramUserId
    is_bot = $false
    first_name = $displayName
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$replayRow.username)) {
    $from['username'] = [string]$replayRow.username
  }
  $replayPayload = [ordered]@{
    update_id = [long]$replayRow.update_id
    message = [ordered]@{
      message_id = [long]$replayRow.message_id
      from = $from
      chat = [ordered]@{
        id = [long]$GroupId
        type = 'supergroup'
        title = 'LUMA ADHD'
      }
      date = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
      text = 'LUMA ADHD LIVE TEST 001'
    }
  } | ConvertTo-Json -Compress -Depth 8

  $statuses = @()
  foreach ($attempt in 1..2) {
    $request = [System.Net.Http.HttpRequestMessage]::new(
      [System.Net.Http.HttpMethod]::Post,
      $webhookUrl
    )
    $request.Headers.Add('X-Telegram-Bot-Api-Secret-Token', $webhookSecret)
    $request.Content = [System.Net.Http.StringContent]::new(
      $replayPayload,
      [System.Text.Encoding]::UTF8,
      'application/json'
    )
    $response = $http.SendAsync($request).Result
    $body = $response.Content.ReadAsStringAsync().Result
    $request.Dispose()
    if (-not $response.IsSuccessStatusCode) {
      throw 'Inbound idempotency replay was rejected by the Worker'
    }
    try {
      $json = $body | ConvertFrom-Json
      $status = [string]$json.status
    } catch {
      throw 'Inbound idempotency replay returned an invalid Worker response'
    }
    if ($status -ne 'duplicate') {
      throw 'Inbound idempotency replay did not return duplicate'
    }
    $statuses += $status
  }

  Write-Output 'INBOUND_IDEMPOTENCY_REPLAYED=true'
  Write-Output 'INBOUND_IDEMPOTENCY_RESPONSES=duplicate,duplicate'
} finally {
  if ($null -ne $secretFile -and (Test-Path -LiteralPath $secretFile)) {
    [System.IO.File]::Delete($secretFile)
  }
  $http.Dispose()
}
