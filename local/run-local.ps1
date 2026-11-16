# 미리내 마당을 Docker 없이 이 PC에서 실행한다.
#   백엔드·MySQL·Redis : WSL(Ubuntu) 안에서
#   화면(프론트엔드)    : Windows의 Node.js(Vite 개발 서버)
#
#   사용:  powershell -ExecutionPolicy Bypass -File .\local\run-local.ps1
#   종료:  powershell -ExecutionPolicy Bypass -File .\local\stop-local.ps1
#
# 화면 http://localhost:5173 , 백엔드 http://localhost:18080 (8080은 WSL의 다른 서버가 사용 중)
# 실행 전에 WSL에서 MySQL과 Redis가 켜져 있어야 한다(README-local.md 참고).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'frontend'
$runDir = Join-Path $PSScriptRoot '.run'
New-Item -ItemType Directory -Force $runDir | Out-Null

function Fail($msg) { Write-Host "[중단] $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "[확인] $msg" -ForegroundColor Green }
function Test-Port($port) {
    # IPv4(127.0.0.1)와 IPv6(::1)를 둘 다 확인한다. Vite는 ::1로만, WSL 중계는 127.0.0.1로 열릴 수 있다.
    foreach ($addr in '127.0.0.1', '::1') {
        $ip = [System.Net.IPAddress]::Parse($addr)
        $c = New-Object System.Net.Sockets.TcpClient($ip.AddressFamily)
        try { $c.Connect($ip, $port); return $true } catch { } finally { $c.Close() }
    }
    return $false
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js를 찾지 못했습니다.' }
if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) { Fail 'WSL을 찾지 못했습니다.' }
if (Test-Port 18080) { Fail '18080 포트가 이미 쓰이고 있습니다. 먼저 stop-local.ps1을 실행하세요.' }
if (Test-Port 5173) { Fail '5173 포트가 이미 쓰이고 있습니다. 먼저 stop-local.ps1을 실행하세요.' }

# ---------- 1) 백엔드 (WSL) ----------
# run-backend.sh가 준비물 확인, 빌드, 마이그레이션, 서버 실행을 차례로 한다.
Write-Host '백엔드를 시작합니다(WSL). 처음이거나 코드가 바뀌었으면 빌드에 1~2분 걸립니다...'
$be = Start-Process -FilePath 'wsl.exe' -ArgumentList '-e', 'bash', './run-backend.sh' -WorkingDirectory $PSScriptRoot `
    -RedirectStandardOutput (Join-Path $runDir 'backend.log') -RedirectStandardError (Join-Path $runDir 'backend.err.log') `
    -WindowStyle Hidden -PassThru
$be.Id | Set-Content (Join-Path $runDir 'backend.pid')

$ready = $false
foreach ($i in 1..240) {
    Start-Sleep -Seconds 1
    if ($be.HasExited) { break }
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:18080/readyz'
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
}
if (-not $ready) {
    Write-Host '--- 백엔드 로그 끝부분 ---'
    Get-Content (Join-Path $runDir 'backend.err.log'), (Join-Path $runDir 'backend.log') -Tail 8 -Encoding UTF8 -ErrorAction SilentlyContinue
    Fail "백엔드가 준비되지 않았습니다. 로그: $runDir"
}
Ok '백엔드 http://localhost:18080 준비됨'

# ---------- 2) 화면 (Windows, Vite 개발 서버. /api 요청은 백엔드로 전달) ----------
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Push-Location $frontend; & npm ci; Pop-Location
}
$env:API_PROXY = 'http://127.0.0.1:18080'
$fe = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev' -WorkingDirectory $frontend `
    -RedirectStandardOutput (Join-Path $runDir 'frontend.log') -RedirectStandardError (Join-Path $runDir 'frontend.err.log') `
    -WindowStyle Hidden -PassThru
$fe.Id | Set-Content (Join-Path $runDir 'frontend.pid')

$up = $false
foreach ($i in 1..30) { Start-Sleep -Seconds 1; if (Test-Port 5173) { $up = $true; break } }
if (-not $up) { Fail "화면이 뜨지 않았습니다. 로그: $(Join-Path $runDir 'frontend.log')" }

Ok '화면 http://localhost:5173 준비됨'
Write-Host ''
Write-Host '실행 중입니다. 브라우저에서 http://localhost:5173 을 여세요.' -ForegroundColor Cyan
Write-Host "로그: $runDir"
Write-Host '종료: powershell -ExecutionPolicy Bypass -File .\local\stop-local.ps1'
