#!/usr/bin/env bash
# backend의 비밀번호를 Secrets Manager에 두고 EKS Pod Identity로 읽게 한다.
# 저장소 루트에서 실행한다. .env 의 값을 Secrets Manager에 넣고, 값은 화면에 출력하지 않는다
set -euo pipefail
CLUSTER=ticketing-eks
SECRET=ticketing/eks/backend
ROLE=ticketing-backend-secrets
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# 1. Secrets Store CSI 드라이버 + AWS 프로바이더 (EKS 애드온). 쿠버네티스 Secret으로도 만들어 주는 기능을 켠다
aws eks create-addon --cluster-name $CLUSTER --addon-name aws-secrets-store-csi-driver-provider \
  --configuration-values '{"secrets-store-csi-driver":{"syncSecret":{"enabled":true}}}' > /dev/null
aws eks wait addon-active --cluster-name $CLUSTER --addon-name aws-secrets-store-csi-driver-provider
echo "addon active: aws-secrets-store-csi-driver-provider"

# 2. 비밀번호를 Secrets Manager에 저장
set -a; . ./.env; set +a
aws secretsmanager create-secret --name $SECRET \
  --secret-string "{\"DB_APP_PASSWORD\":\"$DB_APP_PASSWORD\",\"REDIS_PASSWORD\":\"$REDIS_PASSWORD\"}" \
  --query Name --output text

# 3. 이 비밀 하나만 읽을 수 있는 IAM 역할. EKS Pod Identity만 이 역할을 쓸 수 있다
aws iam create-role --role-name $ROLE --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"pods.eks.amazonaws.com"},"Action":["sts:AssumeRole","sts:TagSession"]}]}' > /dev/null
aws iam put-role-policy --role-name $ROLE --policy-name read-backend-secret --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"secretsmanager:GetSecretValue\",\"secretsmanager:DescribeSecret\"],\"Resource\":\"arn:aws:secretsmanager:ap-northeast-2:$ACCOUNT:secret:$SECRET-*\"}]}"
echo "IAM role created: $ROLE"

# 4. ServiceAccount ticketing/backend 와 IAM 역할을 연결
aws eks create-pod-identity-association --cluster-name $CLUSTER --namespace ticketing \
  --service-account backend --role-arn arn:aws:iam::$ACCOUNT:role/$ROLE \
  --query 'association.{namespace:namespace,serviceAccount:serviceAccount}' --output table
