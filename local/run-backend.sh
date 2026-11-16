#!/usr/bin/env bash
# WSL(Ubuntu)에서 백엔드를 실행한다: 준비물 확인 → (필요하면) 빌드 → DB 마이그레이션·시드 → 서버 실행.
# 보통은 Windows의 run-local.ps1이 이 스크립트를 부른다. 직접 실행해도 된다:  bash local/run-backend.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
JAR="$BACKEND/target/app.jar"

# 시스템 기본 java가 무엇이든 이 스크립트 안에서는 JDK 21을 쓴다.
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"

fail() { echo "[중단] $*" >&2; exit 1; }
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

[ -x "$JAVA_HOME/bin/java" ] || fail "JDK 21이 없습니다:  sudo apt install -y openjdk-21-jdk-headless"
port_open 6379 || fail "Redis(6379)가 꺼져 있습니다:  sudo service redis-server start"
port_open 3306 || fail "MySQL(3306)이 꺼져 있습니다:  sudo service mysql start"
port_open 18080 && fail "18080 포트가 이미 쓰이고 있습니다. 먼저 종료하세요:  pkill -f target/app.jar"

# DB 비밀번호는 저장소 루트의 .env 에서 읽는다(저장소에는 올리지 않는다).
[ -f "$ROOT/.env" ] || fail ".env 가 없습니다:  cp .env.example .env 후 값을 채우고  bash local/init-db.sh"
set -a; . "$ROOT/.env"; set +a
[ -n "${DB_OWNER_PASSWORD:-}" ] && [ -n "${DB_APP_PASSWORD:-}" ] || fail ".env 에 DB_OWNER_PASSWORD, DB_APP_PASSWORD 를 채우세요"

# 공통 환경변수. WSL의 Redis는 비밀번호 없이 127.0.0.1에서만 열려 있으므로 REDIS_PASSWORD는 넘기지 않는다.
unset REDIS_PASSWORD MYSQL_ROOT_PASSWORD
export DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=ticketing
export REDIS_HOST=127.0.0.1 REDIS_PORT=6379
export SESSION_COOKIE_SECURE=false      # 로컬은 http
export SERVER_PORT=18080                # 8080은 다른 서버가 사용 중

# 소스가 jar보다 새로우면 다시 빌드
if [ ! -f "$JAR" ] || [ -n "$(find "$BACKEND/src" "$BACKEND/pom.xml" -newer "$JAR" -print -quit)" ]; then
  echo "백엔드를 빌드합니다..."
  (cd "$BACKEND" && bash ./mvnw -B -q -DskipTests package) || fail "백엔드 빌드에 실패했습니다."
fi

echo "DB 마이그레이션과 시드를 실행합니다..."
DB_USER=ticketing DB_PASSWORD="$DB_OWNER_PASSWORD" java -jar "$JAR" migrate \
  || fail "마이그레이션에 실패했습니다. 처음이라면 DB와 계정을 만들었는지 확인:  bash local/init-db.sh"

echo "백엔드를 시작합니다: http://localhost:18080"
export DB_USER=ticketing_app DB_PASSWORD="$DB_APP_PASSWORD"
unset DB_OWNER_PASSWORD DB_APP_PASSWORD
# IPv4로만 열어야 Windows에서 127.0.0.1:18080으로 접속된다(IPv6로 열리면 WSL이 [::1]로만 중계한다).
exec java -Djava.net.preferIPv4Stack=true -XX:MaxRAMPercentage=50.0 -jar "$JAR"
