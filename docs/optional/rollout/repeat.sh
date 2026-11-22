#!/usr/bin/env bash
# measure.sh 를 여러 번 반복해 회차별 결과를 한 줄씩 출력한다.
#   bash docs/optional/rollout/repeat.sh <backend|frontend> [횟수] [초]
set -euo pipefail
TARGET="$1"; N="${2:-3}"; SEC="${3:-70}"
DIR="$(dirname "$0")"
for i in $(seq 1 "$N"); do
  r=$(bash "$DIR/measure.sh" "$TARGET" "$SEC" | grep -E '^(전체 요청|실패)' | tr '\n' ' ')
  echo "$TARGET ${i}회: $r"
  sleep 20
done
