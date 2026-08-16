[CmdletBinding()]
param(
  [switch]$FakeProvider,
  [switch]$PublishTelegram
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$godEnv = Join-Path $repoRoot '.god-env'

$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& git -C $repoRoot check-ignore --quiet -- .god-env 2>$null
$ignoredExitCode = $LASTEXITCODE
& git -C $repoRoot ls-files --error-unmatch -- .god-env 2>$null
$trackedExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction

if ($ignoredExitCode -ne 0) { throw '.god-env is not ignored by Git' }
if ($trackedExitCode -eq 0) { throw '.god-env is tracked by Git' }

if ($FakeProvider) {
  if ($PublishTelegram) { throw 'Fake GOD smoke cannot publish to Telegram' }
  Push-Location $repoRoot
  try {
    npx vitest run --config vitest.config.ts tests/reputation-god.test.ts --reporter=dot
    if ($LASTEXITCODE -ne 0) { throw 'Fake GOD smoke failed' }
  } finally {
    Pop-Location
  }
  Write-Output 'GOD_FAKE_SMOKE=passed'
  exit 0
}

if (-not (Test-Path -LiteralPath $godEnv)) {
  Write-Error 'GOD_PROVIDER_REQUIRED'
  Write-Error 'GOD_MODEL_REQUIRED'
  Write-Error 'GOD_API_SECRET_REQUIRED'
  Write-Error 'GOD_BASE_URL_REQUIRED if applicable'
  exit 2
}

throw 'A verified provider adapter is required before real GOD review execution. This script intentionally does not guess a provider protocol.'
