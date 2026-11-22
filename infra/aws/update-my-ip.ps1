# 보안 그룹의 "내 IP" 규칙(SSH 22, NodePort)을 현재 공인 IP로 바꾼다
# 공인 IP가 바뀌어 SSH나 NodePort 접속이 시간 초과로 실패할 때 실행한다
# 실행 전: $env:AWS_PROFILE = '<프로필>'

$env:AWS_REGION = if ($env:AWS_REGION) { $env:AWS_REGION } else { 'ap-northeast-2' }
$Org = 'ticketing'
$Project = 'k8s'
$FOrg = "Name=tag:Organization,Values=$Org"
$FProject = "Name=tag:Project,Values=$Project"

function Invoke-Aws {
  $out = & aws @args
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') 실패 (exit $LASTEXITCODE)" }
  return $out
}

$MyIp = "$((curl.exe -4 -s https://checkip.amazonaws.com).Trim())/32"   # Invoke-RestMethod는 캐시된 예전 IP를 돌려줄 수 있어 curl.exe를 쓴다
$SgId = Invoke-Aws ec2 describe-security-groups --filters $FOrg $FProject `
  --query 'SecurityGroups[0].GroupId' --output text
$Rules = Invoke-Aws ec2 describe-security-groups --group-ids $SgId --output json | ConvertFrom-Json
$Changed = 0
foreach ($perm in $Rules.SecurityGroups[0].IpPermissions) {
  foreach ($range in $perm.IpRanges) {
    if ($range.CidrIp -ne $MyIp) {
      $p = "IpProtocol=tcp,FromPort=$($perm.FromPort),ToPort=$($perm.ToPort),IpRanges=[{CidrIp=$($range.CidrIp)}]"
      Invoke-Aws ec2 revoke-security-group-ingress --group-id $SgId --ip-permissions $p | Out-Null
      $p = "IpProtocol=tcp,FromPort=$($perm.FromPort),ToPort=$($perm.ToPort),IpRanges=[{CidrIp=$MyIp,Description=$($range.Description)}]"
      Invoke-Aws ec2 authorize-security-group-ingress --group-id $SgId --ip-permissions $p | Out-Null
      Write-Host "rule $($perm.FromPort): $($range.CidrIp) -> $MyIp"
      $Changed++
    }
  }
}
if ($Changed -eq 0) { Write-Host "변경 없음: 규칙이 이미 $MyIp 이다" }
