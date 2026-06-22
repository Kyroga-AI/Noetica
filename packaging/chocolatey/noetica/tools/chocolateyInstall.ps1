$ErrorActionPreference = 'Stop'

$packageName = 'noetica'
$installDir  = "$env:ProgramFiles\Noetica"
$servicePort = 8080

New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# ── Download Noetica release ──────────────────────────────────────────────────
$releaseBase = 'https://github.com/socioprophet/Noetica/releases/latest/download'
$buildAvailable = $false
try {
  $h = Invoke-WebRequest -Uri "$releaseBase/noetica-win64.zip" -Method Head -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
  $buildAvailable = ($h.StatusCode -eq 200)
} catch { $buildAvailable = $false }

if ($buildAvailable) {
  Write-Host "Installing Noetica from release..."
  Install-ChocolateyZipPackage -PackageName $packageName `
    -Url64bit "$releaseBase/noetica-win64.zip" `
    -UnzipLocation $installDir `
    -Checksum64 'SKIP' -ChecksumType64 'sha256'
} else {
  Write-Host "No pre-built release found — cloning from source..." -ForegroundColor Yellow

  # Check for Node.js
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "Node.js is required. Install with: choco install nodejs" }

  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    Write-Host "Cloning Noetica..."
    & git clone --depth 1 https://github.com/socioprophet/Noetica.git $installDir 2>&1 | Out-Null
    Push-Location $installDir
    & npm install --production 2>&1 | Out-Null
    Pop-Location
    Write-Host "  Noetica cloned and dependencies installed." -ForegroundColor Green
  } else {
    Write-Warning "git not found. Install with: choco install git"
    Write-Warning "Then run: git clone https://github.com/socioprophet/Noetica.git `"$installDir`""
  }
}

