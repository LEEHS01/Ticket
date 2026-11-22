#!/usr/bin/env bash
# 롤링 업데이트 중 요청이 얼마나 실패하는지 잰다. 클러스터에 kubectl로 접속되는 곳에서 실행한다.
#   bash docs/optional/rollout/measure.sh <backend|frontend> [초]
#   URL=http://<주소>/api/version bash docs/optional/rollout/measure.sh backend 90
# 1초에 20번꼴로 요청을 보내는 동안 Deployment를 rollout restart 한다(이미지는 그대로, Pod만 교체).
# 요청마다 응답 코드를 기록하고, 끝나면 전체 요청 수와 200이 아닌 응답 수를 출력한다. 000은 연결 실패나 시간 초과다.
set -euo pipefail
TARGET="$1"; SEC="${2:-60}"; URL="${URL:-http://localhost:30080/api/version}"
N=$((SEC * 20))
OUT=$(mktemp)

(
  for _ in $(seq 1 "$N"); do
    curl -s -o /dev/null -m 5 -w '%{http_code}\n' "$URL" >> "$OUT" &
    sleep 0.05
  done
  wait
) &
LOAD=$!

sleep 5
kubectl rollout restart "deployment/$TARGET" -n ticketing
kubectl rollout status "deployment/$TARGET" -n ticketing --timeout=180s | tail -n 1
wait "$LOAD"

echo "[$TARGET 교체 중 요청 결과]"
echo "전체 요청: $(wc -l < "$OUT")"
echo "실패(200이 아닌 응답): $(grep -vc '^200$' "$OUT" || true)"
echo "응답 코드별:"
sort "$OUT" | uniq -c | sed 's/^/  /'
rm -f "$OUT"
