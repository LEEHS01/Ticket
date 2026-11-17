# 미리내 마당 ③ 단계 클러스터 (AWS EC2): cp · worker1 · worker2
# VPC · 서브넷 · 보안 그룹 · 키 페어 · EC2 3대를 AWS CLI로 한 번에 만든다
#
# VPC 192.168.0.0/16, 퍼블릭 서브넷 192.168.56.0/24, 사설 IP .10 · .11 · .12 고정
# Rocky Linux 9 공식 AMI(x86_64), t3.medium, 루트 볼륨 30GB gp3
# 자원 이름: {Organization}-{Project}-{capability}-{identity}, 태그 Name · Organization · Project
# Windows PowerShell 5.1 · PowerShell 7 공용. 실행 전: $env:AWS_PROFILE = '<프로필>'

$Region = if ($env:AWS_REGION) { $env:AWS_REGION } else { 'ap-northeast-2' }
$AZ = "${Region}a"
$Org = 'ticketing'
$Project = 'k8s'
$Prefix = "$Org-$Project"
$KeyName = 'key-ticketing-k8s'
$SshDir = Join-Path $HOME '.ssh'
$KeyFile = Join-Path $SshDir "$KeyName.pem"
$InstanceType = 't3.medium'
$VolumeSize = 30
$AmiOwner = '792107900819'   # Rocky Enterprise Software Foundation
$NodePort = 30080            # gateway Service의 NodePort. 밖에서 여는 앱 포트는 이것 하나다

$Nodes = @(
  @{ Name = 'cp';      Ip = '192.168.56.10' },
  @{ Name = 'worker1'; Ip = '192.168.56.11' },
  @{ Name = 'worker2'; Ip = '192.168.56.12' }
)

$env:AWS_REGION = $Region

# aws 명령을 실행하고 실패하면 중단한다
function Invoke-Aws {
  $out = & aws @args
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') 실패 (exit $LASTEXITCODE)" }
  return $out
}

function Get-Tags([string]$Type, [string]$Name) {
  "ResourceType=$Type,Tags=[{Key=Name,Value=$Name},{Key=Organization,Value=$Org},{Key=Project,Value=$Project}]"
}
$FOrg = "Name=tag:Organization,Values=$Org"
$FProject = "Name=tag:Project,Values=$Project"

# 같은 Organization · Project 태그의 VPC가 있으면 중단한다
if ((Invoke-Aws ec2 describe-vpcs --filters $FOrg $FProject --query 'length(Vpcs)' --output text) -ne '0') {
  Write-Error "이미 $Prefix 자원이 있다. delete-cluster.ps1 로 정리한 뒤 다시 실행한다."
  exit 1
}

$MyIp = "$((Invoke-RestMethod -Uri 'https://checkip.amazonaws.com').Trim())/32"

$AmiId = Invoke-Aws ec2 describe-images --owners $AmiOwner `
  --filters 'Name=name,Values=Rocky-9-EC2-Base-9.*' 'Name=architecture,Values=x86_64' `
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text
Write-Host "AMI: $AmiId"

# 네트워크
$VpcId = Invoke-Aws ec2 create-vpc --cidr-block 192.168.0.0/16 `
  --tag-specifications (Get-Tags vpc "$Prefix-vpc") --query Vpc.VpcId --output text
Invoke-Aws ec2 modify-vpc-attribute --vpc-id $VpcId --enable-dns-hostnames | Out-Null
Write-Host "VPC: $VpcId"

$IgwId = Invoke-Aws ec2 create-internet-gateway `
  --tag-specifications (Get-Tags internet-gateway "$Prefix-igw") `
  --query InternetGateway.InternetGatewayId --output text
Invoke-Aws ec2 attach-internet-gateway --internet-gateway-id $IgwId --vpc-id $VpcId | Out-Null
Write-Host "IGW: $IgwId"

$SubnetId = Invoke-Aws ec2 create-subnet --vpc-id $VpcId --cidr-block 192.168.56.0/24 `
  --availability-zone $AZ `
  --tag-specifications (Get-Tags subnet "$Prefix-subnet-public-a") `
  --query Subnet.SubnetId --output text
Invoke-Aws ec2 modify-subnet-attribute --subnet-id $SubnetId --map-public-ip-on-launch | Out-Null
Write-Host "Subnet: $SubnetId"

$RtbId = Invoke-Aws ec2 create-route-table --vpc-id $VpcId `
  --tag-specifications (Get-Tags route-table "$Prefix-rtb-public") `
  --query RouteTable.RouteTableId --output text
