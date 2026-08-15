[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^-?\d+$')]
  [string]$GroupId,

  [ValidatePattern('^[A-Za-z0-9_-]{1,160}$')]
  [string]$ThreadId
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tokenFile = Join-Path $repoRoot '.telegram-env'
$nebulaFile = Join-Path $repoRoot '.nebula-env'
$workerProcess = $null
$envFile = $null
$smokeConfigFile = $null
$http = $null

function Stop-ProcessTree([int]$ProcessId) {
  $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $ProcessId })
  foreach ($child in $children) {
    Stop-ProcessTree ([int]$child.ProcessId)
  }
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -ne $process) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Read-NebulaKey {
  if (-not [string]::IsNullOrWhiteSpace($env:NEBULA_API_KEY)) {
    return $env:NEBULA_API_KEY.Trim()
  }
  if (-not (Test-Path -LiteralPath $nebulaFile)) {
    return $null
  }
  $line = Get-Content -LiteralPath $nebulaFile | Where-Object {
    $_ -match '^\s*NEBULA_API_KEY\s*='
  } | Select-Object -First 1
  if ($null -eq $line) {
    return $null
  }
  $value = [regex]::Replace([string]$line, '^\s*NEBULA_API_KEY\s*=\s*', '')
  return $value.Trim().Trim('"', "'").Trim()
}

