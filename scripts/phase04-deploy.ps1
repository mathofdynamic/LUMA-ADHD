[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^-?\d+$')]
  [string]$GroupId,

  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ })]
  [string]$TokenFilePath,

  [ValidateRange(1, 3)]
  [int]$RetryCount = 3
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tokenFile = (Resolve-Path -LiteralPath $TokenFilePath).Path
$configFile = $null
$http = $null

function Read-Tokens([string]$Path) {
  $values = @{}
  foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
    if ($line -match '^\s*@?([^:]+)\s*:\s*"([^"]+)"\s*$') {
      $values[$matches[1].Trim()] = $matches[2]
    }
  }
  return $values
}

function Stop-Safely([System.Net.Http.HttpClient]$Client) {
  if ($null -ne $Client) { $Client.Dispose() }
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

$tokens = Read-Tokens $tokenFile
foreach ($alias in $mapping.Keys) {
  if (-not $tokens.ContainsKey($mapping[$alias].label)) { throw "Missing Telegram token for $alias" }
}

Add-Type -AssemblyName System.Net.Http
$http = [System.Net.Http.HttpClient]::new()
try {
  $identities = [ordered]@{}
  foreach ($alias in $mapping.Keys) {
    try {
      $body = $http.GetStringAsync(('https://api.telegram.org/bot' + $tokens[$mapping[$alias].label] + '/getMe')).Result | ConvertFrom-Json
    } catch { throw "Telegram identity verification failed for $alias" }
    if (-not $body.ok -or [string]$body.result.username -cne $mapping[$alias].expected) {
      throw "Telegram identity verification failed for $alias"
    }
    $identities[$alias] = [ordered]@{ telegramUserId = [string]$body.result.id; username = [string]$body.result.username }
  }

  try {
    $admins = $http.GetStringAsync(('https://api.telegram.org/bot' + $tokens['Luma_CenterBot'] + '/getChatAdministrators?chat_id=' + $GroupId)).Result | ConvertFrom-Json
  } catch { throw 'Telegram group administrator lookup failed' }
  $creator = @($admins.result | Where-Object { $_.status -eq 'creator' } | Select-Object -First 1)
  if (-not $admins.ok -or $creator.Count -ne 1 -or $null -eq $creator[0].user.id) { throw 'Telegram group owner could not be resolved' }
  $ownerId = [string]$creator[0].user.id
  $identityJson = ($identities | ConvertTo-Json -Compress -Depth 4).Replace('\', '\\').Replace('"', '\"')

  $configFile = Join-Path $repoRoot ('.phase04-deploy-' + [Guid]::NewGuid().ToString('N') + '.wrangler.jsonc')
  $config = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'wrangler.jsonc') -Encoding UTF8
  $config = $config.Replace('"LUMA_ENVIRONMENT": "local"', '"LUMA_ENVIRONMENT": "production"')
  $config = $config.Replace('"TELEGRAM_GROUP_ID": ""', ('"TELEGRAM_GROUP_ID": "' + $GroupId + '"'))
  $config = $config.Replace('"TELEGRAM_ADMIN_USER_IDS": ""', ('"TELEGRAM_ADMIN_USER_IDS": "' + $ownerId + '"'))
  $config = $config.Replace('"TELEGRAM_BOT_IDENTITIES_JSON": "{}"', ('"TELEGRAM_BOT_IDENTITIES_JSON": "' + $identityJson + '"'))
  [System.IO.File]::WriteAllText($configFile, $config, [System.Text.UTF8Encoding]::new($false))

  $wranglerPath = (Resolve-Path (Join-Path $repoRoot 'node_modules\wrangler\bin\wrangler.js')).Path
  $deployed = $false
  $deployOutput = ''
  for ($attempt = 1; $attempt -le $RetryCount; $attempt += 1) {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $deployOutput = & node $wranglerPath deploy --config $configFile --keep-vars --minify 2>&1 | Out-String
    $deployExit = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    if ($deployExit -eq 0) { $deployed = $true; break }
    if ($attempt -lt $RetryCount) { Start-Sleep -Seconds 3 }
  }
  if (-not $deployed) { throw 'Phase 04 deployment failed after bounded retries' }
  $baseUrl = [regex]::Match($deployOutput, 'https://[A-Za-z0-9.-]+\.workers\.dev').Value
  if ([string]::IsNullOrWhiteSpace($baseUrl)) { throw 'Deployment completed without a workers.dev URL' }
  Write-Output 'PHASE04_DEPLOYED=true'
  Write-Output 'BOT_IDENTITIES_VERIFIED=9'
  Write-Output 'GROUP_OWNER_RESOLVED=true'
  Write-Output ('WORKER_BASE_URL=' + $baseUrl.TrimEnd('/'))
} finally {
  if ($null -ne $configFile -and (Test-Path -LiteralPath $configFile)) { [System.IO.File]::Delete($configFile) }
  Stop-Safely $http
}
