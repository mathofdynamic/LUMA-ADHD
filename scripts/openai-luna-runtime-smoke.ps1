[CmdletBinding()]
param(
  [string]$Question = 'این یک تست محدود اپراتوری است؛ بدون ارسال تلگرام، یک پاسخ کوتاه و مستند درباره لوما بده.',
  [ValidateRange(1, 4)]
  [int]$MaxTurns = 1,
  [string]$AddressedAgentId = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$rootConfigPath = Join-Path $repoRoot 'wrangler.jsonc'
$configFile = Join-Path $repoRoot ('postv1-luna-smoke-' + [Guid]::NewGuid().ToString('N') + '.wrangler.jsonc')
$workerName = 'luma-adhd-postv1-luna-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$smokeSecret = $null
$deployed = $false
$http = $null

function Invoke-Wrangler([string[]]$Arguments) {
  $output = (& npx wrangler @Arguments 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw ('Wrangler command failed with exit code ' + $LASTEXITCODE) }
  return $output
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
  $process.StandardInput.WriteLine($SecretValue)
  $process.StandardInput.Close()
  $process.WaitForExit()
  $null = $stdoutTask.Result
  $null = $stderrTask.Result
  if ($process.ExitCode -ne 0) { throw ('Temporary Worker secret installation failed for ' + $SecretName) }
}

try {
  $gptKey = [Environment]::GetEnvironmentVariable('GPT_API_KEY', 'Process')
  Write-Output ('GPT_API_KEY_AVAILABLE=' + (-not [string]::IsNullOrWhiteSpace($gptKey)))
  if ([string]::IsNullOrWhiteSpace($gptKey)) { throw 'GPT_API_KEY is unavailable in the operator process' }

  $rootConfig = Get-Content -Raw -LiteralPath $rootConfigPath
  $accountId = [regex]::Match($rootConfig, '"account_id"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseName = [regex]::Match($rootConfig, '"database_name"\s*:\s*"([^"]+)"').Groups[1].Value
  $databaseId = [regex]::Match($rootConfig, '"database_id"\s*:\s*"([^"]+)"').Groups[1].Value
  if ([string]::IsNullOrWhiteSpace($accountId) -or [string]::IsNullOrWhiteSpace($databaseName) -or [string]::IsNullOrWhiteSpace($databaseId)) { throw 'Unable to resolve safe Cloudflare identifiers' }

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
  "main": "scripts/openai-luna-runtime-smoke-worker.ts",
  "compatibility_date": "2026-08-14",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "SMOKE_SECRET": "$smokeSecret",
    "NORMAL_AGENT_PROVIDER": "openai",
    "NORMAL_AGENT_BASE_URL": "https://api.openai.com/v1",
    "NORMAL_AGENT_MODEL": "gpt-5.6-luna",
    "NORMAL_AGENT_REASONING_EFFORT": "medium",
    "NEBULA_BASE_URL": "https://nebula-free-llm.nebula-ai-company.workers.dev/v1",
    "NEBULA_MODEL": "auto"
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
  $null = Invoke-Wrangler @('deploy', '--config', $configFile, '--name', $workerName)
  $deployed = $true
  $workerUrl = 'https://' + $workerName + '.mathofdynamic.workers.dev'
  Add-Type -AssemblyName System.Net.Http
  $http = [System.Net.Http.HttpClient]::new()
  $http.Timeout = [TimeSpan]::FromMinutes(4)
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
      $readyResponse = $http.GetAsync($workerUrl + '/__luma_luna_smoke/ready').Result
      if ($readyResponse.IsSuccessStatusCode) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Temporary Luna smoke Worker did not become ready' }
  Install-TemporarySecret 'OPENAI_API_KEY' $gptKey
  $secretNames = Invoke-Wrangler @('secret', 'list', '--config', $configFile, '--name', $workerName)
  if ($secretNames -notmatch 'OPENAI_API_KEY') { throw 'Temporary Luna smoke Worker secret was not registered' }
  $configured = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
      $configRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, ($workerUrl + '/__luma_luna_smoke/config'))
      $configRequest.Headers.Add('X-Luma-Smoke-Secret', $smokeSecret)
      $configResponse = $http.SendAsync($configRequest).Result
      $configBody = $configResponse.Content.ReadAsStringAsync().Result | ConvertFrom-Json
      if ($configResponse.IsSuccessStatusCode -and $configBody.openaiConfigured -eq $true) { $configured = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $configured) { throw 'Temporary Luna smoke Worker secret was not available at the runtime edge' }
  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, ($workerUrl + '/run'))
  $request.Headers.Add('X-Luma-Smoke-Secret', $smokeSecret)
  $requestBody = @{ question = $Question; maxTurns = $MaxTurns; addressedAgentId = if ([string]::IsNullOrWhiteSpace($AddressedAgentId)) { $null } else { $AddressedAgentId } } | ConvertTo-Json -Compress
  $request.Content = [System.Net.Http.StringContent]::new($requestBody, [System.Text.Encoding]::UTF8, 'application/json')
  $response = $http.SendAsync($request).Result
  $body = $response.Content.ReadAsStringAsync().Result
  if (-not $response.IsSuccessStatusCode) {
    Write-Output ('LUNA_RUNTIME_SMOKE_FAILURE=' + $body)
    throw ('Luna runtime smoke failed with HTTP ' + [int]$response.StatusCode)
  }
  Write-Output ('LUNA_RUNTIME_SMOKE=' + $body)
} finally {
  if ($deployed) { try { $null = Invoke-Wrangler @('delete', '--config', $configFile, '--name', $workerName, '--force'); Write-Output 'TEMPORARY_WORKER_DELETE=success' } catch { Write-Output 'TEMPORARY_WORKER_DELETE=failed' } }
  if ($null -ne $http) { $http.Dispose() }
  if (Test-Path -LiteralPath $configFile) { Remove-Item -LiteralPath $configFile -Force }
}
