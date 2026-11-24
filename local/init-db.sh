#!/usr/bin/env bash
# WSL(Ubuntu)의 MySQL 에 ticketing DB 와 계정 두 개를 만든다. 처음 한 번만 실행한다.
#   bash local/init-db.sh
# 비밀번호는 저장소 루트의 .env (DB_OWNER_PASSWORD, DB_APP_PASSWORD) 에서 읽는다.
#
# 계정 분리(최소 권한):
#   ticketing      : 스키마 소유자. 마이그레이션(테이블 생성·변경)에만 사용
#   ticketing_app  : API 서버용. 조회·추가·수정·행 삭제만 가능(테이블 삭제·변경 불가)
#                    행 삭제(DELETE)는 로그인 세션 테이블의 로그아웃·만료 정리에 쓴다(next)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env" ] || { echo "[중단] $ROOT/.env 가 없습니다:  cp .env.example .env 후 값을 채우세요" >&2; exit 1; }
set -a; . "$ROOT/.env"; set +a
: "${DB_OWNER_PASSWORD:?.env 에 DB_OWNER_PASSWORD 를 채우세요}"
: "${DB_APP_PASSWORD:?.env 에 DB_APP_PASSWORD 를 채우세요}"

sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS ticketing CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'ticketing'@'localhost' IDENTIFIED BY '${DB_OWNER_PASSWORD}';
ALTER USER 'ticketing'@'localhost' IDENTIFIED BY '${DB_OWNER_PASSWORD}';
GRANT ALL PRIVILEGES ON ticketing.* TO 'ticketing'@'localhost';

CREATE USER IF NOT EXISTS 'ticketing_app'@'localhost' IDENTIFIED BY '${DB_APP_PASSWORD}';
ALTER USER 'ticketing_app'@'localhost' IDENTIFIED BY '${DB_APP_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON ticketing.* TO 'ticketing_app'@'localhost';

FLUSH PRIVILEGES;
SQL
echo "ticketing DB 와 계정(ticketing, ticketing_app)을 준비했습니다."
