#!/usr/bin/env bash
# ④ EKS Auto Mode 클러스터 생성. VPC 스택(ticketing-eks-vpc)을 먼저 만든 뒤 실행한다.
#   aws cloudformation create-stack --stack-name ticketing-eks-vpc \
#     --template-url https://s3.us-west-2.amazonaws.com/amazon-eks/cloudformation/2020-10-29/amazon-eks-vpc-private-subnets.yaml
# 계정 ID는 화면에 찍지 않는다.
set -euo pipefail

CLUSTER=ticketing-eks
STACK=ticketing-eks-vpc
K8S_VERSION=1.36
CLUSTER_ROLE=AmazonEKSAutoClusterRole
NODE_ROLE=AmazonEKSAutoNodeRole
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# 1. IAM 역할: 클러스터 역할(EKS가 노드 · EBS · 로드밸런서를 만들 권한), 노드 역할(ECR pull 등)
if ! aws iam get-role --role-name $CLUSTER_ROLE > /dev/null 2>&1; then
  aws iam create-role --role-name $CLUSTER_ROLE --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"eks.amazonaws.com"},"Action":["sts:AssumeRole","sts:TagSession"]}]}' > /dev/null
  for p in AmazonEKSClusterPolicy AmazonEKSComputePolicy AmazonEKSBlockStoragePolicyV2 AmazonEKSLoadBalancingPolicy AmazonEKSNetworkingPolicy; do
    aws iam attach-role-policy --role-name $CLUSTER_ROLE --policy-arn arn:aws:iam::aws:policy/$p
  done
  echo "IAM role created: $CLUSTER_ROLE"
fi
if ! aws iam get-role --role-name $NODE_ROLE > /dev/null 2>&1; then
  aws iam create-role --role-name $NODE_ROLE --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' > /dev/null
  for p in AmazonEKSWorkerNodeMinimalPolicy AmazonEC2ContainerRegistryPullOnly; do
    aws iam attach-role-policy --role-name $NODE_ROLE --policy-arn arn:aws:iam::aws:policy/$p
  done
  echo "IAM role created: $NODE_ROLE"
  sleep 10   # 새 역할이 퍼질 때까지 잠시 기다린다
fi

# 2. 노드를 둘 사설 서브넷 2개
SUBNETS=$(aws ec2 describe-subnets \
  --filters "Name=tag:aws:cloudformation:stack-name,Values=$STACK" "Name=tag:Name,Values=*PrivateSubnet*" \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
echo "private subnets: $SUBNETS"

# 3. 클러스터 생성 (Auto Mode: 노드 · 로드밸런서 · EBS 볼륨을 EKS가 관리). 이미 있으면 건너뛴다
if aws eks describe-cluster --name $CLUSTER > /dev/null 2>&1; then
  echo "cluster already exists: $CLUSTER"
else
  aws eks create-cluster --name $CLUSTER --kubernetes-version $K8S_VERSION     --role-arn arn:aws:iam::$ACCOUNT:role/$CLUSTER_ROLE     --resources-vpc-config subnetIds=$SUBNETS,endpointPublicAccess=true,endpointPrivateAccess=true     --access-config authenticationMode=API,bootstrapClusterCreatorAdminPermissions=true     --compute-config "{\"enabled\":true,\"nodePools\":[\"general-purpose\",\"system\"],\"nodeRoleArn\":\"arn:aws:iam::$ACCOUNT:role/$NODE_ROLE\"}"     --kubernetes-network-config '{"elasticLoadBalancing":{"enabled":true}}'     --storage-config '{"blockStorage":{"enabled":true}}' > /dev/null
  echo "cluster create requested: $CLUSTER (10~15분 걸린다)"
fi
# 기다리는 중 연결이 끊기면 wait가 실패하므로 될 때까지 다시 기다린다
until aws eks wait cluster-active --name $CLUSTER; do sleep 10; done
aws eks describe-cluster --name $CLUSTER --query 'cluster.{name:name,status:status,version:version,autoMode:computeConfig.enabled}' --output table

# 4. kubectl 접속 설정
aws eks update-kubeconfig --name $CLUSTER > /dev/null && echo "kubeconfig updated"
