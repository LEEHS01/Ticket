# 대기열 부하 테스트 (test/load)

목적과 결과·해석은 [`docs/next/load-test.md`](../../docs/next/load-test.md). 계획은 `docs/next/PLAN.md` 6장.
모두 WSL 배포판 `ticketing` 안에서 실행합니다(`wsl -d ticketing`, 저장소는 `/mnt/d/ticketing-next`). 결과·임시 파일은 D 드라이브(`/mnt/d/...`)에 둡니다.

| 파일 | 하는 일 |
|---|---|
| `run_scale.sh` | **데이터 규모 테스트.** 전용 `redis-server`(포트 16390, 저장 끔)를 띄우고 대기자 1만·5만·10만·30만 명을 채워 Lua 한 번의 시간과 메모리를 잰다. 끝나면 끈다 |
| `api_probe.sh` | 전용 Redis(16391) + 그 Redis를 보는 서버(18090)를 띄워 채운 대기열의 맨 앞·가운데·맨 뒤에서 `GET /api/queue/status` 응답 시간을 재고, 채운 키와 실제 진입 API가 만든 키의 형태를 대조한다 |
| `qload/fill_queue.py` | 한 회차의 대기열을 실제 키 구조로 채운다(진입 API를 거치지 않음). 토큰은 실제처럼 43자, 키는 SHA-256 |
| `qload/measure_queue.py` | 백엔드의 **실제 Lua 파일**(`backend/src/main/resources/redis/queue-*.lua`)을 그대로 실행하고 `SLOWLOG`로 서버 실행 시간(µs)을 읽는다 |
| `qload/compare_shape.py` | 채운 데이터와 실제 진입이 만든 데이터의 형태(타입·필드·TTL·멤버 형식) 대조 |
| `qload/report.py` | 결과 JSON → 표 |
| `qload/keys.py`, `qload/resp.py` | 백엔드와 같은 키 이름·인자 순서, 작은 Redis 클라이언트(외부 패키지 없음) |
| `k6/queue_load.js`, `k6/prepare_accounts.sh` | **요청량 테스트**(k6)와 테스트 계정 준비. 대기 폴링을 단계적으로 올리며 예매 흐름 응답 시간을 잰다. 대상 주소·회차·단계·폴링 간격을 매개변수로 받는다(AWS에서 그대로 쓰려고) |

## 1. 데이터 규모 테스트

```bash
cd /mnt/d/ticketing-next
bash test/load/run_scale.sh /mnt/d/tkn-load/scale "10000 50000 100000 300000"
# → /mnt/d/tkn-load/scale/report.md, scale-<N>.json, conditions.txt(측정 조건)
```

- 필요한 것: `redis-server`·`redis-cli`(Redis 7), Python 3(표준 라이브러리만). 메모리: 30만 명에 약 250~280 MiB.
- 개발·통합 테스트용 Redis(6379)는 건드리지 않습니다. `FLUSHALL`은 전용 인스턴스(16390)에만 보냅니다.
- 측정하는 동안 채운 대기자가 저절로 "폴링 끊김"이 되지 않도록 대기 TTL을 1시간으로 넘깁니다(끊긴 대기자 정리는 따로 잼).

## 2. API 수준 측정·형태 대조

```bash
cd /mnt/d/ticketing-next/backend && ./mvnw -B -DskipTests package && cd ..
bash test/load/api_probe.sh /mnt/d/tkn-load/api-300k 300000
```

- 서버는 `ticketing_next` DB(앱 계정 `tkn_app`, 비밀번호는 `~/.tkn-next.env`)를 씁니다. 다른 DB면 `PROBE_DB_NAME`·`PROBE_DB_USER`.
- 가입한 측정용 계정 4개가 DB에 남습니다(이메일 `probe-…@example.com`). 끝나면 전용 Redis와 서버를 끄고 쿠키·토큰 파일을 지웁니다.

## 3. 요청량 테스트(k6)

로컬에서는 **예행**(스크립트가 끝까지 도는지)만 합니다. 이 PC의 수치는 결론으로 쓰지 않습니다(PLAN.md 6장). 같은 스크립트를 주소만 바꿔 AWS에서 씁니다.

