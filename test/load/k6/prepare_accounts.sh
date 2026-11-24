#!/usr/bin/env bash
# k6용 테스트 계정을 미리 만든다(가입 API를 그대로 부른다 → 로컬·원격 어디서나 같다).
#   bash test/load/k6/prepare_accounts.sh <대상 주소> <계정 수> <출력 파일> [이메일 앞부분]
#   예) bash test/load/k6/prepare_accounts.sh http://127.0.0.1:18080 60 /mnt/d/tkn-load/accounts.csv
# 출력: 한 줄에 "이메일,비밀번호"(k6의 ACCOUNTS_FILE). 비밀번호는 계정마다 무작위이고 이 파일에만 남는다 → 파일 권한 600.
# 가입은 strict 요청 제한(IP당 분당 30) 대상이다. 많이 만들 때는 서버를 테스트용 한도로 띄운다(test/load/README.md 3장).
set -euo pipefail
BASE="${1:?대상 주소}"; N="${2:?계정 수}"; OUT="${3:?출력 파일}"; PREFIX="${4:-k6acct}"
command -v jq > /dev/null || { echo "jq가 필요합니다" >&2; exit 1; }
umask 077
: > "$OUT"
JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT
ok=0
for i in $(seq 1 "$N"); do
  rm -f "$JAR"
  email="${PREFIX}-$(date +%s%N)-${i}@example.com"
  pw="$(openssl rand -hex 12)"
  csrf=$(curl -sS -m 10 -c "$JAR" -b "$JAR" "$BASE/api/auth/me" | jq -r .csrfToken)
  code=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' \
    -H "X-CSRF-Token: $csrf" --data "{\"email\":\"$email\",\"password\":\"$pw\",\"name\":\"부하\"}" "$BASE/api/auth/signup")
  if [ "$code" = 201 ]; then echo "$email,$pw" >> "$OUT"; ok=$((ok + 1)); else echo "가입 실패($i): HTTP $code" >&2; fi
done
echo "계정 $ok/$N개 → $OUT"
