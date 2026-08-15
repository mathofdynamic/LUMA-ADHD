[CmdletBinding()]
param(
  [string]$Query = 'luma pricing growth'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configFile = $null
$http = $null
$workerName = 'luma-adhd-p04-smoke-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$workerDeployed = $false

function New-SmokeSecret {
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Invoke-Smoke([string]$BaseUrl, [string]$Secret, [string]$Path, [hashtable]$Body = @{}) {
  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, ($BaseUrl + $Path))
  $request.Headers.Add('X-Luma-Smoke-Secret', $Secret)
  $request.Content = [System.Net.Http.StringContent]::new(($Body | ConvertTo-Json -Compress -Depth 8), [System.Text.Encoding]::UTF8, 'application/json')
  $response = $http.SendAsync($request).Result
  $responseBody = $response.Content.ReadAsStringAsync().Result
  $parsed = $responseBody | ConvertFrom-Json
  if (-not $response.IsSuccessStatusCode -or -not $parsed.ok) { throw ('Remote Phase 04 smoke request failed: ' + $Path + ' (' + [string]$parsed.error + ')') }
  return $parsed
}

function Set-WorkerSecret([string]$WranglerPath, [string]$ConfigPath, [string]$Name, [string]$Secret) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Get-Command node.exe).Source
  $psi.Arguments = '"' + $WranglerPath + '" secret put SMOKE_SECRET --config "' + $ConfigPath + '"'
  $psi.WorkingDirectory = $repoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi
  if (-not $process.Start()) { throw 'Unable to start temporary Worker secret setup' }
  $process.StandardInput.WriteLine($Secret)
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw 'Temporary Worker secret setup failed' }
}

try {
  Add-Type -AssemblyName System.Net.Http
  $http = [System.Net.Http.HttpClient]::new()
  $http.Timeout = [TimeSpan]::FromSeconds(30)
  $rootConfig = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'wrangler.jsonc') -Encoding UTF8
  $accountId = [regex]::Match($rootConfig, '"account_id"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseName = [regex]::Match($rootConfig, '"database_name"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseId = [regex]::Match($rootConfig, '"database_id"\s*:\s*"([^"]+)"').Groups[1].Value
  if ([string]::IsNullOrWhiteSpace($accountId) -or [string]::IsNullOrWhiteSpace($databaseName) -or [string]::IsNullOrWhiteSpace($databaseId)) { throw 'Cloudflare identifiers are unavailable' }

  $configFile = Join-Path $repoRoot ('.phase04-remote-smoke-' + [Guid]::NewGuid().ToString('N') + '.wrangler.jsonc')
  $config = @"
{
  "`$schema": "./node_modules/wrangler/config-schema.json",
  "name": "$workerName",
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
  $deployOutput = & node $wranglerPath deploy --config $configFile --keep-vars 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'Temporary Worker deployment failed' }
  $workerDeployed = $true
  $baseUrl = [regex]::Match($deployOutput, 'https://[A-Za-z0-9.-]+\.workers\.dev').Value.TrimEnd('/')
  if ([string]::IsNullOrWhiteSpace($baseUrl)) { throw 'Temporary Worker URL was not returned' }
  $secret = New-SmokeSecret
  Set-WorkerSecret $wranglerPath $configFile $workerName $secret

  $sourceKeys = @('luma', 'workflow', 'faq', 'umaq', 'subscription-plan', 'pricing', 'terms-of-use', 'terms-policies', 'growth-strategy', 'international-budget-plan', 'international-budget-plan-fa', 'marketing-contract')
  $first = @()
  foreach ($sourceKey in $sourceKeys) {
    $result = Invoke-Smoke $baseUrl $secret '/__luma_phase04/sync' @{ sourceKey = $sourceKey }
    $first += $result.result
    Write-Output ('SYNC_1=' + $sourceKey + ':' + [string]$result.result.status + ':chunks=' + [int]$result.result.chunksCreated)
  }
  $second = @()
  foreach ($sourceKey in $sourceKeys) {
    $result = Invoke-Smoke $baseUrl $secret '/__luma_phase04/sync' @{ sourceKey = $sourceKey }
    $second += $result.result
    Write-Output ('SYNC_2=' + $sourceKey + ':' + [string]$result.result.status + ':chunks=' + [int]$result.result.chunksCreated)
  }
  Write-Output ('SYNC_SOURCES=' + $sourceKeys.Count)
  Write-Output ('SYNC_FAILED=' + @($first | Where-Object { $_.status -eq 'failed' }).Count)
  Write-Output ('SYNC_UNCHANGED_ON_SECOND_RUN=' + @($second | Where-Object { $_.status -eq 'unchanged' }).Count)

  $documents = Invoke-Smoke $baseUrl $secret '/__luma_phase04/documents'
  Write-Output ('DOCUMENT_SMOKE=' + ($documents.result | ConvertTo-Json -Compress -Depth 8))
  foreach ($searchQuery in @(
    (-join ([char[]](0x0644, 0x0648, 0x645, 0x627))),
    (-join ([char[]](0x0648, 0x0631, 0x06A9, 0x200C, 0x0641, 0x0644, 0x0648))),
    (-join ([char[]](0x0642, 0x06CC, 0x0645, 0x062A))),
    (-join ([char[]](0x0627, 0x0634, 0x062A, 0x0631, 0x0627, 0x06A9))),
    (-join ([char[]](0x0642, 0x0648, 0x0627, 0x0646, 0x06CC, 0x0646))),
    'growth', 'international', "' ) OR *"
  )) {
    $search = Invoke-Smoke $baseUrl $secret '/__luma_phase04/search' @{ query = $searchQuery; agentId = 'agent-product' }
    $top = if (@($search.results).Count -gt 0) { [string]$search.results[0].title } else { 'none' }
    Write-Output ('SEARCH=' + $searchQuery + ':count=' + @($search.results).Count + ':top=' + $top)
  }
  $context = Invoke-Smoke $baseUrl $secret '/__luma_phase04/context' @{ query = $Query }
  Write-Output ('CONTEXT_ITEMS=' + @($context.items).Count)
  Write-Output ('CONTEXT_CHARACTERS=' + [int]$context.totalCharacters)
  Write-Output ('CONTEXT_TRUNCATED=' + [bool]$context.truncated)
  foreach ($item in @($context.items)) { Write-Output ('CONTEXT_ITEM=' + [string]$item.type + ':' + [string]$item.title + ':authority=' + [int]$item.authority) }
  Write-Output 'PHASE04_REMOTE_SMOKE_OK=true'
} finally {
  if ($workerDeployed) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $null = & node (Resolve-Path (Join-Path $repoRoot 'node_modules\wrangler\bin\wrangler.js')).Path delete $workerName --config $configFile --force 2>&1 | Out-String
    $ErrorActionPreference = $old
  }
  if ($null -ne $http) { $http.Dispose() }
  if ($null -ne $configFile -and (Test-Path -LiteralPath $configFile)) { [System.IO.File]::Delete($configFile) }
}
