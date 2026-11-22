#!/usr/bin/env bash
# 노드를 비울 때(drain) 요청이 얼마나 실패하는지 잰다. kubeadm 클러스터의 control plane에서 실행한다.
#   bash docs/optional/pdb/measure.sh [초]
# 1) worker2를 cordon하고 backend를 다시 만들어 backend Pod 2개를 worker1에 모은다
# 2) worker2를 uncordon하고, 1초에 20번꼴로 요청을 보내는 동안 worker1의 backend Pod를 내보낸다(drain)
# 3) worker1을 uncordon하고 요청 결과를 출력한다. 000은 연결 실패나 시간 초과다
set -euo pipefail
SEC="${1:-60}"; URL="${URL:-http://localhost:30080/api/version}"
N=$((SEC * 20))
OUT=$(mktemp)

kubectl cordon worker2 > /dev/null
kubectl rollout restart deployment/backend -n ticketing > /dev/null
kubectl rollout status deployment/backend -n ticketing --timeout=180s > /dev/null
kubectl wait --for=delete pod -n ticketing -l app=backend --field-selector spec.nodeName=worker2 --timeout=120s > /dev/null 2>&1 || true
kubectl uncordon worker2 > /dev/null
echo "[drain 전 backend Pod 위치]"
kubectl get pods -n ticketing -l app=backend -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName --no-headers

(
  for _ in $(seq 1 "$N"); do
    curl -s -o /dev/null -m 5 -w '%{http_code}\n' "$URL" >> "$OUT" &
    sleep 0.05
  done
  wait
) &
LOAD=$!

sleep 5
echo "[kubectl drain worker1 --pod-selector=app=backend]"
kubectl drain worker1 --pod-selector=app=backend --ignore-daemonsets --timeout=150s 2>&1 | grep -E 'evicting|evicted|Cannot evict|drained' | cut -c1-110
wait "$LOAD"
kubectl uncordon worker1 > /dev/null

echo "[drain 중 요청 결과]"
echo "전체 요청: $(wc -l < "$OUT")"
echo "실패(200이 아닌 응답): $(grep -vc '^200$' "$OUT" || true)"
echo "응답 코드별:"
sort "$OUT" | uniq -c | sed 's/^/  /'
rm -f "$OUT"