try {
  if (-not (Test-Path -LiteralPath $tokenFile)) {
    throw 'Missing local .telegram-env'
  }

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & git -C $repoRoot check-ignore --quiet -- .telegram-env 2>$null
  $telegramIgnored = $LASTEXITCODE
  & git -C $repoRoot ls-files --error-unmatch -- .telegram-env 2>$null
  $telegramTracked = $LASTEXITCODE
  & git -C $repoRoot check-ignore --quiet -- .nebula-env 2>$null
  $nebulaIgnored = $LASTEXITCODE
  & git -C $repoRoot ls-files --error-unmatch -- .nebula-env 2>$null
  $nebulaTracked = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($telegramIgnored -ne 0 -or $telegramTracked -eq 0) {
    throw '.telegram-env must be ignored and untracked'
  }
  if ($nebulaIgnored -ne 0 -or $nebulaTracked -eq 0) {
    throw '.nebula-env must be ignored and untracked'
  }

  $nebulaKey = Read-NebulaKey
  if ([string]::IsNullOrWhiteSpace($nebulaKey)) {
    throw 'NEBULA_API_KEY is required in the process environment or ignored .nebula-env'
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
  $tokenKeyByAlias = @{
    gateway = 'TELEGRAM_GATEWAY_BOT_TOKEN'
    product = 'TELEGRAM_PRODUCT_BOT_TOKEN'
    growth = 'TELEGRAM_GROWTH_BOT_TOKEN'
    creative = 'TELEGRAM_CREATIVE_BOT_TOKEN'
    technical = 'TELEGRAM_TECH_BOT_TOKEN'
    finance = 'TELEGRAM_FINANCE_BOT_TOKEN'
    customer = 'TELEGRAM_CUSTOMER_BOT_TOKEN'
    operations = 'TELEGRAM_OPERATIONS_BOT_TOKEN'
    heretic = 'TELEGRAM_HERETIC_BOT_TOKEN'
  }
  $tokens = @{}
  foreach ($line in (Get-Content -LiteralPath $tokenFile)) {
    if ($line -match '^\s*@?([^:]+)\s*:\s*"([^"]+)"\s*$') {
      $tokens[$matches[1].Trim()] = $matches[2]
    }
  }
  foreach ($alias in $mapping.Keys) {
    $label = $mapping[$alias].label
    if (-not $tokens.ContainsKey($label)) {
      throw "Missing Telegram token for $alias"
    }
  }

  Add-Type -AssemblyName System.Net.Http
  $http = [System.Net.Http.HttpClient]::new()
  function Invoke-Telegram([string]$Token, [string]$Method) {
    $response = $http.GetAsync(('https://api.telegram.org/bot' + $Token + '/' + $Method)).Result
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

  $identities = [ordered]@{}
  foreach ($alias in $mapping.Keys) {
    $me = Invoke-Telegram $tokens[$mapping[$alias].label] 'getMe'
    if ([string]$me.username -cne $mapping[$alias].expected) {
      throw "Unexpected Telegram identity for $alias"
    }
    $identities[$alias] = [ordered]@{
      telegramUserId = [string]$me.id
      username = [string]$me.username
    }
  }

  $secretBytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($secretBytes)
  $rng.Dispose()
  $smokeSecret = [Convert]::ToBase64String($secretBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

  $envFile = [System.IO.Path]::GetTempFileName()
  $envLines = @(
    'LUMA_ENVIRONMENT=local',
    'LUMA_PHASE=03-agent-runtime',
    ('TELEGRAM_GROUP_ID=' + $GroupId),
    'TELEGRAM_ADMIN_USER_IDS=0',
    ('TELEGRAM_BOT_IDENTITIES_JSON=' + ($identities | ConvertTo-Json -Compress -Depth 4)),
    'TELEGRAM_WEBHOOK_SECRET=local-smoke-secret',
    ('NEBULA_API_KEY=' + $nebulaKey),
    'NEBULA_BASE_URL=https://nebula-free-llm.nebula-ai-company.workers.dev/v1',
    'NEBULA_MODEL=@cf/meta/llama-3.1-8b-instruct-fast',
    ('SMOKE_SECRET=' + $smokeSecret)
  )
  foreach ($alias in $mapping.Keys) {
    $envLines += ($tokenKeyByAlias[$alias] + '=' + $tokens[$mapping[$alias].label])
  }
  [System.IO.File]::WriteAllLines($envFile, $envLines, [System.Text.UTF8Encoding]::new($false))

  $port = 8793
  $wranglerPath = (Resolve-Path (Join-Path $repoRoot 'node_modules\wrangler\bin\wrangler.js')).Path
  $smokeConfigFile = Join-Path $repoRoot ('phase03-ambient-smoke-' + [Guid]::NewGuid().ToString('N') + '.wrangler.jsonc')
  $rootConfig = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'wrangler.jsonc')
  $accountId = [regex]::Match($rootConfig, '"account_id"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseName = [regex]::Match($rootConfig, '"database_name"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseId = [regex]::Match($rootConfig, '"database_id"\s*:\s*"([^"]+)"').Groups[1].Value
  if ([string]::IsNullOrWhiteSpace($accountId) -or [string]::IsNullOrWhiteSpace($databaseName) -or [string]::IsNullOrWhiteSpace($databaseId)) {
    throw 'Unable to resolve safe Cloudflare identifiers for the ambient smoke Worker'
  }
  $smokeConfig = @"
{
  "`$schema": "./node_modules/wrangler/config-schema.json",
  "name": "luma-adhd-phase03-ambient-smoke",
  "account_id": "$accountId",
  "main": "scripts/agent-ambient-smoke-worker.ts",
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
    throw 'Unable to start ambient smoke Worker'
  }
  $stdoutTask = $workerProcess.StandardOutput.ReadToEndAsync()
  $stderrTask = $workerProcess.StandardError.ReadToEndAsync()

  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    if ($workerProcess.HasExited) {
      throw 'Ambient smoke Worker exited before readiness'
    }
    try {
      $readyResponse = Invoke-WebRequest -UseBasicParsing ('http://127.0.0.1:' + $port + '/__luma_agent_smoke/ready') -TimeoutSec 2
      if ($readyResponse.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    throw 'Ambient smoke Worker did not become ready'
  }

  $requestBody = if ([string]::IsNullOrWhiteSpace($ThreadId)) { '{}' } else { @{ threadId = $ThreadId } | ConvertTo-Json -Compress }
  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::Post,
    ('http://127.0.0.1:' + $port + '/__luma_agent_smoke/ambient')
  )
  $request.Headers.Add('X-Luma-Smoke-Secret', $smokeSecret)
  $request.Content = [System.Net.Http.StringContent]::new($requestBody, [System.Text.Encoding]::UTF8, 'application/json')
  $response = $http.SendAsync($request).Result
  $responseBody = $response.Content.ReadAsStringAsync().Result
  $result = $responseBody | ConvertFrom-Json
  if (-not $response.IsSuccessStatusCode -or -not $result.ok) {
    Write-Output ('AMBIENT_SMOKE_ERROR=' + [string]$result.error)
    if ($null -ne $result.stage) { Write-Output ('AMBIENT_SMOKE_STAGE=' + [string]$result.stage) }
    if ($null -ne $result.errorName) { Write-Output ('AMBIENT_SMOKE_ERROR_NAME=' + [string]$result.errorName) }
    throw 'Ambient runtime smoke failed'
  }

  Write-Output 'AMBIENT_SMOKE_OK=true'
  Write-Output ('JOB_ID=' + [string]$result.jobId)
  Write-Output ('THREAD_ID=' + [string]$result.threadId)
  Write-Output ('QUEUE_MESSAGE_COUNT=' + [int]$result.queueMessageCount)
  Write-Output ('TURNS=' + [int]$result.turns)
  Write-Output ('PUBLIC_MESSAGES=' + [int]$result.publicMessages)
  Write-Output ('WAITS=' + [int]$result.waits)
  Write-Output ('STOPPED_REASON=' + [string]$result.stoppedReason)
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
