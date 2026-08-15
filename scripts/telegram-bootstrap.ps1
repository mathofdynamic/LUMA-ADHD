[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$GroupId,

  [string]$WorkerBaseUrl,

  [switch]$InstallGatewayWebhook,

  [switch]$VerifyWebhookTopology,

  [switch]$Deploy
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tokenFile = Join-Path $repoRoot '.telegram-env'

if (-not (Test-Path -LiteralPath $tokenFile)) {
  throw 'Missing local .telegram-env'
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

$mapping = [ordered]@{
  gateway = @{ label = 'Luma_CenterBot'; expected = 'Luma_CenterBot' }
  product = @{ label = 'LumaRadinBot'; expected = 'LumaRadinBot' }
  growth = @{ label = 'LumaAvaBot'; expected = 'LumaAvaBot' }
  creative = @{ label = 'LumaNilaBot'; expected = 'LumaNilaBot' }
  technical = @{ label = 'LumaKianBot'; expected = 'LumaKianBot' }
  finance = @{ label = 'LumaMahsaBot'; expected = 'LumaMahsaBot' }
  customer = @{ label = 'LumaSaraBot'; expected = 'LumaSaraBot' }
  operations = @{ label = 'LumaSamBot'; expected = 'LumaSamBot' }
  heretic = @{ label = 'LumaKavehBot'; expected = 'LumaKavehBot' }
}

$tokens = @{}
foreach ($line in (Get-Content -LiteralPath $tokenFile)) {
  if ($line -match '^\s*@?([^:]+)\s*:\s*"([^"]+)"\s*$') {
    $tokens[$matches[1].Trim()] = $matches[2]
  }
}

foreach ($alias in $mapping.Keys) {
  $label = $mapping[$alias].label
  if (-not $tokens.ContainsKey($label) -or [string]::IsNullOrWhiteSpace($tokens[$label])) {
    throw "Missing local Telegram token for $alias"
  }
}

Add-Type -AssemblyName System.Net.Http
$http = [System.Net.Http.HttpClient]::new()

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

$identities = [ordered]@{}
foreach ($alias in $mapping.Keys) {
  $entry = $mapping[$alias]
  $me = Invoke-Telegram $tokens[$entry.label] 'getMe'
  $username = [string]$me.result.username
  if ($username -cne $entry.expected) {
    throw "Telegram username mismatch for $alias"
  }

  $identities[$alias] = [ordered]@{
    telegramUserId = [string]$me.result.id
    username = $username
  }
}

$admins = Invoke-Telegram $tokens['Luma_CenterBot'] 'getChatAdministrators' @{
  chat_id = $GroupId
}
$creator = @($admins.result | Where-Object { $_.status -eq 'creator' }) |
  Select-Object -First 1
$ownerId = ''
if ($null -ne $creator) {
  $ownerId = [string]$creator.user.id
}

if ([string]::IsNullOrWhiteSpace($ownerId)) {
  $updates = Invoke-Telegram $tokens['Luma_CenterBot'] 'getUpdates' @{
    limit = 100
    allowed_updates = '["message"]'
  }
  $candidate = @($updates.result | Where-Object {
    $_.message.chat.id.ToString() -eq $GroupId -and
      $_.message.text -eq 'LUMA ADHD CONNECT'
  } | Select-Object -First 1)
  if ($null -eq $candidate -or $null -eq $candidate.message.from.id) {
    throw 'Unable to discover the configured Telegram owner'
  }
  $ownerId = [string]$candidate.message.from.id
}

Write-Output 'BOT_IDENTITIES_VERIFIED=9'
Write-Output 'GOD_BOT_CONFIGURED=false'
Write-Output 'OWNER_AUTHORIZATION_RESOLVED=true'

if ($Deploy) {
  $identityJson = $identities | ConvertTo-Json -Compress -Depth 4
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $deployOutput = & npx.cmd --yes wrangler deploy --keep-vars --var 'LUMA_ENVIRONMENT:production' --var ("TELEGRAM_GROUP_ID:" + $GroupId) --var ("TELEGRAM_ADMIN_USER_IDS:" + $ownerId) --var ("TELEGRAM_BOT_IDENTITIES_JSON:" + $identityJson) 2>&1 | Out-String
  $deployExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction

  if ($deployExitCode -ne 0) {
    throw 'Worker deployment failed'
  }

  $baseUrl = [regex]::Match(
    $deployOutput,
    'https://[A-Za-z0-9.-]+\.workers\.dev'
  ).Value
  if ([string]::IsNullOrWhiteSpace($baseUrl)) {
    throw 'Deployment completed without a workers.dev URL'
  }
  Write-Output 'WORKER_DEPLOYED=true'
  Write-Output ('WORKER_BASE_URL=' + $baseUrl.TrimEnd('/'))
}

if ($InstallGatewayWebhook) {
  if ([string]::IsNullOrWhiteSpace($WorkerBaseUrl)) {
    throw 'WorkerBaseUrl is required to install the gateway webhook'
  }

  $secretBytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($secretBytes)
  $rng.Dispose()
  $webhookSecret = [Convert]::ToBase64String($secretBytes).
    TrimEnd('=').Replace('+', '-').Replace('/', '_')

  $secretFile = [System.IO.Path]::GetTempFileName()
  $runtimeConfigFile = Join-Path $repoRoot (
    'phase02-live-' + [Guid]::NewGuid().ToString('N') + '.wrangler.jsonc'
  )
  try {
    $identityJson = $identities | ConvertTo-Json -Compress -Depth 4
    $escapedIdentityJson = $identityJson.Replace('\', '\\').Replace('"', '\"')
    $runtimeConfig = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'wrangler.jsonc')
    $runtimeConfig = $runtimeConfig.Replace(
      '"LUMA_ENVIRONMENT": "local"',
      '"LUMA_ENVIRONMENT": "production"'
    )
    $runtimeConfig = $runtimeConfig.Replace(
      '"TELEGRAM_GROUP_ID": ""',
      ('"TELEGRAM_GROUP_ID": "' + $GroupId + '"')
    )
    $runtimeConfig = $runtimeConfig.Replace(
      '"TELEGRAM_ADMIN_USER_IDS": ""',
      ('"TELEGRAM_ADMIN_USER_IDS": "' + $ownerId + '"')
    )
    $runtimeConfig = $runtimeConfig.Replace(
      '"TELEGRAM_BOT_IDENTITIES_JSON": "{}"',
      ('"TELEGRAM_BOT_IDENTITIES_JSON": "' + $escapedIdentityJson + '"')
    )
    if (
      -not $runtimeConfig.Contains('"TELEGRAM_GROUP_ID": "' + $GroupId + '"') -or
      -not $runtimeConfig.Contains('"TELEGRAM_ADMIN_USER_IDS": "' + $ownerId + '"') -or
      -not $runtimeConfig.Contains('"TELEGRAM_BOT_IDENTITIES_JSON": "' + $escapedIdentityJson + '"')
    ) {
      throw 'Temporary runtime configuration could not be prepared'
    }
    [System.IO.File]::WriteAllText($runtimeConfigFile, $runtimeConfig)

    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $runtimeDeployOutput = & npx.cmd --yes wrangler deploy --config $runtimeConfigFile --keep-vars 2>&1 | Out-String
    $runtimeDeployExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    if ($runtimeDeployExitCode -ne 0) {
      throw 'Worker runtime deployment failed'
    }

    $secretFileContent = @{
      TELEGRAM_WEBHOOK_SECRET = $webhookSecret
    } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($secretFile, $secretFileContent)

    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $secretDeployOutput = & npx.cmd --yes wrangler secret bulk --config $runtimeConfigFile $secretFile 2>&1 | Out-String
    $secretDeployExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    if ($secretDeployExitCode -ne 0) {
      throw 'Worker secret deployment failed'
    }
  } finally {
    if (Test-Path -LiteralPath $secretFile) {
      [System.IO.File]::Delete($secretFile)
    }
    if (Test-Path -LiteralPath $runtimeConfigFile) {
      [System.IO.File]::Delete($runtimeConfigFile)
    }
  }

  if ($null -eq $http) {
    Add-Type -AssemblyName System.Net.Http
    $http = [System.Net.Http.HttpClient]::new()
  }
  Write-Output 'CANARY_STAGE_REACHED=true'
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
    throw ('Worker webhook secret canary failed with status ' + $canaryStatus)
  }

  $payload = @{
    url = $webhookUrl
    secret_token = $webhookSecret
    allowed_updates = @('message')
  } | ConvertTo-Json -Compress
  $content = [System.Net.Http.StringContent]::new(
    $payload,
    [System.Text.Encoding]::UTF8,
    'application/json'
  )
  $setResponse = $http.PostAsync(
    ('https://api.telegram.org/bot' + $tokens['Luma_CenterBot'] + '/setWebhook'),
    $content
  ).Result
  $setBody = $setResponse.Content.ReadAsStringAsync().Result
  $setJson = $setBody | ConvertFrom-Json
  if (-not $setResponse.IsSuccessStatusCode -or -not $setJson.ok) {
    throw 'Gateway webhook installation failed'
  }

  $infoResponse = $http.GetAsync(
    ('https://api.telegram.org/bot' + $tokens['Luma_CenterBot'] + '/getWebhookInfo')
  ).Result
  $infoBody = $infoResponse.Content.ReadAsStringAsync().Result
  $infoJson = $infoBody | ConvertFrom-Json
  if (-not $infoResponse.IsSuccessStatusCode -or -not $infoJson.ok) {
    throw 'Gateway webhook verification failed'
  }

  $info = $infoJson.result
  $urlMatches = [string]$info.url -eq $webhookUrl
  $hasError = -not [string]::IsNullOrWhiteSpace(
    [string]$info.last_error_message
  )
  Write-Output 'GATEWAY_WEBHOOK_SET=true'
  Write-Output ('GATEWAY_WEBHOOK_URL_MATCH=' + $urlMatches)
  Write-Output ('GATEWAY_WEBHOOK_LAST_ERROR=' + $hasError)
  Write-Output ('GATEWAY_PENDING_UPDATES=' + [int]$info.pending_update_count)

  $secretBytes = $null
  $webhookSecret = $null
}

if ($VerifyWebhookTopology) {
  $gatewayInfo = Invoke-Telegram $tokens['Luma_CenterBot'] 'getWebhookInfo'
  if ([string]::IsNullOrWhiteSpace([string]$gatewayInfo.result.url)) {
    throw 'Gateway webhook is not configured'
  }

  $personaWebhookCount = 0
  foreach ($alias in $mapping.Keys) {
    if ($alias -eq 'gateway') {
      continue
    }
    $info = Invoke-Telegram $tokens[$mapping[$alias].label] 'getWebhookInfo'
    if (-not [string]::IsNullOrWhiteSpace([string]$info.result.url)) {
      $personaWebhookCount += 1
    }
  }

  Write-Output 'GATEWAY_WEBHOOK_CONFIGURED=true'
  Write-Output ('PERSONA_WEBHOOK_COUNT=' + $personaWebhookCount)
}

$tokens.Clear()
$http.Dispose()
