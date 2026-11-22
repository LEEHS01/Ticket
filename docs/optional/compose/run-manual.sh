#!/usr/bin/env bash
# Compose 없이 docker run 으로 전체 스택을 띄운다 (문서 2의 절차). Compose와 비교하려고 둔 스크립트다.
#   bash docs/optional/compose/run-manual.sh [이미지 버전]      저장소 루트에서 실행
#   정리: docker rm -f frontend backend redis mysql; docker network rm ticketing-net; docker volume rm ticketing-mysql
set -euo pipefail
V="${1:-3.0}"
set -a; . ./.env; set +a

docker network create ticketing-net > /dev/null
docker run -d --name mysql --network ticketing-net \
  -e MYSQL_ROOT_PASSWORD -e MYSQL_DATABASE=ticketing -e MYSQL_USER=ticketing \
  -e MYSQL_PASSWORD="$DB_OWNER_PASSWORD" -e DB_APP_PASSWORD \
  --mount type=volume,source=ticketing-mysql,target=/var/lib/mysql \
  --mount type=bind,source="$PWD/backend/docker/mysql-init",target=/docker-entrypoint-initdb.d,readonly \
  mysql:8.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00 > /dev/null
docker run -d --name redis --network ticketing-net -e REDIS_PASSWORD \
  redis:7-alpine sh -c 'exec redis-server --requirepass "$REDIS_PASSWORD" --appendonly no' > /dev/null
# MySQL이 접속을 받을 때까지 직접 기다려야 한다
until docker exec mysql sh -c 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' 2> /dev/null; do sleep 2; done
docker run --rm --name migrate --network ticketing-net \
  -e DB_HOST=mysql -e DB_USER=ticketing -e DB_PASSWORD="$DB_OWNER_PASSWORD" -e REDIS_HOST=redis \
  "harpda/ticketing-backend:$V" migrate > /dev/null 2>&1
# backend를 frontend보다 먼저 띄워야 한다
docker run -d --name backend --network ticketing-net \
  -e DB_HOST=mysql -e DB_USER=ticketing_app -e DB_PASSWORD="$DB_APP_PASSWORD" \
  -e REDIS_HOST=redis -e REDIS_PASSWORD -e SESSION_COOKIE_SECURE=false \
  "harpda/ticketing-backend:$V" > /dev/null
docker run -d --name frontend --network ticketing-net -p 127.0.0.1:8088:8080 "harpda/ticketing-frontend:$V" > /dev/null
until curl -sf http://127.0.0.1:8088/api/shows > /dev/null; do sleep 1; done
