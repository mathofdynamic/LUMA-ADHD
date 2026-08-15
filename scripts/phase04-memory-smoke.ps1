[CmdletBinding()]
param(
  [ValidateSet('all', 'sync', 'documents', 'search', 'context')]
  [string]$Mode = 'all',
  [string]$Query = 'luma pricing growth'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workerProcess = $null
$envFile = $null
$configFile = $null
$http = $null

function Stop-ProcessTree([int]$ProcessId) {
  $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $ProcessId })
  foreach ($child in $children) { Stop-ProcessTree ([int]$child.ProcessId) }
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -ne $process) { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue }
}

function New-SmokeSecret {
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Invoke-Smoke([string]$Path, [hashtable]$Body = @{}) {
  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::Post,
    ('http://127.0.0.1:' + $port + $Path)
  )
  $request.Headers.Add('X-Luma-Smoke-Secret', $smokeSecret)
  $json = ($Body | ConvertTo-Json -Compress -Depth 8)
  $request.Content = [System.Net.Http.StringContent]::new($json, [System.Text.Encoding]::UTF8, 'application/json')
  $response = $http.SendAsync($request).Result
  $responseBody = $response.Content.ReadAsStringAsync().Result
  $parsed = $responseBody | ConvertFrom-Json
  if (-not $response.IsSuccessStatusCode -or -not $parsed.ok) {
    throw ('Phase 04 smoke request failed: ' + $Path + ' (' + [string]$parsed.error + ')')
  }
  return $parsed
}

