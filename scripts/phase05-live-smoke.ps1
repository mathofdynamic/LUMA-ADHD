[CmdletBinding()]
param(
  [switch]$SkipRag,
  [switch]$RagOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$rootConfigPath = Join-Path $repoRoot 'wrangler.jsonc'
$configFile = Join-Path $repoRoot ('phase05-live-smoke-' + [Guid]::NewGuid().ToString('N') + '.wrangler.jsonc')
$workerName = 'luma-adhd-phase05-live-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$smokeSecret = $null
$deployed = $false
$http = $null

if ($SkipRag -and $RagOnly) {
  throw 'SkipRag and RagOnly cannot be used together'
}

function Invoke-WranglerOutput([string[]]$Arguments) {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = (& npx wrangler @Arguments 2>&1 | Out-String)
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($exitCode -ne 0) {
    throw ('Wrangler command failed with exit code ' + $exitCode)
  }
  return $output
}

function Stop-TemporaryWorker {
  if (-not $deployed) { return }
  try {
    Invoke-WranglerOutput @('delete', '--config', $configFile, '--name', $workerName, '--force') | Out-Null
  } catch {
    Write-Output 'TEMPORARY_WORKER_DELETE=failed'
    return
  }
  Write-Output 'TEMPORARY_WORKER_DELETE=success'
}

function Invoke-SmokeRequest([string]$BaseUrl, [string]$Path, [object]$Body) {
  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::Post,
    ($BaseUrl + $Path)
  )
  $request.Headers.Add('X-Luma-Smoke-Secret', $smokeSecret)
  $json = if ($null -eq $Body) { '{}' } else { $Body | ConvertTo-Json -Compress -Depth 8 }
  $request.Content = [System.Net.Http.StringContent]::new($json, [System.Text.Encoding]::UTF8, 'application/json')
  $response = $http.SendAsync($request).Result
  $responseBody = $response.Content.ReadAsStringAsync().Result
  $parsed = $responseBody | ConvertFrom-Json
  if (-not $response.IsSuccessStatusCode -or -not $parsed.ok) {
    throw ('Smoke endpoint failed: ' + $Path + ' status=' + [int]$response.StatusCode + ' body=' + $responseBody)
  }
  return $parsed
}

function Install-TemporarySecret([string]$SecretName, [string]$SecretValue) {
  $wranglerPath = (Resolve-Path (Join-Path $repoRoot 'node_modules\wrangler\bin\wrangler.js')).Path
  $nodePath = (Get-Command node.exe).Source
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $nodePath
  $psi.Arguments = '"' + $wranglerPath + '" secret put ' + $SecretName + ' --config "' + $configFile + '" --name ' + $workerName
  $psi.WorkingDirectory = $repoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi
  if (-not $process.Start()) { throw ('Unable to start secret installation for ' + $SecretName) }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.Write($SecretValue)
  $process.StandardInput.Close()
  $process.WaitForExit()
  $null = $stdoutTask.Result
  $null = $stderrTask.Result
  if ($process.ExitCode -ne 0) { throw ('Temporary Worker secret installation failed for ' + $SecretName) }
}

