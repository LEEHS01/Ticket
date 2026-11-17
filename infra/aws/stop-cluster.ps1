# ③ 클러스터 정지: worker → cp 순서 (원본: 수업 실습의 aws/stop-cluster.ps1, 자원 이름만 바꿈)
# 실행 전: $env:AWS_PROFILE = '<프로필>'. 정지 중에는 EBS 볼륨 요금만 나온다

$env:AWS_REGION = if ($env:AWS_REGION) { $env:AWS_REGION } else { 'ap-northeast-2' }
$Org = 'ticketing'
$Project = 'k8s'
$Prefix = "$Org-$Project"

# aws 명령을 실행하고 실패하면 중단한다
function Invoke-Aws {
  $out = & aws @args
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') 실패 (exit $LASTEXITCODE)" }
  return $out
}

# 실행 중인 노드의 인스턴스 ID를 조회한다
function Get-RunningIds([string[]]$Names) {
  $NameValues = ($Names | ForEach-Object { "$Prefix-instance-$_" }) -join ','
  $Text = Invoke-Aws ec2 describe-instances `
    --filters "Name=tag:Organization,Values=$Org" "Name=tag:Project,Values=$Project" `
              "Name=tag:Name,Values=$NameValues" `
              'Name=instance-state-name,Values=pending,running' `
    --query 'Reservations[].Instances[].InstanceId' --output text
  @($Text -split '\s+' | Where-Object { $_ })
}

$Workers = Get-RunningIds @('worker1', 'worker2')
if ($Workers.Count -gt 0) {
  Invoke-Aws ec2 stop-instances --instance-ids $Workers | Out-Null
  Invoke-Aws ec2 wait instance-stopped --instance-ids $Workers | Out-Null
  Write-Host 'stopped: worker1 · worker2'
}

$Cp = Get-RunningIds @('cp')
if ($Cp.Count -gt 0) {
  Invoke-Aws ec2 stop-instances --instance-ids $Cp | Out-Null
  Invoke-Aws ec2 wait instance-stopped --instance-ids $Cp | Out-Null
  Write-Host 'stopped: cp'
}
