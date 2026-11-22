#!/usr/bin/env bash
# WSL(Ubuntu)에서 백엔드를 실행한다. DB 비밀번호는 저장소 루트의 .env 에서 읽는다.
#   bash local/run-backend.sh migrate    스키마 생성과 시드. 스키마 소유자 계정(ticketing)으로 실행하고 끝난다
#   bash local/run-backend.sh            API 서버. 앱 계정(ticketing_app)으로 8080 포트에서 실행한다
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAR="$ROOT/backend/target/app.jar"

[ -f "$JAR" ] || { echo "[중단] $JAR 가 없습니다. 먼저 빌드합니다: (cd backend && ./mvnw -B -DskipTests package)" >&2; exit 1; }
[ -f "$ROOT/.env" ] || { echo "[중단] $ROOT/.env 가 없습니다: cp .env.example .env 후 값을 채웁니다" >&2; exit 1; }
set -a; . "$ROOT/.env"; set +a

# WSL에 설치한 MySQL과 Redis는 이 PC 안(127.0.0.1)에서만 열려 있다. Redis에는 비밀번호를 걸지 않았다
export DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=ticketing
export REDIS_HOST=127.0.0.1 REDIS_PORT=6379
export SESSION_COOKIE_SECURE=false      # http로 접속하므로 끈다
unset REDIS_PASSWORD MYSQL_ROOT_PASSWORD

if [ "${1:-}" = migrate ]; then
  export DB_USER=ticketing DB_PASSWORD="$DB_OWNER_PASSWORD"
  exec java -jar "$JAR" migrate
fi

export DB_USER=ticketing_app DB_PASSWORD="$DB_APP_PASSWORD"
unset DB_OWNER_PASSWORD DB_APP_PASSWORD
exec java -jar "$JAR"
