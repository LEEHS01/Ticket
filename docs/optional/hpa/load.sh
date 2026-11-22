#!/usr/bin/env bash
# backend에 부하를 주고 그동안 Pod 수가 어떻게 바뀌는지 본다. kubectl로 클러스터에 접속되는 곳에서 실행한다.
#   bash docs/optional/hpa/load.sh [초] [동시 요청 수] [경로]
# 클러스터 안에 ab(Apache Bench) Pod를 띄워 backend Service를 호출한다. 경로의 기본값은 /api/shows (DB 조회)다.
# 30초마다 backend Pod 수와 CPU 사용량을 출력하고, 끝나면 ab의 결과를 출력한다
set -euo pipefail
SEC="${1:-300}"; C="${2:-40}"; URLPATH="${3:-/api/shows}"
kubectl delete pod load -n ticketing --ignore-not-found > /dev/null
kubectl run load -n ticketing --image=httpd:2.4-alpine --restart=Never --quiet -- \
  ab -l -q -t "$SEC" -n 100000000 -c "$C" "http://backend:8080$URLPATH" > /dev/null
kubectl wait --for=condition=Ready pod/load -n ticketing --timeout=120s > /dev/null
echo "시각      Ready인 backend Pod   backend CPU 합계"
for _ in $(seq 1 $((SEC / 30))); do
  sleep 30
  ready=$(kubectl get deployment backend -n ticketing -o jsonpath='{.status.readyReplicas}')
  cpu=$(kubectl top pods -n ticketing -l app=backend --no-headers 2> /dev/null | awk '{s+=$2} END {print s "m"}')
  printf '%s  %-20s  %s\n' "$(date +%T)" "$ready" "$cpu"
done
kubectl wait --for=jsonpath='{.status.phase}'=Succeeded pod/load -n ticketing --timeout=120s > /dev/null
kubectl logs load -n ticketing | grep -E 'Complete requests|Failed requests|Non-2xx|Requests per second|Time per request.*\(mean\)$|  95%|  99%'
kubectl delete pod load -n ticketing > /dev/null
