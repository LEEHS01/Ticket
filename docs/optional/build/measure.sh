#!/usr/bin/env bash
# 빌드 시간과 이미지 크기를 같은 조건에서 잰다. 저장소 루트에서 실행한다.
#   bash docs/optional/build/measure.sh <backend|frontend> <Dockerfile> <이미지 태그> [hostbuild]
# 순서: 빌드 캐시 삭제 → 처음 빌드 → 소스 한 줄 변경 → 재빌드 → 소스 복원 → 재사용된 단계와 크기 출력
# hostbuild 를 붙이면 호스트에서 정적 파일을 빌드하는 시간(npm ci, npm run build)을 함께 잰다.
# 기반 이미지는 미리 받아 둔다(내려받는 시간은 재지 않는다).
set -euo pipefail
APP="$1"; DF="$2"; TAG="$3"; HOST="${4:-}"
if [ "$APP" = backend ]; then SRC=backend/src/main/java/com/ticketing/TicketingApplication.java; else SRC=frontend/src/main.tsx; fi
now() { date +%s.%N; }
sec() { awk "BEGIN{printf \"%.1f\", $2 - $1}"; }

docker builder prune -af > /dev/null

t0=$(now)
[ -n "$HOST" ] && (cd frontend && npm ci > /dev/null 2>&1 && npm run build > /dev/null 2>&1)
docker build -q -f "$DF" --build-arg APP_VERSION=dev -t "$TAG" "$APP" > /dev/null
t1=$(now)

echo "// measure $(date +%s)" >> "$SRC"
t2=$(now)
[ -n "$HOST" ] && (cd frontend && npm run build > /dev/null 2>&1)
docker build -f "$DF" --build-arg APP_VERSION=dev -t "$TAG" --progress=plain "$APP" > /tmp/rebuild.log 2>&1
t3=$(now)
git checkout -q "$SRC"

echo "[$(basename "$DF")] 처음 빌드 $(sec "$t0" "$t1")초, 소스 변경 후 재빌드 $(sec "$t2" "$t3")초"
echo "재빌드에서 캐시를 쓴 단계:"
grep -B1 ' CACHED' /tmp/rebuild.log | grep -oE '\[[^]]*\] .*' | cut -c1-90 | sed 's/^/  /' || true
docker image ls "$TAG"
