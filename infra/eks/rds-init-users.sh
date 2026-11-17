#!/usr/bin/env bash
# RDS에 앱 계정 두 개를 만든다(클러스터 안의 임시 Pod에서 실행). 저장소 루트에서 실행한다.
#   ticketing     : 스키마 소유자 (migrate Job)
#   ticketing_app : SELECT/INSERT/UPDATE만 (backend)
# 비밀번호는 기존 Secret(ticketing-secret)과 .env.eks 의 RDS_MASTER_PASSWORD 를 쓴다. 화면에 찍지 않는다.
set -euo pipefail
RDS=$(aws rds describe-db-instances --db-instance-identifier ticketing-rds --query 'DBInstances[0].Endpoint.Address' --output text)
set -a; . ./.env.eks; set +a
kubectl create secret generic rds-master -n ticketing --from-literal=password="$RDS_MASTER_PASSWORD"
kubectl run rds-init -n ticketing --rm -i --restart=Never --image=mysql:8.4 \
  --overrides='{"spec":{"containers":[{"name":"rds-init","image":"mysql:8.4","stdin":true,"command":["sh","-c","mysql -h '$RDS' -uadmin -p\"$MASTER\" --ssl-mode=REQUIRED"],"env":[{"name":"MASTER","valueFrom":{"secretKeyRef":{"name":"rds-master","key":"password"}}}]}]}}' <<SQL
CREATE USER IF NOT EXISTS 'ticketing'@'%' IDENTIFIED BY '${DB_OWNER_PASSWORD}';
GRANT ALL PRIVILEGES ON ticketing.* TO 'ticketing'@'%';
CREATE USER IF NOT EXISTS 'ticketing_app'@'%' IDENTIFIED BY '${DB_APP_PASSWORD}';
GRANT SELECT, INSERT, UPDATE ON ticketing.* TO 'ticketing_app'@'%';
SELECT user, host FROM mysql.user WHERE user LIKE 'ticketing%';
SHOW GRANTS FOR 'ticketing_app'@'%';
SQL
kubectl delete secret rds-master -n ticketing
