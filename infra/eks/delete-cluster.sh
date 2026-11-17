#!/usr/bin/env bash
# ④ 자원 삭제. 순서: 워크로드(ALB · EBS 볼륨) → 클러스터 → VPC 스택 → ECR 저장소
set -euo pipefail
CLUSTER=ticketing-eks
STACK=ticketing-eks-vpc

# 1. Ingress와 PVC를 먼저 지워 ALB와 EBS 볼륨이 남지 않게 한다
kubectl delete namespace ticketing --ignore-not-found --timeout=300s || true
sleep 30

# 2. 클러스터 (Auto Mode 노드도 함께 삭제된다)
aws eks delete-cluster --name $CLUSTER > /dev/null && aws eks wait cluster-deleted --name $CLUSTER
echo "cluster deleted"

# 3. VPC 스택 (NAT 게이트웨이 · 탄력적 IP 포함)
aws cloudformation delete-stack --stack-name $STACK && aws cloudformation wait stack-delete-complete --stack-name $STACK
echo "vpc stack deleted"

# 4. ECR 저장소
for r in ticketing-backend ticketing-frontend; do
  aws ecr delete-repository --repository-name $r --force > /dev/null 2>&1 && echo "ecr deleted: $r" || true
done