try {
  Add-Type -AssemblyName System.Net.Http
  $http = [System.Net.Http.HttpClient]::new()
  $http.Timeout = [TimeSpan]::FromSeconds(20)
  $smokeSecret = New-SmokeSecret
  $port = 8794

  $rootConfig = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'wrangler.jsonc')
  $accountId = [regex]::Match($rootConfig, '"account_id"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseName = [regex]::Match($rootConfig, '"database_name"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseId = [regex]::Match($rootConfig, '"database_id"\s*:\s*"([^"]+)"').Groups[1].Value
  if ([string]::IsNullOrWhiteSpace($accountId) -or [string]::IsNullOrWhiteSpace($databaseName) -or [string]::IsNullOrWhiteSpace($databaseId)) {
    throw 'Unable to resolve safe Cloudflare identifiers for the Phase 04 smoke Worker'
  }

  $envFile = Join-Path $repoRoot ('.phase04-smoke-' + [Guid]::NewGuid().ToString('N') + '.env')
  [System.IO.File]::WriteAllText($envFile, ('SMOKE_SECRET=' + $smokeSecret + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
  $configFile = Join-Path $repoRoot ('.phase04-smoke-' + [Guid]::NewGuid().ToString('N') + '.wrangler.jsonc')
  $config = @"
{
  "`$schema": "./node_modules/wrangler/config-schema.json",
  "name": "luma-adhd-phase04-memory-smoke",
  "account_id": "$accountId",
  "main": "scripts/phase04-memory-smoke-worker.ts",
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
  [System.IO.File]::WriteAllText($configFile, $config, [System.Text.UTF8Encoding]::new($false))

  $wranglerPath = (Resolve-Path (Join-Path $repoRoot 'node_modules\wrangler\bin\wrangler.js')).Path
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Get-Command node.exe).Source
  $psi.Arguments = '"' + $wranglerPath + '" dev --config "' + $configFile + '" --remote --env-file "' + $envFile + '" --port ' + $port + ' --log-level error --show-interactive-dev-session=false'
  $psi.WorkingDirectory = $repoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $workerProcess = [System.Diagnostics.Process]::new()
  $workerProcess.StartInfo = $psi
  if (-not $workerProcess.Start()) { throw 'Unable to start Phase 04 smoke Worker' }
  $stdoutTask = $workerProcess.StandardOutput.ReadToEndAsync()
  $stderrTask = $workerProcess.StandardError.ReadToEndAsync()

  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    if ($workerProcess.HasExited) { throw 'Phase 04 smoke Worker exited before readiness' }
    try {
      $readyResponse = Invoke-WebRequest -UseBasicParsing ('http://127.0.0.1:' + $port + '/__luma_phase04/ready') -TimeoutSec 2
      if ($readyResponse.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Phase 04 smoke Worker did not become ready' }

  $sourceKeys = @('luma', 'workflow', 'faq', 'umaq', 'subscription-plan', 'pricing', 'terms-of-use', 'terms-policies', 'growth-strategy', 'international-budget-plan', 'international-budget-plan-fa', 'marketing-contract')
  if ($Mode -eq 'all' -or $Mode -eq 'sync') {
    $first = @()
    foreach ($sourceKey in $sourceKeys) {
      $result = Invoke-Smoke '/__luma_phase04/sync' @{ sourceKey = $sourceKey }
      $first += $result.result
      Write-Output ('SYNC_1=' + $sourceKey + ':' + [string]$result.result.status + ':chunks=' + [int]$result.result.chunksCreated)
    }
    $second = @()
    foreach ($sourceKey in $sourceKeys) {
      $result = Invoke-Smoke '/__luma_phase04/sync' @{ sourceKey = $sourceKey }
      $second += $result.result
      Write-Output ('SYNC_2=' + $sourceKey + ':' + [string]$result.result.status + ':chunks=' + [int]$result.result.chunksCreated)
    }
    $failed = @($first | Where-Object { $_.status -eq 'failed' }).Count
    $unchanged = @($second | Where-Object { $_.status -eq 'unchanged' }).Count
    Write-Output ('SYNC_SOURCES=' + $sourceKeys.Count)
    Write-Output ('SYNC_FAILED=' + $failed)
    Write-Output ('SYNC_UNCHANGED_ON_SECOND_RUN=' + $unchanged)
  }
  if ($Mode -eq 'all' -or $Mode -eq 'documents') {
    $documents = Invoke-Smoke '/__luma_phase04/documents'
    Write-Output ('DOCUMENT_SMOKE=' + ($documents.result | ConvertTo-Json -Compress -Depth 8))
  }
  if ($Mode -eq 'all' -or $Mode -eq 'search') {
    $persianQueries = @(
      (-join ([char[]](0x0644, 0x0648, 0x0645, 0x0627))),
      (-join ([char[]](0x0648, 0x0631, 0x06A9, 0x200C, 0x0641, 0x0644, 0x0648))),
      (-join ([char[]](0x0642, 0x06CC, 0x0645, 0x062A))),
      (-join ([char[]](0x0627, 0x0634, 0x062A, 0x0631, 0x0627, 0x06A9))),
      (-join ([char[]](0x0642, 0x0648, 0x0627, 0x0646, 0x06CC, 0x0646)))
    )
    foreach ($query in @($persianQueries + @('growth', 'international', "' ) OR *"))) {
      $search = Invoke-Smoke '/__luma_phase04/search' @{ query = $query; agentId = 'agent-product' }
      $topTitle = if (@($search.results).Count -gt 0) { [string]$search.results[0].title } else { 'none' }
      Write-Output ('SEARCH=' + $query + ':count=' + @($search.results).Count + ':top=' + $topTitle)
    }
  }
  if ($Mode -eq 'all' -or $Mode -eq 'context') {
    $context = Invoke-Smoke '/__luma_phase04/context' @{ query = $Query }
    Write-Output ('CONTEXT_ITEMS=' + @($context.items).Count)
    Write-Output ('CONTEXT_CHARACTERS=' + [int]$context.totalCharacters)
    Write-Output ('CONTEXT_TRUNCATED=' + [bool]$context.truncated)
    foreach ($item in @($context.items)) {
      Write-Output ('CONTEXT_ITEM=' + [string]$item.type + ':' + [string]$item.title + ':authority=' + [int]$item.authority)
    }
  }
  Write-Output 'PHASE04_MEMORY_SMOKE_OK=true'
} finally {
  if ($null -ne $workerProcess -and $workerProcess.Id -gt 0) { Stop-ProcessTree ([int]$workerProcess.Id) }
  if ($null -ne $http) { $http.Dispose() }
  if ($null -ne $envFile -and (Test-Path -LiteralPath $envFile)) { [System.IO.File]::Delete($envFile) }
  if ($null -ne $configFile -and (Test-Path -LiteralPath $configFile)) { [System.IO.File]::Delete($configFile) }
}
