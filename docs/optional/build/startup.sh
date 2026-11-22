#!/usr/bin/env bash
# backend 이미지의 기동 시간을 잰다. 컨테이너를 띄워 "Started TicketingApplication in N seconds" 로그를 읽는다.
#   bash docs/optional/build/startup.sh <이미지> [횟수]
# DB와 Redis 주소는 임의의 값을 준다. 기동할 때는 접속하지 않으므로 기동 시간만 잴 수 있다.
set -euo pipefail
IMG="$1"; N="${2:-3}"
for i in $(seq 1 "$N"); do
  id=$(docker run -d -e DB_HOST=127.0.0.1 -e DB_USER=u -e DB_PASSWORD=p -e REDIS_HOST=127.0.0.1 "$IMG")
  for _ in $(seq 1 120); do
    docker logs "$id" 2>&1 | grep -q 'Started TicketingApplication' && break
    sleep 0.5
  done
  printf '%s  %d회: %s\n' "$IMG" "$i" "$(docker logs "$id" 2>&1 | grep -o 'Started TicketingApplication in [0-9.]* seconds' || echo '기동 실패')"
  docker rm -f "$id" > /dev/null
done
