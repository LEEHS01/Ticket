#!/usr/bin/env bash
# EKS 쪽 자원 삭제. 저장소 루트에서 실행한다.
# 순서: 워크로드(ALB, EBS 볼륨) → 도메인 레코드와 인증서 → RDS → Secrets Manager와 IAM 역할 → 클러스터 → VPC 스택 → ECR → IAM 역할
# 없는 자원은 건너뛴다. 계정 ID는 화면에 출력하지 않는다
set -uo pipefail
CLUSTER=ticketing-eks
STACK=ticketing-eks-vpc
DB=ticketing-rds
DOMAIN=nyannyanpunch.cloud
SECRET=ticketing/eks/backend
SM_ROLE=ticketing-backend-secrets
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# 1. Ingress와 PVC를 먼저 지워 ALB와 EBS 볼륨이 남지 않게 한다
kubectl delete namespace ticketing --ignore-not-found --timeout=1200s || true

# 2. 도메인: 별칭 레코드와 검증용 레코드를 지우고 호스팅 영역과 인증서를 지운다
ZONE=$(aws route53 list-hosted-zones-by-name --dns-name $DOMAIN --query "HostedZones[?Name=='$DOMAIN.'].Id | [0]" --output text)
if [ -n "$ZONE" ] && [ "$ZONE" != None ]; then
  aws route53 list-resource-record-sets --hosted-zone-id "$ZONE" \
    --query "ResourceRecordSets[?Type!='NS' && Type!='SOA']" --output json > /tmp/records.json
  if [ "$(jq length /tmp/records.json)" -gt 0 ]; then
    jq '{Changes: [.[] | {Action: "DELETE", ResourceRecordSet: .}]}' /tmp/records.json > /tmp/batch.json
    aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch file:///tmp/batch.json > /dev/null
  fi
  aws route53 delete-hosted-zone --id "$ZONE" > /dev/null && echo "hosted zone deleted: $DOMAIN"
fi
for arn in $(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='$DOMAIN'].CertificateArn" --output text); do
  aws acm delete-certificate --certificate-arn "$arn" && echo "certificate deleted: $DOMAIN"
done

# 3. RDS, DB 서브넷 그룹, 보안 그룹
if aws rds describe-db-instances --db-instance-identifier $DB > /dev/null 2>&1; then
  aws rds delete-db-instance --db-instance-identifier $DB --skip-final-snapshot --delete-automated-backups > /dev/null
  until aws rds wait db-instance-deleted --db-instance-identifier $DB; do sleep 10; done
  echo "rds deleted: $DB"
fi
aws rds delete-db-subnet-group --db-subnet-group-name $DB 2> /dev/null && echo "db subnet group deleted"
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$DB-sg --query 'SecurityGroups[0].GroupId' --output text 2> /dev/null)
[ -n "$SG" ] && [ "$SG" != None ] && aws ec2 delete-security-group --group-id "$SG" > /dev/null && echo "security group deleted: $DB-sg"

# 4. Secrets Manager의 비밀, Pod Identity 연결, IAM 역할
aws secretsmanager delete-secret --secret-id $SECRET --force-delete-without-recovery > /dev/null 2>&1 && echo "secret deleted: $SECRET"
for id in $(aws eks list-pod-identity-associations --cluster-name $CLUSTER --query 'associations[].associationId' --output text 2> /dev/null); do
  aws eks delete-pod-identity-association --cluster-name $CLUSTER --association-id "$id" > /dev/null
done
aws iam delete-role-policy --role-name $SM_ROLE --policy-name read-backend-secret 2> /dev/null
aws iam delete-role --role-name $SM_ROLE 2> /dev/null && echo "iam role deleted: $SM_ROLE"

# 5. 클러스터 (Auto Mode 노드와 애드온도 함께 삭제된다)
if aws eks describe-cluster --name $CLUSTER > /dev/null 2>&1; then
  aws eks delete-cluster --name $CLUSTER > /dev/null
  until aws eks wait cluster-deleted --name $CLUSTER; do sleep 10; done
  echo "cluster deleted: $CLUSTER"
fi

# 6. VPC 스택 (NAT 게이트웨이, 탄력적 IP 포함)
if aws cloudformation describe-stacks --stack-name $STACK > /dev/null 2>&1; then
  aws cloudformation delete-stack --stack-name $STACK
  until aws cloudformation wait stack-delete-complete --stack-name $STACK; do sleep 10; done
  echo "vpc stack deleted: $STACK"
fi

# 7. ECR 저장소
for r in ticketing-backend ticketing-frontend; do
  aws ecr delete-repository --repository-name $r --force > /dev/null 2>&1 && echo "ecr deleted: $r"
done

# 8. 클러스터용 IAM 역할
for role in AmazonEKSAutoClusterRole AmazonEKSAutoNodeRole; do
  for p in $(aws iam list-attached-role-policies --role-name $role --query 'AttachedPolicies[].PolicyArn' --output text 2> /dev/null); do
    aws iam detach-role-policy --role-name $role --policy-arn "$p"
  done
  aws iam delete-role --role-name $role 2> /dev/null && echo "iam role deleted: $role"
done
