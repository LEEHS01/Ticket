# kubeadm 클러스터(문서 3) 삭제: Organization=ticketing · Project=k8s 태그 자원을 생성의 역순으로 삭제한다
# 원본: 수업 실습의 aws/delete-cluster.ps1. 자원 이름을 바꾸고 키 파일 권한 처리를 더했다
# 실행 전: $env:AWS_PROFILE = '<프로필>'

$env:AWS_REGION = if ($env:AWS_REGION) { $env:AWS_REGION } else { 'ap-northeast-2' }
$Org = 'ticketing'
$Project = 'k8s'
$KeyName = 'key-ticketing-k8s'
$KeyFile = Join-Path (Join-Path $HOME '.ssh') "$KeyName.pem"
$FOrg = "Name=tag:Organization,Values=$Org"
$FProject = "Name=tag:Project,Values=$Project"

# aws 명령을 실행하고 실패하면 중단한다
function Invoke-Aws {
  $out = & aws @args
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') 실패 (exit $LASTEXITCODE)" }
  return $out
}

# --output text 의 공백 · 탭 구분 값을 목록으로 바꾼다
function Split-Ids($Text) { @($Text -split '\s+' | Where-Object { $_ }) }

$Ids = Split-Ids (Invoke-Aws ec2 describe-instances --filters $FOrg $FProject `
  'Name=instance-state-name,Values=pending,running,stopping,stopped' `
  --query 'Reservations[].Instances[].InstanceId' --output text)
if ($Ids.Count -gt 0) {
  Invoke-Aws ec2 terminate-instances --instance-ids $Ids | Out-Null
  Invoke-Aws ec2 wait instance-terminated --instance-ids $Ids | Out-Null
  Write-Host "terminated: $($Ids -join ' ')"
}

foreach ($Sg in Split-Ids (Invoke-Aws ec2 describe-security-groups --filters $FOrg $FProject --query 'SecurityGroups[].GroupId' --output text)) {
  Invoke-Aws ec2 delete-security-group --group-id $Sg | Out-Null
  Write-Host "deleted: $Sg"
}

foreach ($Rtb in Split-Ids (Invoke-Aws ec2 describe-route-tables --filters $FOrg $FProject --query 'RouteTables[].RouteTableId' --output text)) {
  foreach ($Assoc in Split-Ids (Invoke-Aws ec2 describe-route-tables --route-table-ids $Rtb `
      --query 'RouteTables[0].Associations[?!Main].RouteTableAssociationId' --output text)) {
    Invoke-Aws ec2 disassociate-route-table --association-id $Assoc | Out-Null
  }
  Invoke-Aws ec2 delete-route-table --route-table-id $Rtb | Out-Null
  Write-Host "deleted: $Rtb"
}

foreach ($Subnet in Split-Ids (Invoke-Aws ec2 describe-subnets --filters $FOrg $FProject --query 'Subnets[].SubnetId' --output text)) {
  Invoke-Aws ec2 delete-subnet --subnet-id $Subnet | Out-Null
  Write-Host "deleted: $Subnet"
}

foreach ($Vpc in Split-Ids (Invoke-Aws ec2 describe-vpcs --filters $FOrg $FProject --query 'Vpcs[].VpcId' --output text)) {
  foreach ($Igw in Split-Ids (Invoke-Aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$Vpc" `
      --query 'InternetGateways[].InternetGatewayId' --output text)) {
    Invoke-Aws ec2 detach-internet-gateway --internet-gateway-id $Igw --vpc-id $Vpc | Out-Null
    Invoke-Aws ec2 delete-internet-gateway --internet-gateway-id $Igw | Out-Null
    Write-Host "deleted: $Igw"
  }
  Invoke-Aws ec2 delete-vpc --vpc-id $Vpc | Out-Null
  Write-Host "deleted: $Vpc"
}

& aws ec2 describe-key-pairs --key-names $KeyName *> $null
if ($LASTEXITCODE -eq 0) {
  Invoke-Aws ec2 delete-key-pair --key-name $KeyName | Out-Null
  Write-Host "deleted: key pair $KeyName"
}
# AWS 키 페어가 없으면 로컬 개인 키도 쓸 수 없으므로 함께 삭제한다
if (Test-Path $KeyFile) {
  icacls $KeyFile /grant:r "$($env:USERNAME):(F)" | Out-Null   # 읽기 전용으로 만든 키 파일을 지울 수 있게 한다
  Remove-Item -Force $KeyFile
  Write-Host "deleted: $KeyFile"
}
