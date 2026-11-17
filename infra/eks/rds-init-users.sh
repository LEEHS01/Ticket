#!/usr/bin/env bash
# RDS에 앱 계정 두 개를 만든다(클러스터 안의 임시 Pod에서 실행). 저장소 루트에서 실행한다.
#   ticketing     : 스키마 소유자 (migrate Job)
#   ticketing_app : SELECT/INSERT/UPDATE만 (backend)
# 비밀번호는 .env.eks 의 값을 임시 Secret으로 넘기고, 끝나면 Pod와 Secret을 지운다. 화면에 찍지 않는다.
set -euo pipefail
RDS=$(aws rds describe-db-instances --db-instance-identifier ticketing-rds --query 'DBInstances[0].Endpoint.Address' --output text)
set -a; . ./.env.eks; set +a
cleanup() { kubectl delete pod rds-init -n ticketing --ignore-not-found --now > /dev/null; kubectl delete secret rds-init -n ticketing --ignore-not-found > /dev/null; }
trap cleanup EXIT

SQL="CREATE USER IF NOT EXISTS 'ticketing'@'%' IDENTIFIED BY '${DB_OWNER_PASSWORD}';
GRANT ALL PRIVILEGES ON ticketing.* TO 'ticketing'@'%';
CREATE USER IF NOT EXISTS 'ticketing_app'@'%' IDENTIFIED BY '${DB_APP_PASSWORD}';
GRANT SELECT, INSERT, UPDATE ON ticketing.* TO 'ticketing_app'@'%';
SELECT user, host FROM mysql.user WHERE user LIKE 'ticketing%';
SHOW GRANTS FOR 'ticketing_app'@'%';"
kubectl create secret generic rds-init -n ticketing --from-literal=master="$RDS_MASTER_PASSWORD" --from-literal=sql="$SQL" > /dev/null
kubectl run rds-init -n ticketing --restart=Never --image=mysql:8.4 --overrides='{"spec":{"containers":[{"name":"rds-init","image":"mysql:8.4","command":["sh","-c","mysql -h '$RDS' -uadmin -p\"$MASTER\" --ssl-mode=REQUIRED -t -e \"$SQL\" 2>/dev/null"],"env":[{"name":"MASTER","valueFrom":{"secretKeyRef":{"name":"rds-init","key":"master"}}},{"name":"SQL","valueFrom":{"secretKeyRef":{"name":"rds-init","key":"sql"}}}]}]}}' > /dev/null
kubectl wait -n ticketing --for=jsonpath='{.status.phase}'=Succeeded pod/rds-init --timeout=180s > /dev/null
kubectl logs -n ticketing rds-init
