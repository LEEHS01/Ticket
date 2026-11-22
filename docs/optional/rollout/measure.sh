#!/usr/bin/env bash
# 롤링 업데이트 중 요청이 얼마나 실패하는지 잰다. 클러스터에 kubectl로 접속되는 곳에서 실행한다.
#   bash docs/optional/rollout/measure.sh <backend|frontend> [초]
#   URL=http://<주소>/api/version bash docs/optional/rollout/measure.sh backend 90
# ab가 동시 10개로 요청을 계속 보내는 동안 Deployment를 rollout restart 한다(이미지는 그대로, Pod만 교체).
# 끝나면 전체 요청 수, 실패 수, 2xx가 아닌 응답 수를 출력한다.
set -euo pipefail
TARGET="$1"; SEC="${2:-60}"; URL="${URL:-http://localhost:30080/api/version}"

ab -r -q -t "$SEC" -n 10000000 -c 10 "$URL" > /tmp/ab.log 2>&1 &
sleep 5
kubectl rollout restart "deployment/$TARGET" -n ticketing
kubectl rollout status "deployment/$TARGET" -n ticketing --timeout=180s | tail -n 1
wait
echo "[$TARGET 교체 중 요청 결과]"
grep -E 'Complete requests|Failed requests|Non-2xx responses|Requests per second' /tmp/ab.log || true
grep -q 'Non-2xx responses' /tmp/ab.log || echo "Non-2xx responses:      0"
