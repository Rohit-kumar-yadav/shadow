$ErrorActionPreference = 'Stop'
$shadowRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $shadowRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or newer first.' }
if (-not (Test-Path -LiteralPath (Join-Path $shadowRoot 'node_modules'))) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
& npm.cmd start
