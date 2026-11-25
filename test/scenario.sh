#!/usr/bin/env bash
# 테스트 시나리오 T1~T8. WSL, Docker, kubeadm 클러스터, EKS 모든 단계에서 같은 스크립트로 확인한다.
#
#   bash test/scenario.sh http://localhost:5173           # T1~T7: 조회, 가입, 로그인, 예매, 내 예매, 취소
#   bash test/scenario.sh http://localhost:5173 verify    # T8: DB를 재시작하거나 교체한 뒤 데이터가 남아 있는지 확인
#
# 필요한 도구: curl, jq, openssl
# 테스트 계정(이메일, 비밀번호)과 예매번호는 상태 파일에 저장하고 화면에는 비밀번호를 출력하지 않는다.
#   상태 파일: $SCENARIO_STATE (기본값 ~/.ticketing-scenario)
#   기대 공연 수: $EXPECT_SHOWS (기본값 68)
set -uo pipefail

BASE="${1:?사용법: scenario.sh <주소> [verify]}"
BASE="${BASE%/}"
MODE="${2:-run}"
STATE="${SCENARIO_STATE:-$HOME/.ticketing-scenario}"
EXPECT_SHOWS="${EXPECT_SHOWS:-68}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

PASS=0; FAIL=0; CSRF=""; QTOKEN=""; STATUS=""; BODY=""

