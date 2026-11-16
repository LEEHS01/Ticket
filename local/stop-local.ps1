# run-local.ps1로 띄운 백엔드(WSL)와 화면(Windows)을 종료한다. MySQL과 Redis는 건드리지 않는다.
$runDir = Join-Path $PSScriptRoot '.run'

# 백엔드: WSL 안의 java 프로세스를 정상 종료(SIGTERM → graceful shutdown)
& wsl.exe -e pkill -f 'target/app.jar' 2>$null
Write-Host '백엔드 종료 요청'

foreach ($name in 'backend', 'frontend') {
    $pidFile = Join-Path $runDir "$name.pid"
    if (Test-Path $pidFile) {
        $id = Get-Content $pidFile
        # 자식 프로세스(npm → node)까지 함께 종료
        & taskkill /PID $id /T /F 2>$null | Out-Null
        Remove-Item $pidFile -Force
        Write-Host "$name 종료 (PID $id)"
    }
}
