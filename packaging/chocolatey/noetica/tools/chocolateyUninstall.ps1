$ErrorActionPreference = 'Stop'

# Stop and remove service
$svc = Get-Service -Name 'Noetica' -ErrorAction SilentlyContinue
if ($svc) {
  Stop-Service -Name 'Noetica' -Force -ErrorAction SilentlyContinue
  $nssm = Get-Command nssm -ErrorAction SilentlyContinue
  if ($nssm) {
    & nssm remove Noetica confirm 2>&1 | Out-Null
  } else {
    sc.exe delete Noetica
  }
}

# Remove install dir
$installDir = "$env:ProgramFiles\Noetica"
if (Test-Path $installDir) {
  Remove-Item -Recurse -Force $installDir
}

# Remove SOURCEOS_NOETICA_URL env var
[Environment]::SetEnvironmentVariable('SOURCEOS_NOETICA_URL', $null, 'Machine')

Write-Host "Noetica uninstalled. Config preserved at $env:APPDATA\noetica"
