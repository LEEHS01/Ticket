#!/usr/bin/env bash
# Amazon RDS(MySQL) 생성. 저장소 루트에서 실행한다.
# RDS는 프라이빗 서브넷에 두고, 클러스터 보안 그룹에서 오는 3306만 허용한다. 마스터 비밀번호는 .env.rds 에만 적고 화면에 출력하지 않는다
set -euo pipefail
CLUSTER=ticketing-eks
STACK=ticketing-eks-vpc
DB=ticketing-rds

VPC=$(aws cloudformation describe-stacks --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" --output text)
SUBNETS=$(aws ec2 describe-subnets --filters "Name=tag:aws:cloudformation:stack-name,Values=$STACK" "Name=tag:Name,Values=*PrivateSubnet*" --query 'Subnets[].SubnetId' --output text)
CLUSTER_SG=$(aws eks describe-cluster --name $CLUSTER --query cluster.resourcesVpcConfig.clusterSecurityGroupId --output text)

# 1. DB 서브넷 그룹(프라이빗 서브넷 2개)과 보안 그룹(클러스터 보안 그룹에서 오는 3306)
aws rds create-db-subnet-group --db-subnet-group-name $DB --db-subnet-group-description "ticketing private subnets" \
  --subnet-ids $SUBNETS --query DBSubnetGroup.DBSubnetGroupName --output text
SG=$(aws ec2 create-security-group --group-name $DB-sg --description "ticketing RDS" --vpc-id $VPC --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 3306 --source-group $CLUSTER_SG > /dev/null
echo "security group created: $DB-sg (3306, 클러스터 보안 그룹에서만)"

# 2. 마스터 비밀번호를 만들어 .env.rds 에 적는다 (.gitignore 로 제외된다). 클러스터의 Secret에 들어가지 않게 .env 와 파일을 나눈다
[ -f .env.rds ] || (umask 077; echo "RDS_MASTER_PASSWORD=$(openssl rand -hex 16)" > .env.rds)
set -a; . ./.env.rds; set +a

# 3. RDS 인스턴스 (MySQL 8.4, 외부 접속 불가, 저장 암호화)
aws rds create-db-instance --db-instance-identifier $DB --engine mysql --engine-version 8.4 \
  --db-instance-class db.t4g.micro --allocated-storage 20 --storage-type gp3 --storage-encrypted \
  --db-name ticketing --master-username admin --master-user-password "$RDS_MASTER_PASSWORD" \
  --db-subnet-group-name $DB --vpc-security-group-ids $SG --no-publicly-accessible \
  --backup-retention-period 0 --no-deletion-protection > /dev/null
echo "rds create requested: $DB (10분쯤 걸린다)"
until aws rds wait db-instance-available --db-instance-identifier $DB; do sleep 10; done
aws rds describe-db-instances --db-instance-identifier $DB \
  --query 'DBInstances[0].{status:DBInstanceStatus,engine:EngineVersion,class:DBInstanceClass,public:PubliclyAccessible,encrypted:StorageEncrypted,az:AvailabilityZone}' --output table
