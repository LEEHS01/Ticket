#!/usr/bin/env bash
# API 수준 측정 + 채운 데이터의 형태 대조.
#   bash test/load/api_probe.sh <결과 폴더> <대기자 수> [반복 횟수]
#
# 1) 전용 Redis(포트 $PROBE_REDIS_PORT, 기본 16391)와 그 Redis를 보는 서버(포트 $PROBE_APP_PORT, 기본 18090)를 띄운다.
#    서버 설정: QUEUE_MAX_ACTIVE=100, QUEUE_WAIT_TTL_SECONDS=3600(측정 중 채운 대기자가 끊긴 것으로 처리되지 않게), 요청 제한 크게.
#    DB는 $PROBE_DB_NAME(기본 ticketing_next). DB 접속 정보는 ~/.tkn-next.env(TKN_APP_PASSWORD)와 아래 변수.
# 2) 실제 API로 가입한 사용자 4명: 3명은 채운 대기열의 맨 앞·가운데·맨 뒤에 넣고(fill_queue.py --probe),
#    1명은 실제 진입 API로 들어가 "코드가 만든 키"와 "채운 키"의 형태를 대조한다(compare_shape.py).
# 3) 세 위치에서 GET /api/queue/status를 반복해 응답 시간(curl time_total) 중앙값·95%를 잰다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${1:?결과 폴더}"; N="${2:?대기자 수}"; REPEAT="${3:-31}"
RPORT="${PROBE_REDIS_PORT:-16391}"; APORT="${PROBE_APP_PORT:-18090}"
JAR="${PROBE_JAR:-$ROOT/backend/target/app.jar}"
mkdir -p "$OUT"
. ~/.tkn-next.env

redis-server --port "$RPORT" --bind 127.0.0.1 --save "" --appendonly no --daemonize yes --dir "$OUT" --logfile "$OUT/probe-redis.log"
APP_PID=""
cleanup() {
  [ -n "$APP_PID" ] && kill -TERM "$APP_PID" 2> /dev/null && wait "$APP_PID" 2> /dev/null || true
  redis-cli -p "$RPORT" shutdown nosave > /dev/null 2>&1 || true
}
trap cleanup EXIT
DB_HOST=127.0.0.1 DB_NAME="${PROBE_DB_NAME:-ticketing_next}" DB_USER="${PROBE_DB_USER:-tkn_app}" DB_PASSWORD="$TKN_APP_PASSWORD" \
REDIS_HOST=127.0.0.1 REDIS_PORT="$RPORT" SESSION_COOKIE_SECURE=false \
QUEUE_MAX_ACTIVE=100 QUEUE_WAIT_TTL_SECONDS=3600 \
RATE_LIMIT_GENERAL_PER_MINUTE=1000000 RATE_LIMIT_STRICT_PER_MINUTE=1000000 RATE_LIMIT_POLL_PER_MINUTE=1000000 \
  java -jar "$JAR" --server.port="$APORT" > "$OUT/probe-app.log" 2>&1 &
APP_PID=$!
for i in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:$APORT/readyz" > /dev/null && break; sleep 1; done
B="http://127.0.0.1:$APORT/api"
PERF=$(curl -s "$B/shows" | jq '[.shows[] | select(.status=="ON_SALE")][0].id' | xargs -I{} curl -s "$B/shows/{}" \
  | jq '[.performances[] | select(.status=="ON_SALE")][0].id')

signup() { # $1 = 쿠키 파일 → 사용자 id 출력
  local c; c=$(curl -s -c "$1" -b "$1" "$B/auth/me" | jq -r .csrfToken)
  curl -s -c "$1" -b "$1" -H 'Content-Type: application/json' -H "X-CSRF-Token: $c" \
    --data "{\"email\":\"probe-$(cat /proc/sys/kernel/random/uuid)@example.com\",\"password\":\"password-123\",\"name\":\"측정\"}" \
    "$B/auth/signup" | jq -r '.user.id, .csrfToken' > "$1.info"
  head -1 "$1.info"
}
U1=$(signup "$OUT/j1"); U2=$(signup "$OUT/j2"); U3=$(signup "$OUT/j3"); U4=$(signup "$OUT/j4")

python3 -I "$HERE/qload/fill_queue.py" --port "$RPORT" --perf "$PERF" --waiting "$N" --active 100 --wait-ttl-ms 3600000 \
  --probe "0:$U1" --probe "$((N / 2)):$U2" --probe "$((N - 1)):$U3" --probe-out "$OUT/probes.json"

# 실제 진입 API로 1명(맨 뒤에 붙는다) → 형태 대조
C4=$(tail -1 "$OUT/j4.info")
REAL=$(curl -s -b "$OUT/j4" -H 'Content-Type: application/json' -H "X-CSRF-Token: $C4" --data "{\"performanceId\":$PERF}" "$B/queue/enter")
echo "실제 진입 응답: $(echo "$REAL" | jq -c '{status, position}')"
python3 -I "$HERE/qload/compare_shape.py" --port "$RPORT" --perf "$PERF" --real-token="$(echo "$REAL" | jq -r .queueToken)" \
  --real-uid "$U4" --probes "$OUT/probes.json" | tee "$OUT/shape.txt"

# 세 위치에서 대기 상태 조회 반복
echo "| 위치 | position | 응답 ms 중앙값 | 95% | 최대 |" | tee "$OUT/api.md"
echo "|---|---|---|---|---|" | tee -a "$OUT/api.md"
i=0
for row in $(jq -c '.[]' "$OUT/probes.json"); do
  i=$((i + 1)); tok=$(echo "$row" | jq -r .token); pos=$(echo "$row" | jq -r .position)
  curl -s -o /dev/null -b "$OUT/j$i" -H "X-Queue-Token: $tok" "$B/queue/status"   # 데우기
  times=$(for k in $(seq 1 "$REPEAT"); do curl -s -o /dev/null -w '%{time_total}\n' -b "$OUT/j$i" -H "X-Queue-Token: $tok" "$B/queue/status"; done | sort -n)
  got=$(curl -s -b "$OUT/j$i" -H "X-Queue-Token: $tok" "$B/queue/status" | jq -c '{status, position}')
  med=$(echo "$times" | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]*1000}')
  p95=$(echo "$times" | awk '{a[NR]=$1} END{i=int(NR*0.95); if(i<1)i=1; print a[i]*1000}')
  max=$(echo "$times" | tail -1 | awk '{print $1*1000}')
  echo "| $pos | $(echo "$got" | jq .position) ($(echo "$got" | jq -r .status)) | $med | $p95 | $max |" | tee -a "$OUT/api.md"
done
grep -c '"level":"\(WARN\|ERROR\)"' "$OUT/probe-app.log" | xargs echo "서버 로그 WARN/ERROR:"
rm -f "$OUT"/j?  "$OUT"/j?.info "$OUT/probes.json"   # 측정용 세션·토큰 정리
