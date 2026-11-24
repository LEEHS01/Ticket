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
| `k6/queue_load.js` | **요청량 테스트**(k6). 대기 폴링을 단계적으로 올리며 예매 흐름 응답 시간을 잰다. 대상 주소·회차·단계·폴링 간격을 매개변수로 받는다(AWS에서 그대로 쓰려고) |

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

```bash
# 서버는 요청 제한을 크게 올려 띄운다(운영 기본값은 그대로 둔다)
RATE_LIMIT_GENERAL_PER_MINUTE=1000000 RATE_LIMIT_STRICT_PER_MINUTE=1000000 RATE_LIMIT_POLL_PER_MINUTE=1000000 \
  QUEUE_MAX_ACTIVE=20 java -jar backend/target/app.jar ...
k6 run -e BASE_URL=http://127.0.0.1:18080 -e PERF_ID=30 -e WAITERS=20,50,100 -e STAGE_SECONDS=60 -e BOOKERS=2 \
  test/load/k6/queue_load.js
```

- 매개변수는 스크립트 맨 위 주석에 있습니다. 결과는 k6 요약의 `http_req_duration{flow:book_confirm}` 등(중앙값·95%·99%).
- 로컬에서는 예행(스크립트가 도는지)만 합니다. 이 PC의 수치는 결론으로 쓰지 않습니다(PLAN.md 6장).
- 가상 사용자마다 계정을 하나씩 가입합니다(`k6-<VU>-<시각>@example.com`). 테스트 DB에서만 돌리세요.