ok()   { PASS=$((PASS+1)); printf '[PASS] %s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '[FAIL] %s\n' "$*"; }
# check <설명> <실제값> <기대값>
check() { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 (기대 $3, 실제 $2)"; fi; }

# req <METHOD> <PATH> [JSON] : 응답 코드는 STATUS, 본문은 BODY에 담는다
req() {
  local method="$1" path="$2" data="${3:-}" out
  local args=(-sS -m 20 -b "$JAR" -c "$JAR" -X "$method" -w '\n%{http_code}')
  [ -n "$CSRF" ]   && args+=(-H "X-CSRF-Token: $CSRF")
  [ -n "$QTOKEN" ] && args+=(-H "X-Queue-Token: $QTOKEN")
  if [ "$method" = POST ] && [ "$path" = /api/reservations ]; then
    args+=(-H "Idempotency-Key: $(cat /proc/sys/kernel/random/uuid)")
  fi
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data "$data")
  out="$(curl "${args[@]}" "$BASE$path")" || { STATUS=000; BODY=""; return; }
  STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}
j() { printf '%s' "$BODY" | jq -r "$1" 2>/dev/null; }

csrf_refresh() { req GET /api/auth/me; CSRF="$(j .csrfToken)"; }

# 회차의 잔여석 합계
remaining() { req GET "/api/shows/$1"; j "[.performances[] | select(.id==$2) | .remainingByGrade[].remaining] | add"; }

# reserve <좌석 수> : 대기열 진입 → 좌석 선택 → 선점 → 예매 확정. 예매번호를 CODE에 담는다
reserve() {
  local n="$1" seats hold
  QTOKEN=""
  req POST /api/queue/enter "{\"performanceId\":$PERF_ID}"
  QTOKEN="$(j .queueToken)"
  local st; st="$(j .status)"
  for _ in $(seq 1 30); do
    [ "$st" = ADMITTED ] && break
    sleep 2; req GET /api/queue/status; st="$(j .status)"
  done
  [ "$st" = ADMITTED ] || { bad "대기열 입장 (상태 $st)"; return 1; }
  req GET "/api/performances/$PERF_ID/seats"
  seats="$(j "[.seats[] | select(.status==\"AVAILABLE\") | .id] | .[-$n:] | @csv")"
  [ -n "$seats" ] || { bad "선택할 좌석이 없음"; return 1; }
  req POST "/api/performances/$PERF_ID/holds" "{\"seatIds\":[$seats]}"
  [ "$STATUS" = 201 ] || { bad "좌석 선점 (HTTP $STATUS $(j .error.code))"; return 1; }
  hold="$(j .holdId)"
  req POST /api/reservations "{\"holdId\":\"$hold\"}"
  [ "$STATUS" = 201 ] || { bad "예매 확정 (HTTP $STATUS $(j .error.code))"; return 1; }
  CODE="$(j .code)"
  QTOKEN=""
}

echo "대상: $BASE   시각: $(date '+%F %T')"
req GET /api/version
echo "버전: $(j .version)"

if [ "$MODE" = verify ]; then
  # ---------- T8 데이터 유지 ----------
  [ -f "$STATE" ] || { echo "상태 파일이 없습니다: $STATE (먼저 T1~T7을 실행합니다)"; exit 2; }
  . "$STATE"
  csrf_refresh
  req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
  check "T8 기존 계정으로 로그인" "$STATUS" 200
  CSRF="$(j .csrfToken)"
  req GET /api/me/reservations
  check "T8 확정한 예매 $CODE_KEEP 유지" "$(j ".reservations[] | select(.code==\"$CODE_KEEP\") | .status")" CONFIRMED
  check "T8 취소한 예매 $CODE_CANCEL 유지" "$(j ".reservations[] | select(.code==\"$CODE_CANCEL\") | .status")" CANCELLED
  req GET /api/shows
  check "T8 공연 수" "$(j '.shows | length')" "$EXPECT_SHOWS"
else
  # ---------- T1 공연 목록 조회 ----------
  req GET /api/shows
  check "T1 공연 목록 조회: 공연 수" "$(j '.shows | length')" "$EXPECT_SHOWS"
  SHOW_ID="$(j '[.shows[] | select(.status=="ON_SALE")] | .[0].id')"
  SHOW_TITLE="$(j ".shows[] | select(.id==$SHOW_ID) | .title")"
  req GET '/api/shows?genre=MUSICAL'
  n="$(j '.shows | length')"; m="$(j '[.shows[] | select(.genre=="MUSICAL")] | length')"
  if [ "${n:-0}" -gt 0 ] && [ "$n" = "$m" ]; then ok "T1 장르 필터(MUSICAL): ${n}개 모두 뮤지컬"; else bad "T1 장르 필터 (전체 $n, 뮤지컬 $m)"; fi
  word="${SHOW_TITLE%% *}"
  req GET "/api/shows?q=$(printf '%s' "$word" | jq -sRr @uri)"
  n="$(j '.shows | length')"
  if [ "${n:-0}" -ge 1 ]; then ok "T1 검색(\"$word\"): ${n}개"; else bad "T1 검색(\"$word\"): 결과 없음"; fi

  # ---------- T2 공연 상세 조회 ----------
  req GET "/api/shows/$SHOW_ID"
  check "T2 공연 상세 조회: \"$SHOW_TITLE\"" "$STATUS" 200
  PERF_ID="$(j '[.performances[] | select(.status=="ON_SALE")] | .[0].id')"
  if [ -n "$PERF_ID" ] && [ "$PERF_ID" != null ]; then ok "T2 판매 중인 회차 확인 (회차 id $PERF_ID)"; else bad "T2 판매 중인 회차 없음"; fi

  # ---------- T3 회원가입 ----------
  EMAIL="t$(date +%m%d%H%M%S)@example.com"
  PASSWORD="$(openssl rand -hex 8)"
  csrf_refresh
  req POST /api/auth/signup "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"시나리오\"}"
  check "T3 회원가입: $EMAIL" "$STATUS" 201
  CSRF="$(j .csrfToken)"

  # ---------- T4 로그아웃, 로그인 ----------
  req POST /api/auth/logout
  check "T4 로그아웃" "$STATUS" 204
  csrf_refresh
  req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"wrong-$PASSWORD\"}"
  check "T4 틀린 비밀번호로 로그인" "$STATUS/$(j .error.code)" "401/INVALID_CREDENTIALS"
  req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
  check "T4 올바른 비밀번호로 로그인" "$STATUS" 200
  CSRF="$(j .csrfToken)"

  # ---------- T5 예매 ----------
  before="$(remaining "$SHOW_ID" "$PERF_ID")"
  CODE=""
  if reserve 2; then
    CODE_KEEP="$CODE"
    ok "T5 좌석 2석 예매: 예매번호 $CODE_KEEP"
    after="$(remaining "$SHOW_ID" "$PERF_ID")"
    check "T5 잔여석 2석 감소 ($before → $after)" "$((before-after))" 2
  fi

  # ---------- T6 내 예매 조회 ----------
  req GET /api/me/reservations
  check "T6 내 예매 조회: $CODE_KEEP 상태" "$(j ".reservations[] | select(.code==\"${CODE_KEEP:-}\") | .status")" CONFIRMED

  # ---------- T7 예매 취소 ----------
  before="$(remaining "$SHOW_ID" "$PERF_ID")"
  if reserve 1; then
    CODE_CANCEL="$CODE"
    req POST "/api/me/reservations/$CODE_CANCEL/cancel"
    check "T7 예매 $CODE_CANCEL 취소" "$STATUS/$(j .status)" "200/CANCELLED"
    after="$(remaining "$SHOW_ID" "$PERF_ID")"
    check "T7 취소 후 잔여석 복구 ($before → $after)" "$after" "$before"
  fi

  umask 077
  printf 'EMAIL=%s\nPASSWORD=%s\nCODE_KEEP=%s\nCODE_CANCEL=%s\n' "$EMAIL" "$PASSWORD" "${CODE_KEEP:-}" "${CODE_CANCEL:-}" > "$STATE"
fi

echo "결과: 통과 $PASS, 실패 $FAIL"
[ "$FAIL" -eq 0 ]
