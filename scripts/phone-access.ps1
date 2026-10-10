$ErrorActionPreference = 'Stop'
$shadowTailscaleCommand = Get-Command tailscale -ErrorAction SilentlyContinue
$shadowTailscaleExecutable = 'C:\Program Files\Tailscale\tailscale.exe'
if ($shadowTailscaleCommand) { $shadowTailscaleExecutable = $shadowTailscaleCommand.Source }
if (-not (Test-Path -LiteralPath $shadowTailscaleExecutable)) { throw 'Install Tailscale on your PC and phone, sign in to the same network, then run this script again.' }
& $shadowTailscaleExecutable serve --bg http://127.0.0.1:4310
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve setup failed. Complete any Tailscale sign-in or HTTPS setup shown above.' }
Write-Host 'Save the HTTPS .ts.net address in Shadow Settings, then generate a pairing code for your phone.'
Write-Host 'Keep Shadow running and your PC awake.'