# ── Windows Service via NSSM ──────────────────────────────────────────────────
# Try to use NSSM (Non-Sucking Service Manager) for reliable service management
$nssmPath = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssmPath) {
  # Install NSSM via Chocolatey
  try {
    choco install nssm --yes --no-progress 2>&1 | Out-Null
    $nssmPath = Get-Command nssm -ErrorAction SilentlyContinue
  } catch {
    Write-Warning "NSSM not available — Noetica will not run as a Windows service."
    Write-Warning "Start manually: node `"$installDir\agent-machine\dist\server.js`" (Ollama must be running)"
  }
}

# Find the agent-machine backend entry point.
# Priority: bundled self-contained binary, then node dist\server.js.
$amBinary = $null
foreach ($bin in @("$installDir\agent-machine.exe", "$installDir\agent-machine\agent-machine.exe")) {
  if (Test-Path $bin) { $amBinary = $bin; break }
}

$serverEntry = $null
if (-not $amBinary) {
  foreach ($entry in @("$installDir\agent-machine\dist\server.js", "$installDir\dist\server.js")) {
    if (Test-Path $entry) { $serverEntry = $entry; break }
  }
}

# Fallback: build the agent-machine node dist from source if neither is present.
if (-not $amBinary -and -not $serverEntry) {
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm -and (Test-Path "$installDir\agent-machine\package.json")) {
    Write-Host "Building agent-machine backend from source..."
    Push-Location "$installDir\agent-machine"
    & npm install 2>&1 | Out-Null
    & npm run build 2>&1 | Out-Null
    Pop-Location
    if (Test-Path "$installDir\agent-machine\dist\server.js") {
      $serverEntry = "$installDir\agent-machine\dist\server.js"
    }
  }
}

# Write startup config (agent-machine backend)
$configContent = @"
{
  "NOETICA_AM_PORT": $servicePort,
  "OLLAMA_HOST": "http://127.0.0.1:11434",
  "platform": "windows",
  "service": true,
  "logFile": "$($env:APPDATA -replace '\\','/')/noetica/noetica.log"
}
"@
$configDir = "$env:APPDATA\noetica"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
Set-Content -Path "$configDir\config.json" -Value $configContent -Encoding UTF8

# Install as Windows service if NSSM available
if ($nssmPath -and ($amBinary -or $serverEntry)) {
  # Determine how NSSM should launch the agent-machine backend.
  if ($amBinary) {
    $svcExe = $amBinary
    $svcArgs = $null
    $svcDir = Split-Path -Parent $amBinary
  } else {
    $svcExe = (Get-Command node).Source
    $svcArgs = $serverEntry
    $svcDir = Split-Path -Parent $serverEntry
  }

  # Remove existing service if present
  $existing = Get-Service -Name 'Noetica' -ErrorAction SilentlyContinue
  if ($existing) {
    Stop-Service -Name 'Noetica' -Force -ErrorAction SilentlyContinue
    & nssm remove Noetica confirm 2>&1 | Out-Null
  }

  # Install service
  if ($svcArgs) {
    & nssm install Noetica $svcExe $svcArgs
  } else {
    & nssm install Noetica $svcExe
  }
  & nssm set Noetica AppDirectory $svcDir
  & nssm set Noetica AppEnvironmentExtra "NOETICA_AM_PORT=$servicePort" "OLLAMA_HOST=http://127.0.0.1:11434" "NODE_ENV=production" "NOETICA_CONFIG=$configDir\config.json"
  & nssm set Noetica DisplayName "Noetica agent-machine Backend"
  & nssm set Noetica Description "Self-hosted AI dialogue management backend (agent-machine, :8080) for TurtleTerm co-pilot. Requires a running Ollama instance."
  & nssm set Noetica Start SERVICE_AUTO_START
  & nssm set Noetica AppStdout "$configDir\noetica.log"
  & nssm set Noetica AppStderr "$configDir\noetica-error.log"
  & nssm set Noetica AppRotateFiles 1
  & nssm set Noetica AppRotateSeconds 86400

  Start-Service -Name 'Noetica' -ErrorAction SilentlyContinue

  # Wait up to 10s for health check
  $healthy = $false
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    try {
      $h = Invoke-RestMethod -Uri "http://localhost:$servicePort/health" -TimeoutSec 2 -ErrorAction Stop
      $healthy = $true; break
    } catch {}
  }

  if ($healthy) {
    Write-Host ""
    Write-Host "Noetica v0.4.11 (agent-machine) running as Windows service." -ForegroundColor Green
    Write-Host "  Port    : NOETICA_AM_PORT=$servicePort  ->  http://localhost:$servicePort"
    Write-Host "  Logs    : $configDir\noetica.log"
    Write-Host "  Service : sc query Noetica"
    Write-Host "  Note    : requires a running Ollama instance (OLLAMA_HOST=http://127.0.0.1:11434)."
  } else {
    Write-Warning "Noetica service started but health check timed out."
    Write-Warning "Check logs: $configDir\noetica-error.log"
    Write-Warning "Ensure Ollama is running (ollama serve) at OLLAMA_HOST=http://127.0.0.1:11434."
  }
} else {
  Write-Host ""
  Write-Host "Noetica (agent-machine) installed at $installDir" -ForegroundColor Green
  if ($amBinary) {
    Write-Host "  Start: `"$amBinary`""
  } elseif ($serverEntry) {
    Write-Host "  Start: node `"$serverEntry`""
  }
  Write-Host "  Health: http://localhost:$servicePort/health"
  Write-Host "  Note  : requires a running Ollama instance (ollama serve)."
}

# ── Set environment variable for TurtleTerm integration ───────────────────────
[Environment]::SetEnvironmentVariable('SOURCEOS_NOETICA_URL', "http://localhost:$servicePort", 'Machine')

# ── Create PowerShell management functions ────────────────────────────────────
$mgmtScript = @"
# Noetica management functions — auto-generated by Chocolatey installer

function Start-Noetica {
  Start-Service Noetica
  Write-Host 'Noetica started. Health: ' -NoNewline
  try { (Invoke-RestMethod http://localhost:$servicePort/health).status } catch { 'checking...' }
}

function Stop-Noetica {
  Stop-Service Noetica
  Write-Host 'Noetica stopped.'
}

function Get-NoeticalHealth {
  try {
    Invoke-RestMethod http://localhost:$servicePort/health | ConvertTo-Json
  } catch {
    Write-Warning 'Noetica not responding on :$servicePort'
  }
}

function Invoke-NoetliaChat {
  param([string]`$Message)
  Invoke-RestMethod -Method POST -Uri 'http://localhost:$servicePort/api/chat' ``
    -ContentType 'application/json' ``
    -Body (ConvertTo-Json @{ message = `$Message })
}

Set-Alias noetica-start  Start-Noetica
Set-Alias noetica-stop   Stop-Noetica
Set-Alias noetica-health Get-NoeticalHealth
Set-Alias noetica-chat   Invoke-NoetliaChat
"@
Set-Content -Path "$installDir\noetica-management.ps1" -Value $mgmtScript -Encoding UTF8

Write-Host ""
Write-Host "  TurtleTerm integration:"
Write-Host "    `$env:SOURCEOS_NOETICA_URL = 'http://localhost:$servicePort'"
Write-Host "    turtle-copilot use noetica"
Write-Host "    turtle-copilot start"
