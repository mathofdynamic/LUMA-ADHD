[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('product', 'heretic')]
  [string]$Persona,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Message,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^phase02-live-[a-z0-9-]{8,80}$')]
  [string]$IdempotencyKey,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^-?\d+$')]
  [string]$GroupId,

  [switch]$SimulateFailure
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tokenFile = Join-Path $repoRoot '.telegram-env'
$workerProcess = $null
$envFile = $null
$smokeConfigFile = $null
$http = $null

function Stop-ProcessTree([int]$ProcessId) {
  $children = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ParentProcessId -eq $ProcessId
  })
  foreach ($child in $children) {
    Stop-ProcessTree ([int]$child.ProcessId)
  }
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -ne $process) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

try {
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
  if ($ignoredExitCode -ne 0 -or $trackedExitCode -eq 0) {
    throw '.telegram-env must be ignored and untracked'
  }

  $labels = @{
    product = @{ label = 'LumaRadinBot'; expected = 'LumaRadinBot' }
    heretic = @{ label = 'LumaKavehBot'; expected = 'LumaKavehBot' }
  }
  $tokens = @{}
  foreach ($line in (Get-Content -LiteralPath $tokenFile)) {
    if ($line -match '^\s*@?([^:]+)\s*:\s*"([^"]+)"\s*$') {
      $tokens[$matches[1].Trim()] = $matches[2]
    }
  }
  foreach ($entry in $labels.Values) {
    if (-not $tokens.ContainsKey($entry.label)) {
      throw 'Missing required persona token'
    }
  }

  Add-Type -AssemblyName System.Net.Http
  $http = [System.Net.Http.HttpClient]::new()
  function Invoke-Telegram([string]$Token, [string]$Method) {
    $response = $http.GetAsync(
      ('https://api.telegram.org/bot' + $Token + '/' + $Method)
    ).Result
    $body = $response.Content.ReadAsStringAsync().Result
    if (-not $response.IsSuccessStatusCode) {
      throw 'Telegram identity verification failed'
    }
    $parsed = $body | ConvertFrom-Json
    if (-not $parsed.ok) {
      throw 'Telegram identity verification failed'
    }
    return $parsed.result
  }

  $identity = [ordered]@{}
  foreach ($alias in $labels.Keys) {
    $entry = $labels[$alias]
    $me = Invoke-Telegram $tokens[$entry.label] 'getMe'
    if ([string]$me.username -cne $entry.expected) {
      throw "Unexpected Telegram identity for $alias"
    }
    $identity[$alias] = [ordered]@{
      telegramUserId = [string]$me.id
      username = [string]$me.username
    }
  }

  $smokeBytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($smokeBytes)
  $rng.Dispose()
  $smokeSecret = [Convert]::ToBase64String($smokeBytes).
    TrimEnd('=').Replace('+', '-').Replace('/', '_')

  $envFile = [System.IO.Path]::GetTempFileName()
  $envLines = @(
    'LUMA_ENVIRONMENT=local',
    'LUMA_PHASE=02-telegram',
    ('TELEGRAM_GROUP_ID=' + $GroupId),
    'TELEGRAM_ADMIN_USER_IDS=0',
    ('TELEGRAM_BOT_IDENTITIES_JSON=' + ($identity | ConvertTo-Json -Compress -Depth 4)),
    'TELEGRAM_WEBHOOK_SECRET=local-smoke-secret',
    ('TELEGRAM_PRODUCT_BOT_TOKEN=' + $tokens['LumaRadinBot']),
    ('TELEGRAM_HERETIC_BOT_TOKEN=' + $tokens['LumaKavehBot']),
    ('SMOKE_SECRET=' + $smokeSecret)
  )
  [System.IO.File]::WriteAllLines(
    $envFile,
    $envLines,
    [System.Text.UTF8Encoding]::new($false)
  )

  $port = 8792
  $wranglerPath = (Resolve-Path (Join-Path $repoRoot 'node_modules\wrangler\bin\wrangler.js')).Path
  $smokeConfigFile = Join-Path $repoRoot (
    'phase02-smoke-' + [Guid]::NewGuid().ToString('N') + '.wrangler.jsonc'
  )
  $rootConfig = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'wrangler.jsonc')
  $accountId = [regex]::Match($rootConfig, '"account_id"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseName = [regex]::Match($rootConfig, '"database_name"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseId = [regex]::Match($rootConfig, '"database_id"\s*:\s*"([^"]+)"').Groups[1].Value
  if ([string]::IsNullOrWhiteSpace($accountId) -or
    [string]::IsNullOrWhiteSpace($databaseName) -or
    [string]::IsNullOrWhiteSpace($databaseId)) {
    throw 'Unable to resolve safe Cloudflare identifiers for the smoke Worker'
  }
  $smokeConfig = @"
{
  "`$schema": "./node_modules/wrangler/config-schema.json",
  "name": "luma-adhd-phase02-smoke",
  "account_id": "$accountId",
  "main": "scripts/telegram-smoke-worker.ts",
  "compatibility_date": "2026-08-14",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "$databaseName",
      "database_id": "$databaseId"
    }
  ]
}
"@
  [System.IO.File]::WriteAllText($smokeConfigFile, $smokeConfig)
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Get-Command node.exe).Source
  $psi.Arguments = '"' + $wranglerPath + '" dev --config "' + $smokeConfigFile + '" --remote --env-file "' + $envFile + '" --port ' + $port + ' --log-level error --show-interactive-dev-session=false'
  $psi.WorkingDirectory = $repoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $workerProcess = [System.Diagnostics.Process]::new()
  $workerProcess.StartInfo = $psi
  if (-not $workerProcess.Start()) {
    throw 'Unable to start local smoke Worker'
  }
  $stdoutTask = $workerProcess.StandardOutput.ReadToEndAsync()
  $stderrTask = $workerProcess.StandardError.ReadToEndAsync()

  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    if ($workerProcess.HasExited) {
      throw 'Local smoke Worker exited before readiness'
    }
    try {
      $readyResponse = Invoke-WebRequest -UseBasicParsing (
        'http://127.0.0.1:' + $port + '/__luma_smoke/ready'
      ) -TimeoutSec 2
      if ($readyResponse.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    Stop-ProcessTree ([int]$workerProcess.Id)
    $stdoutTask.Wait(5000) | Out-Null
    $stderrTask.Wait(5000) | Out-Null
    $diagnostic = ($stderrTask.GetAwaiter().GetResult() + "`n" +
      $stdoutTask.GetAwaiter().GetResult()).Trim()
    foreach ($tokenValue in $tokens.Values) {
      if (-not [string]::IsNullOrWhiteSpace([string]$tokenValue)) {
        $diagnostic = $diagnostic.Replace([string]$tokenValue, '[REDACTED]')
      }
    }
    $diagnostic = $diagnostic.Replace($smokeSecret, '[REDACTED]')
    $diagnostic = $diagnostic.Replace($GroupId, '[GROUP_ID]')
    if (-not [string]::IsNullOrWhiteSpace($diagnostic)) {
      Write-Output ('SMOKE_WORKER_DIAGNOSTIC=' + $diagnostic)
    }
    throw 'Local smoke Worker did not become ready'
  }

  $requestBody = @{
    agentId = 'agent-' + $Persona
    contentText = $Message
    idempotencyKey = $IdempotencyKey
    simulateFailure = [bool]$SimulateFailure
  } | ConvertTo-Json -Compress
  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::Post,
    ('http://127.0.0.1:' + $port + '/__luma_smoke/project')
  )
  $request.Headers.Add('X-Luma-Smoke-Secret', $smokeSecret)
  $request.Content = [System.Net.Http.StringContent]::new(
    $requestBody,
    [System.Text.Encoding]::UTF8,
    'application/json'
  )
  $response = $http.SendAsync($request).Result
  $responseBody = $response.Content.ReadAsStringAsync().Result
  $result = $responseBody | ConvertFrom-Json
  if (-not $response.IsSuccessStatusCode -or -not $result.ok) {
    throw 'Telegram outbound smoke request failed'
  }

  Write-Output ('SMOKE_HTTP_STATUS=' + [int]$response.StatusCode)
  Write-Output ('OUTBOUND_STATUS=' + [string]$result.status)
  Write-Output ('CANONICAL_MESSAGE_CREATED=' + (-not [string]::IsNullOrWhiteSpace([string]$result.messageId)))
  Write-Output ('OUTBOUND_RECORD_CREATED=' + (-not [string]::IsNullOrWhiteSpace([string]$result.outboundId)))
  Write-Output ('TELEGRAM_PART_COUNT=' + @($result.telegramMessageIds).Count)
  Write-Output ('SIMULATED_FAILURE=' + [bool]$SimulateFailure)
} finally {
  if ($null -ne $workerProcess -and $workerProcess.Id -gt 0) {
    Stop-ProcessTree ([int]$workerProcess.Id)
  }
  if ($null -ne $http) {
    $http.Dispose()
  }
  if ($null -ne $envFile -and (Test-Path -LiteralPath $envFile)) {
    [System.IO.File]::Delete($envFile)
  }
  if ($null -ne $smokeConfigFile -and (Test-Path -LiteralPath $smokeConfigFile)) {
    [System.IO.File]::Delete($smokeConfigFile)
  }
}
