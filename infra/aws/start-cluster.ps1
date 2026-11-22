# kubeadm 클러스터(문서 3) 시작: cp → worker 순서. 내 공인 IP가 바뀌었으면 SSH · NodePort 규칙을 새 IP로 바꾼다
# 실행 전: $env:AWS_PROFILE = '<프로필>'. 공인 IP는 시작할 때마다 바뀐다

$env:AWS_REGION = if ($env:AWS_REGION) { $env:AWS_REGION } else { 'ap-northeast-2' }
$Org = 'ticketing'
$Project = 'k8s'
$Prefix = "$Org-$Project"
$FOrg = "Name=tag:Organization,Values=$Org"
$FProject = "Name=tag:Project,Values=$Project"

function Invoke-Aws {
  $out = & aws @args
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') 실패 (exit $LASTEXITCODE)" }
  return $out
}

function Get-Ids([string[]]$Names) {
  $NameValues = ($Names | ForEach-Object { "$Prefix-instance-$_" }) -join ','
  $Text = Invoke-Aws ec2 describe-instances --filters $FOrg $FProject "Name=tag:Name,Values=$NameValues" `
    'Name=instance-state-name,Values=stopped,stopping,pending,running' `
    --query 'Reservations[].Instances[].InstanceId' --output text
  @($Text -split '\s+' | Where-Object { $_ })
}

foreach ($group in @(@('cp'), @('worker1', 'worker2'))) {
  $Ids = Get-Ids $group
  Invoke-Aws ec2 start-instances --instance-ids $Ids | Out-Null
  Invoke-Aws ec2 wait instance-running --instance-ids $Ids | Out-Null
  Write-Host "running: $($group -join ' · ')"
}

# 내 IP 규칙(SSH 22, NodePort)을 현재 IP로 바꾼다
$MyIp = "$((curl.exe -4 -s https://checkip.amazonaws.com).Trim())/32"   # Invoke-RestMethod는 캐시된 예전 IP를 돌려줄 수 있어 curl.exe를 쓴다
$SgId = Invoke-Aws ec2 describe-security-groups --filters $FOrg $FProject `
  --query 'SecurityGroups[0].GroupId' --output text
$Rules = Invoke-Aws ec2 describe-security-groups --group-ids $SgId --output json | ConvertFrom-Json
foreach ($perm in $Rules.SecurityGroups[0].IpPermissions) {
  foreach ($range in $perm.IpRanges) {
    if ($range.CidrIp -ne $MyIp) {
      $p = "IpProtocol=tcp,FromPort=$($perm.FromPort),ToPort=$($perm.ToPort),IpRanges=[{CidrIp=$($range.CidrIp)}]"
      Invoke-Aws ec2 revoke-security-group-ingress --group-id $SgId --ip-permissions $p | Out-Null
      $p = "IpProtocol=tcp,FromPort=$($perm.FromPort),ToPort=$($perm.ToPort),IpRanges=[{CidrIp=$MyIp,Description=$($range.Description)}]"
      Invoke-Aws ec2 authorize-security-group-ingress --group-id $SgId --ip-permissions $p | Out-Null
      Write-Host "rule $($perm.FromPort): $($range.CidrIp) → $MyIp"
    }
  }
}

Invoke-Aws ec2 describe-instances --filters $FOrg $FProject 'Name=instance-state-name,Values=running' `
  --query 'sort_by(Reservations[].Instances[], &PrivateIpAddress)[].[Tags[?Key==`Name`]|[0].Value,PrivateIpAddress,PublicIpAddress]' `
  --output table