try {
  $nebulaKey = [Environment]::GetEnvironmentVariable('NEBULA_API_KEY', 'Process')
  $gptKey = [Environment]::GetEnvironmentVariable('GPT_API_KEY', 'Process')
  Write-Output ('NEBULA_API_KEY_AVAILABLE=' + (-not [string]::IsNullOrWhiteSpace($nebulaKey)))
  Write-Output ('GPT_API_KEY_AVAILABLE=' + (-not [string]::IsNullOrWhiteSpace($gptKey)))
  if ([string]::IsNullOrWhiteSpace($nebulaKey)) { throw 'NEBULA_API_KEY is unavailable in the operator process' }
  if ([string]::IsNullOrWhiteSpace($gptKey)) { throw 'GPT_API_KEY is unavailable in the operator process' }

  $rootConfig = Get-Content -Raw -LiteralPath $rootConfigPath
  $accountId = [regex]::Match($rootConfig, '"account_id"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseName = [regex]::Match($rootConfig, '"database_name"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseId = [regex]::Match($rootConfig, '"database_id"\s*:\s*"([^"]+)"').Groups[1].Value
  if ([string]::IsNullOrWhiteSpace($accountId) -or [string]::IsNullOrWhiteSpace($databaseName) -or [string]::IsNullOrWhiteSpace($databaseId)) {
    throw 'Unable to resolve safe Cloudflare identifiers'
  }

  $secretBytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($secretBytes)
  $rng.Dispose()
  $smokeSecret = [Convert]::ToBase64String($secretBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

  $config = @"
{
  "`$schema": "./node_modules/wrangler/config-schema.json",
  "name": "$workerName",
  "account_id": "$accountId",
  "main": "scripts/phase05-live-smoke-worker.ts",
  "compatibility_date": "2026-08-14",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "SMOKE_SECRET": "$smokeSecret",
    "NEBULA_BASE_URL": "https://nebula-free-llm.nebula-ai-company.workers.dev/v1",
    "NEBULA_MODEL": "auto",
    "GOD_PROVIDER": "openai",
    "GOD_BASE_URL": "https://api.openai.com/v1",
    "GOD_MODEL": "gpt-5.6-luna",
    "GOD_REASONING_EFFORT": "xhigh"
  },
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

  $env:CLOUDFLARE_ACCOUNT_ID = $accountId
  $deployed = $true
  $null = Invoke-WranglerOutput @('deploy', '--config', $configFile, '--name', $workerName)
  $workerUrl = 'https://' + $workerName + '.mathofdynamic.workers.dev'
  Write-Output ('TEMPORARY_WORKER_URL=' + $workerUrl)

  Install-TemporarySecret 'NEBULA_API_KEY' $nebulaKey
  Install-TemporarySecret 'GOD_API_KEY' $gptKey
  Write-Output 'TEMPORARY_SECRETS_INSTALLED=true'

  Add-Type -AssemblyName System.Net.Http
  $http = [System.Net.Http.HttpClient]::new()
  $http.Timeout = [TimeSpan]::FromMinutes(4)
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
      $readyResponse = $http.GetAsync($workerUrl + '/__luma_phase05_smoke/ready').Result
      if ($readyResponse.IsSuccessStatusCode) { $ready = $true; break }
    } catch {
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Temporary smoke Worker did not become ready' }
  Write-Output 'TEMPORARY_WORKER_READY=true'

  $rag = $null
  if (-not $SkipRag) {
    $rag = Invoke-SmokeRequest $workerUrl '/rag' @{}
    Write-Output ('RAG_SMOKE=' + ($rag | ConvertTo-Json -Compress -Depth 20))
  } else {
    Write-Output 'RAG_SMOKE=skipped'
  }

  if ($RagOnly) {
    return
  }

  $workspace = Invoke-SmokeRequest $workerUrl '/workspace' @{}
  Write-Output ('WORKSPACE_SMOKE=' + ($workspace | ConvertTo-Json -Compress -Depth 20))

  $godKey = 'phase05-live-manual-god:' + [Guid]::NewGuid().ToString('N')
  $god = Invoke-SmokeRequest $workerUrl '/god' @{ idempotencyKey = $godKey }
  Write-Output ('GOD_SMOKE=' + ($god | ConvertTo-Json -Compress -Depth 20))
  if ([string]$god.status -ne 'completed') { throw 'Real GOD review did not complete successfully' }

  $sourceThreadId = if ($null -ne $rag) { [string]$rag.threadId } else { [string]$workspace.runtime.threadId }
  $reputation = Invoke-SmokeRequest $workerUrl '/reputation' @{ sourceThreadId = $sourceThreadId; reviewId = [string]$god.reviewId }
  Write-Output ('REPUTATION_SMOKE=' + ($reputation | ConvertTo-Json -Compress -Depth 20))
} finally {
  Stop-TemporaryWorker
  if ($null -ne $http) { $http.Dispose() }
  if (Test-Path -LiteralPath $configFile) { Remove-Item -LiteralPath $configFile -Force }
}