Invoke-Aws ec2 create-route --route-table-id $RtbId --destination-cidr-block 0.0.0.0/0 `
  --gateway-id $IgwId | Out-Null
Invoke-Aws ec2 associate-route-table --route-table-id $RtbId --subnet-id $SubnetId | Out-Null
Write-Host "Route table: $RtbId"

# 보안 그룹: 필요한 포트만 연다
#   노드 사이(같은 보안 그룹): API 서버 6443, kubelet 10250, Calico BGP 179, Calico IP-in-IP(IP 프로토콜 4)
#   내 IP: SSH 22, gateway NodePort 하나
#   etcd(2379-2380)와 scheduler · controller-manager(10257 · 10259)는 cp 안에서만 쓰므로 열지 않는다
$SgId = Invoke-Aws ec2 create-security-group --vpc-id $VpcId --group-name "$Prefix-sg-node" `
  --description 'ticketing kubeadm cluster nodes' `
  --tag-specifications (Get-Tags security-group "$Prefix-sg-node") `
  --query GroupId --output text
Invoke-Aws ec2 authorize-security-group-ingress --group-id $SgId `
  --ip-permissions "IpProtocol=tcp,FromPort=6443,ToPort=6443,UserIdGroupPairs=[{GroupId=$SgId,Description=kube-apiserver}]" `
                   "IpProtocol=tcp,FromPort=10250,ToPort=10250,UserIdGroupPairs=[{GroupId=$SgId,Description=kubelet}]" `
                   "IpProtocol=tcp,FromPort=179,ToPort=179,UserIdGroupPairs=[{GroupId=$SgId,Description=calico-bgp}]" `
                   "IpProtocol=4,UserIdGroupPairs=[{GroupId=$SgId,Description=calico-ipip}]" | Out-Null
Invoke-Aws ec2 authorize-security-group-ingress --group-id $SgId `
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$MyIp,Description=ssh}]" `
                   "IpProtocol=tcp,FromPort=$NodePort,ToPort=$NodePort,IpRanges=[{CidrIp=$MyIp,Description=gateway-nodeport}]" | Out-Null
Write-Host "Security group: $SgId (SSH · NodePort $NodePort 허용: $MyIp)"

# 키 페어: 없으면 만들고 개인 키를 로컬에 저장한다
& aws ec2 describe-key-pairs --key-names $KeyName *> $null
if ($LASTEXITCODE -ne 0) {
  New-Item -ItemType Directory -Force -Path $SshDir | Out-Null
  if (Test-Path $KeyFile) { Remove-Item -Force $KeyFile }   # AWS에 없는 키의 남은 로컬 파일
  $KeyMaterial = Invoke-Aws ec2 create-key-pair --key-name $KeyName --key-type ed25519 `
    --tag-specifications (Get-Tags key-pair $KeyName) `
    --query KeyMaterial --output text
  # OpenSSH가 읽을 수 있도록 BOM 없는 ASCII · LF 줄바꿈으로 저장한다
  [System.IO.File]::WriteAllText($KeyFile, (($KeyMaterial -join "`n") + "`n"), [System.Text.Encoding]::ASCII)
  # chmod 400 대응: 상속을 제거하고 현재 사용자에게만 읽기 권한을 준다
  icacls $KeyFile /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
  Write-Host "Key pair: $KeyName → $KeyFile"
}

# 인스턴스: 사설 IP 고정, cloud-init으로 호스트명 지정
foreach ($node in $Nodes) {
  $name = $node.Name; $ip = $node.Ip
  $UserDataFile = Join-Path ([System.IO.Path]::GetTempPath()) "ticketing-userdata-$name.yaml"
  [System.IO.File]::WriteAllText($UserDataFile, "#cloud-config`nhostname: $name`nfqdn: $name`n", [System.Text.Encoding]::ASCII)
  Invoke-Aws ec2 run-instances --image-id $AmiId --instance-type $InstanceType `
    --key-name $KeyName --subnet-id $SubnetId --private-ip-address $ip `
    --security-group-ids $SgId `
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$VolumeSize,VolumeType=gp3}" `
    --user-data "file://$UserDataFile" `
    --tag-specifications (Get-Tags instance "$Prefix-instance-$name") (Get-Tags volume "$Prefix-volume-$name") `
    --query 'Instances[0].InstanceId' --output text | Out-Null
  Remove-Item -Force $UserDataFile
  Write-Host "Instance: $name ($ip)"
}

$Ids = (Invoke-Aws ec2 describe-instances --filters $FOrg $FProject `
  'Name=instance-state-name,Values=pending,running' --query 'Reservations[].Instances[].InstanceId' --output text) -split '\s+' |
  Where-Object { $_ }
Invoke-Aws ec2 wait instance-running --instance-ids $Ids | Out-Null

Invoke-Aws ec2 describe-instances --filters $FOrg $FProject 'Name=instance-state-name,Values=running' `
  --query 'sort_by(Reservations[].Instances[], &PrivateIpAddress)[].[Tags[?Key==`Name`]|[0].Value,PrivateIpAddress,PublicIpAddress]' `
  --output table
Write-Host "접속: ssh -i $KeyFile rocky@{PublicIpAddress}"