```bash
# 1) 서버를 테스트용 요청 제한으로 띄운다(아래 "요청 제한 다루기")
# 2) 테스트 계정 준비(VU 수 이상. 대기자 단계의 최댓값 + 예매자 수)
bash test/load/k6/prepare_accounts.sh http://127.0.0.1:18080 52 /mnt/d/tkn-load/accounts.csv
# 3) 실행. 결과 파일: --summary-export(요약 JSON), 필요하면 --out json=<파일>(요청마다)
k6 run -e BASE_URL=http://127.0.0.1:18080 -e PERF_ID=30 -e WAITERS=20,50 -e STAGE_SECONDS=30 -e RAMP_SECONDS=10 \
  -e BOOKERS=2 -e BASELINE_SECONDS=20 -e ACCOUNTS_FILE=/mnt/d/tkn-load/accounts.csv \
  --summary-export=/mnt/d/tkn-load/summary.json test/load/k6/queue_load.js
```

| 매개변수(`-e`) | 뜻 | 기본 |
|---|---|---|
| `BASE_URL` | 대상 주소(로컬·스테이징·AWS 모두 이것만 바꾼다) | 필수 |
| `PERF_ID` | 회차 id(판매 중, 좌석이 넉넉한 회차) | 필수 |
| `WAITERS` | 대기 가상 사용자 수의 단계(쉼표, 단계마다 목표치) | `20,50,100` |
| `STAGE_SECONDS` / `RAMP_SECONDS` | 단계마다 유지 시간 / 단계 사이 올리는 시간 | 60 / 15 |
| `BASELINE_SECONDS` | 대기 트래픽 없이 예매만 도는 기준선 | 30 |
| `BOOKERS` | 동시에 예매 흐름(입장 → 좌석 → 선점 → 확정 → 취소)을 도는 가상 사용자 | 2 |
| `POLL_SECONDS` | 대기 폴링 간격. 0이면 서버가 준 `pollAfterSeconds`를 따른다 | 0 |
| `ACCOUNTS_FILE` | 미리 만든 계정(`이메일,비밀번호` 줄). 없으면 VU마다 새로 가입 | 없음 |

- **계정 준비 방식**: 운영에 가까운 측정에는 `ACCOUNTS_FILE`을 씁니다(가입이 측정 구간에 섞이지 않고, 같은 계정으로 다시 돌릴 수 있음). **계정 수는 동시 VU 수 이상**이어야 합니다 — 같은 계정이 두 VU에 쓰이면 "사용자당 회차 토큰 1개" 규칙 때문에 서로의 대기열 토큰을 무효로 만듭니다. 파일은 권한 600으로 만들어지고 비밀번호가 들어 있으니 결과와 함께 저장소에 넣지 마세요.
- **요청 제한 다루기**: 요청 제한은 IP당이라, 부하 도구 한 대(IP 하나)에서 보내면 일반 120·엄격 30·폴링 240(분당)에 바로 걸려 측정이 안 됩니다. 테스트 때만 서버를 `RATE_LIMIT_GENERAL_PER_MINUTE=1000000 RATE_LIMIT_STRICT_PER_MINUTE=1000000 RATE_LIMIT_POLL_PER_MINUTE=1000000`으로 띄웁니다(운영 기본값과 k8s 설정은 바꾸지 않음. AWS에서는 테스트 전용 overlay나 ConfigMap 값으로). 앞단(ALB·WAF)에 요청 제한이 있으면 부하 도구의 IP를 테스트 동안만 예외로 두거나, 그 제한까지 포함해 재는지 먼저 정합니다. 요청 제한 카운터도 Redis를 쓰므로, 한도를 올려도 요청마다 Redis 왕복 1번은 그대로 남습니다(실제 부하와 같다).
- 결과 읽기: 요약의 `http_req_duration{flow:book_confirm}`·`book_hold`·`book_seats`·`book_cancel`·`queue_status`(중앙값·95%·99%·최대), `checks`(성공률), `http_req_failed`(선점 경쟁의 `409`가 포함되어 0이 아닐 수 있음), `queue_wait_seconds`(입장까지 기다린 시간). 예상 밖 응답은 VU마다 처음 3개가 경고 로그로 나옵니다.
- **k6 설치(이 배포판에만)**: v2.4.0. 받은 곳 `https://github.com/grafana/k6/releases/download/v2.4.0/k6-v2.4.0-linux-amd64.tar.gz`(31,274,392바이트), 같은 릴리스의 `k6-v2.4.0-checksums.txt`로 SHA-256 확인(`sha256sum -c` OK). 실행 파일은 `~/bin/k6`(SHA-256 `e24c0e74…a35bda17ce603e`). 내려받은 압축 파일은 지웠습니다.
- 가입 방식으로 돌리면 VU마다 계정이 하나씩 생깁니다(`k6-<VU>-<시각>@example.com`). 테스트 DB에서만 돌리세요.
