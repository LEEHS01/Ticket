# 세 노드의 현재 공인 IP로 SSH 설정 파일(infra/aws/ssh_config)을 만든다
# 공인 IP는 인스턴스를 시작할 때마다 바뀌므로, 클러스터를 만들거나 다시 시작한 뒤 실행한다
#   ssh -F infra\aws\ssh_config cp
# 실행 전: $env:AWS_PROFILE = '<프로필>'

$env:AWS_REGION = if ($env:AWS_REGION) { $env:AWS_REGION } else { 'ap-northeast-2' }
$Org = 'ticketing'
$Project = 'k8s'
$KeyFile = (Join-Path (Join-Path $HOME '.ssh') 'key-ticketing-k8s.pem') -replace '\\', '/'
$Dir = ($PSScriptRoot -replace '\\', '/')
$Out = Join-Path $PSScriptRoot 'ssh_config'

$Rows = & aws ec2 describe-instances `
  --filters "Name=tag:Organization,Values=$Org" "Name=tag:Project,Values=$Project" 'Name=instance-state-name,Values=running' `
  --query 'Reservations[].Instances[].[Tags[?Key==`Name`]|[0].Value,PublicIpAddress]' --output text
if ($LASTEXITCODE -ne 0 -or -not $Rows) { Write-Error '실행 중인 노드를 찾지 못했다'; exit 1 }

$Lines = @()
foreach ($row in $Rows) {
  $name, $ip = $row -split '\s+'
  $Lines += "Host $($name -replace '^.*-instance-', '')"
  $Lines += "  HostName $ip"
}
$Lines += 'Host cp worker1 worker2'
$Lines += '  User rocky'
$Lines += "  IdentityFile `"$KeyFile`""
$Lines += "  UserKnownHostsFile `"$Dir/known_hosts`""
$Lines += '  StrictHostKeyChecking accept-new'
$Lines += '  ServerAliveInterval 30'
$Lines += '  LogLevel ERROR'
# OpenSSH가 읽을 수 있도록 BOM 없는 UTF-8로 저장한다
[System.IO.File]::WriteAllLines($Out, $Lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "작성: $Out"
Get-Content $Out | Select-String -Pattern '^Host |HostName'
