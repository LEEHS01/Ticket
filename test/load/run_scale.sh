#!/usr/bin/env bash
# 데이터 규모 테스트: 전용 redis-server를 띄워 대기자 1만·5만·10만·30만 명을 채우고 Lua 한 번의 시간과 메모리를 잰다.
#
#   bash test/load/run_scale.sh [결과 폴더] [규모 목록]
#   예) bash test/load/run_scale.sh /mnt/d/tkn-load/scale-before "10000 50000 100000 300000"
#
# - 전용 Redis: 포트 $LOAD_REDIS_PORT(기본 16390), 저장 끔, maxmemory 없음. 개발·통합 테스트용 Redis(6379)는 건드리지 않는다.
#   이 인스턴스에서만 FLUSHALL 한다. 끝나면 끈다(데이터가 남지 않는다).
# - 결과: <폴더>/scale-<N>.json, <폴더>/conditions.txt, 표는 report.py
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${1:-/mnt/d/tkn-load/scale}"
SCALES="${2:-10000 50000 100000 300000}"
PORT="${LOAD_REDIS_PORT:-16390}"
PERF=900001
mkdir -p "$OUT"

if redis-cli -p "$PORT" ping > /dev/null 2>&1; then
  echo "[중단] 포트 $PORT에 이미 Redis가 있습니다. LOAD_REDIS_PORT로 다른 포트를 고르세요." >&2; exit 1
fi
redis-server --port "$PORT" --bind 127.0.0.1 --save "" --appendonly no --daemonize yes \
  --dir "$OUT" --logfile "$OUT/redis.log" --pidfile "$OUT/redis.pid"
trap 'redis-cli -p "$PORT" shutdown nosave > /dev/null 2>&1 || true' EXIT
for i in $(seq 1 50); do redis-cli -p "$PORT" ping > /dev/null 2>&1 && break; sleep 0.1; done

{
  echo "측정 시각: $(date '+%F %T %Z')"
  echo "Redis: $(redis-server --version)"
  echo "CPU: $(nproc)코어 ($(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs))"
  echo "메모리: $(free -m | awk '/Mem:/{print $2" MiB 중 사용 "$3" MiB"}')"
  echo "부하 평균(시작): $(cut -d' ' -f1-3 /proc/loadavg)"
  echo "CPU 많이 쓰는 프로세스(시작):"; ps -eo pcpu,comm --sort=-pcpu | head -6
} > "$OUT/conditions.txt"

for N in $SCALES; do
  echo "== 대기자 $N명"
  redis-cli -p "$PORT" flushall > /dev/null
  base=$(redis-cli -p "$PORT" info memory | awk -F: '/^used_memory:/{print $2}' | tr -d '\r')
  python3 -I "$HERE/qload/fill_queue.py" --port "$PORT" --perf $PERF --waiting "$N" --active 100 --wait-ttl-ms 3600000
  used=$(redis-cli -p "$PORT" info memory | awk -F: '/^used_memory:/{print $2}' | tr -d '\r')
  keys=$(redis-cli -p "$PORT" dbsize)
  echo "  메모리: $(( (used - base) / 1024 / 1024 )) MiB, 대기자 1명당 $(( (used - base) / (N + 100) )) 바이트, 키 $keys개"
  python3 -I "$HERE/qload/measure_queue.py" --port "$PORT" --perf $PERF --scripts "$ROOT/backend/src/main/resources/redis" \
    --repeat 21 --wait-ttl-ms 3600000 --stale "1000,10000,all" --out "$OUT/scale-$N.json"
  python3 -I - "$OUT/scale-$N.json" "$base" "$used" "$keys" <<'PY'
import json, sys
f, base, used, keys = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
d = json.load(open(f)); d["memory_base"] = base; d["memory_filled"] = used; d["keys"] = keys
json.dump(d, open(f, "w"), ensure_ascii=False, indent=1)
PY
done
echo "부하 평균(끝): $(cut -d' ' -f1-3 /proc/loadavg)" >> "$OUT/conditions.txt"
python3 -I "$HERE/qload/report.py" "$OUT" | tee "$OUT/report.md"
