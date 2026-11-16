#!/bin/bash
# MySQL 볼륨이 처음 만들어질 때 1회 실행된다(/docker-entrypoint-initdb.d).
# 비밀번호는 컨테이너 환경 변수(MYSQL_ROOT_PASSWORD, DB_APP_PASSWORD)로 받는다. 파일에 적지 않는다.
#
# 계정 분리(최소 권한):
#   ticketing      : 스키마 소유자. MYSQL_USER 로 이미 만들어진다. migrate 모드(Flyway DDL)에서만 사용
#   ticketing_app  : API 서버용. SELECT/INSERT/UPDATE만 (DROP·ALTER·DELETE 불가)
set -euo pipefail
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD 가 필요합니다}"

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS 'ticketing_app'@'%' IDENTIFIED BY '${DB_APP_PASSWORD}';
GRANT SELECT, INSERT, UPDATE ON ticketing.* TO 'ticketing_app'@'%';

-- 통합 테스트 전용 DB(개발 데이터와 섞이지 않게). 테스트는 Flyway를 직접 돌리므로 소유자 계정에 권한을 준다.
CREATE DATABASE IF NOT EXISTS ticketing_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON ticketing_test.* TO 'ticketing'@'%';

FLUSH PRIVILEGES;
SQL
