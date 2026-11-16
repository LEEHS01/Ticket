# 티켓 예매 API (backend) — v3

공연 찾기 → 회차 선택 → **로그인** → **접속 대기열** → **좌석 선택(임시 선점)** → 예매 확정 → **내 예매**(조회·취소)를 제공하는 **상태 없는** Spring Boot API입니다.
계약(엔드포인트·응답 형태·오류 코드)은 [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) 4장(v3)이 기준입니다.

| 항목 | 선택 |
|---|---|
| 언어/프레임워크 | Java 21, Spring Boot 3.5.16 (Spring MVC + **가상 스레드**) |
| DB 접근 | Spring JDBC `JdbcClient` (JPA 미사용), Flyway |
| 로그인 세션 | **Spring Session Data Redis**(서버 메모리 세션 없음) + BCrypt(`spring-security-crypto`) + 자체 CSRF 필터 |
| 짧게 사는 상태 | Redis 7 (Lettuce) + **Lua 스크립트**: 세션, 대기열, 좌석 선점, 로그인 실패 횟수, 요청 제한, 멱등키 |
| 빌드 | Maven Wrapper (`./mvnw`, Maven 3.9.16) |
| 이미지 | 멀티스테이지 → **alpine + jlink 맞춤 JRE + AppCDS**, non-root(UID 10001), 읽기 전용 루트 FS |

> 이 PC에는 JDK 21이 없으므로 **빌드·테스트·실행을 모두 Docker로** 합니다. 아래 명령은 PowerShell 기준입니다
> (Git Bash에서는 `/tmp` 같은 경로가 바뀌지 않도록 앞에 `MSYS_NO_PATHCONV=1`을 붙이세요).

### v2 → v3에서 바뀐 것
- **회원가입·로그인·로그아웃**(`/api/auth/*`)과 **내 예매**(`GET /api/me/reservations`, `POST /api/me/reservations/:code/cancel`) 추가.
- 예매 흐름 전체(대기열 진입·상태·이탈, 좌석 조회, 선점, 확정)에 **로그인 필수**. 대기열 토큰·선점·멱등키가 **사용자에게 묶인다**.
- 예매 확정 body는 `{ holdId }`만(이름·이메일은 계정에서). **회차당 계정 합산 4석** 제한(`BOOKING_LIMIT_EXCEEDED`).
- v2의 비회원 조회·취소(`/api/reservations/lookup`, `/cancel`)와 관련 코드는 **삭제**.
- 스키마: **Flyway `V2__users_and_reservation_owner.sql`을 V1 위에 쌓았다**(V1은 그대로). v2 데이터가 있는 DB도 **볼륨을 다시 만들 필요 없이** `migrate` 한 번으로 올라간다(기존 예매는 로그인 불가 시드 계정 소유로 옮겨짐). 실측: v2 예매 292건이 있던 개발 DB에 그대로 적용됨.

### v1 → v2에서 바뀐 것 (기록)
- 모델: 공연 1개 = 일정 1개·수량 선택 → **공연(Show) → 회차(Performance) → 좌석(Seat)**. `/api/events`와 수량 기반 재고 차감(Lua)은 삭제.
- 추가: 회차별 접속 대기열, 좌석 임시 선점, 장르·검색·랭킹·오픈 예정 정렬, 좌석 등급별 가격, 공연장별 좌석 배치.
- 이때 V1을 다시 썼기 때문에 **v1 볼륨 → v2는 볼륨 재생성이 필요했다**(그래서 v3부터는 V2로 쌓는다).
- 개발용 compose 프로젝트 이름 `ticketing-dev` → **`tkbe-dev`**, 호스트 포트 **13306 / 16379**(통합 스택 `ticketing-*`과 충돌 방지).

---

## 1. 실행 방법

### 1-1. MySQL·Redis 띄우기 (개발용)

```powershell
docker compose -f docker-compose.dev.yml up -d --wait
```

- MySQL 8.4, Redis 7. 둘 다 healthcheck가 통과해야 `--wait`가 끝납니다. 비밀번호는 전부 **개발용 가짜 값**입니다.
- 처음 볼륨이 만들어질 때 `docker/mysql-init/01-init.sql`이 **앱 전용 최소 권한 계정**(`ticketing_app`)과 테스트 DB(`ticketing_test`)를 만듭니다.

### 1-2. 이미지 빌드

```powershell
docker build -t ticketing-backend .
```

### 1-3. 마이그레이션 + 시드 (서버와 분리된 실행 모드)

같은 이미지를 `migrate` 인자로 실행하면 **Flyway 마이그레이션 + 시드만 하고 종료**합니다(웹 서버를 띄우지 않음, Redis 불필요).
DDL 권한이 있는 소유자 계정(`ticketing`)으로 실행합니다. 여러 번 실행해도 안전합니다. 나중에 K8s에서는 **Job**으로 돌립니다.

```powershell
docker run --rm --read-only --tmpfs /tmp --network tkbe-dev_default `
  --env-file .env.example -e DB_USER=ticketing -e DB_PASSWORD=dev-only-migrate-pw `
  -e SEED_DEMO_EMAIL=demo@example.com -e SEED_DEMO_PASSWORD=<시연용 비밀번호 8자 이상> `
  ticketing-backend migrate
```

로그 마지막 줄 예: `마이그레이션·시드 완료: 공연 12개·회차 25개 upsert, 새 좌석 3808석, 새 시드 예매 292건, 시연 계정 생성·갱신` (두 번째부터는 0석·0건).

- **시연 계정**: `SEED_DEMO_EMAIL`과 `SEED_DEMO_PASSWORD`가 **둘 다** 있을 때만 그 값으로 만들고(이미 있으면 비밀번호·이름 갱신), 하나라도 없으면 건너뜁니다. 비밀번호는 코드·SQL·로그에 남지 않습니다.
- **미리 판매된 시드 좌석**은 `seed-system@ticketing.invalid` 계정 소유입니다. 이 계정은 `login_enabled = FALSE`이고 비밀번호 해시가 BCrypt 형식이 아니라(`!`) 어떤 비밀번호로도 로그인할 수 없습니다(V2 마이그레이션이 만듦).

**시드(전부 지어낸 공연·출연진·장소)** — 실행 시각 기준 상대 날짜(KST)라 언제 돌려도 상태가 섞입니다.

| 장르 | 공연 | 상태 |
|---|---|---|
| CONCERT | 새벽빛 밴드 단독 콘서트 〈푸른 주파수〉 | 판매 중, 3회차 중 **첫 회차 매진** |
| CONCERT | 한여름 시티팝 나이트 | 판매 중 |
| CONCERT | 물결 인디 페스티벌 2026 | **종료** |
| MUSICAL | 뮤지컬 〈시간을 접는 소녀〉 | 판매 중(4회차, 판매량 1위) |
| MUSICAL | 뮤지컬 〈등대지기의 노래〉 | 판매 중 |
| MUSICAL | 뮤지컬 〈구름 정거장〉 | **오픈 예정(2일 뒤)** |
| PLAY | 연극 〈마지막 편지는 목요일에〉 | **매진** |
| PLAY | 연극 〈옥탑방 천문대〉 | 판매 중 |
| PLAY | 연극 〈두 번째 이사〉 | 오픈 예정(12일 뒤) |
| CLASSIC | 가을 실내악의 밤 | 판매 중 |
| CLASSIC | 미리내 청년 오케스트라 정기 연주회 | 오픈 예정(6일 뒤) |
| CLASSIC | 피아노 리사이틀 〈물의 기억〉 | 판매 중 |

**좌석 배치 템플릿**(`migrate/VenueLayout.java`, 공연장마다 하나. 같은 공연장 이름은 같은 템플릿):
- `SMALL` 소극장 — 8행 × 12석 직사각형, 통로 1개(6번 뒤). 96석
- `MEDIUM` 중형 극장 — 12행 × 18석 직사각형, 통로 2개(4·14번 뒤). 216석
- `FAN` 부채꼴 — 10행, 앞 두 행 8석에서 두 행마다 2석씩 넓어져 뒤 두 행 16석(가운데 정렬), 통로 5·11번 뒤. 120석
- `CUT_CORNERS` 가장자리 빠짐 — 11행 × 16석, 앞 두 행 양끝 2석·마지막 행 양끝 1석 없음, 통로 4·12번 뒤. 166석

`seatsPerRow`는 가장 긴 행 기준, 좌석 `number`는 그 격자의 열 위치(1부터)입니다. `seats[]`에 없는 (행, 번호)는 자리가 없는 칸이므로 UI는 비워 두면 됩니다.
등급 구역은 공연마다 다릅니다(앞쪽 행부터 높은 등급). 시드는 회차에 좌석이 없을 때만 좌석을 만들므로, **템플릿을 바꾼 뒤에는 MySQL 볼륨을 새로 만들어야** 새 배치가 적용됩니다.

### 1-4. 서버 실행 (읽기 전용 루트 FS + non-root)

```powershell
docker run -d --name tkbe-api --read-only --tmpfs /tmp `
  --cap-drop ALL --security-opt no-new-privileges --memory 512m `
  --network tkbe-dev_default --env-file .env.example -p 127.0.0.1:18080:8080 `
  ticketing-backend

curl.exe http://127.0.0.1:18080/readyz       # {"status":"ready"}
```

- 로컬은 http라 `.env.example`의 `SESSION_COOKIE_SECURE=false`가 필요합니다(운영 기본값은 `true`).
- 복제본을 하나 더 띄우려면 이름·포트만 바꿔 같은 명령을 한 번 더 실행하세요(예: `tkbe-api-2`, `18081`). 세션이 Redis에 있어 어느 쪽으로 요청해도 로그인이 유지됩니다.
- 이 PC에서는 `localhost:8080`을 WSL의 다른 서버가, `localhost:8088`을 통합 스택이 쓰고 있어 **18080**을 씁니다.

### 1-5. curl로 흐름 확인 (쿠키 저장)

> Windows 터미널에서 한글을 `-d '...'`나 URL에 그대로 넣으면 UTF-8이 아닌 코드페이지로 전송될 수 있습니다.
> 한글 body는 UTF-8 파일(`--data-binary "@파일"`), 한글 검색어는 퍼센트 인코딩(`q=%ED%95%98...`)으로 보내세요.

```powershell
$B = "http://127.0.0.1:18080/api"; $B2 = "http://127.0.0.1:18081/api"   # 두 번째 복제본(있으면)
function J($o) { $o | ConvertTo-Json -Compress | Set-Content -Encoding utf8 body.json }

# 1) 익명 세션 + CSRF 토큰 → 가입(가입과 동시에 로그인, 새 csrfToken)
$csrf = (curl.exe -s -c jar.txt -b jar.txt "$B/auth/me" | ConvertFrom-Json).csrfToken
J @{ email = "me@example.com"; password = "password-123"; name = "홍길동" }
$csrf = (curl.exe -s -c jar.txt -b jar.txt -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" --data-binary "@body.json" "$B/auth/signup" | ConvertFrom-Json).csrfToken

# 2) 대기열 진입 → 좌석 → 선점 (복제본 1)
J @{ performanceId = 8 }
$T = (curl.exe -s -c jar.txt -b jar.txt -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" --data-binary "@body.json" "$B/queue/enter" | ConvertFrom-Json).queueToken
curl.exe -s -b jar.txt -H "X-Queue-Token: $T" "$B/performances/8/seats"
J @{ seatIds = @(1137, 1138) }    # 위 응답의 AVAILABLE 좌석 id
$h = curl.exe -s -b jar.txt -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -H "X-Queue-Token: $T" --data-binary "@body.json" "$B/performances/8/holds" | ConvertFrom-Json

# 3) 확정 (복제본 2에서 해도 같다) → 내 예매 → 취소 → 로그아웃
J @{ holdId = $h.holdId }
$r = curl.exe -s -b jar.txt -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -H "X-Queue-Token: $T" -H "Idempotency-Key: $([guid]::NewGuid())" --data-binary "@body.json" "$B2/reservations" | ConvertFrom-Json
curl.exe -s -b jar.txt "$B/me/reservations"
curl.exe -s -b jar.txt -X POST -H "X-CSRF-Token: $csrf" "$B2/me/reservations/$($r.code)/cancel"
curl.exe -s -b jar.txt -c jar.txt -X POST -H "X-CSRF-Token: $csrf" "$B/auth/logout"
curl.exe -s -b jar.txt "$B/me/reservations"   # 401 UNAUTHENTICATED
```

**대기 화면 시연**: `-e QUEUE_MAX_ACTIVE=1`로 서버를 띄우면 두 번째 계정의 진입이 `WAITING`이 됩니다.

### 1-6. 정리

```powershell
docker rm -f tkbe-api tkbe-api-2
docker compose -f docker-compose.dev.yml down      # 데이터 볼륨까지 지우려면 -v
```

---

## 2. 테스트

| 종류 | 위치 | 실행 단계 | 필요한 것 |
|---|---|---|---|
| 서비스 단위 테스트 | `AuthServiceTest`, `SessionAndCsrfTest`, `ShowServiceTest`, `QueueServiceTest`, `SeatServiceTest`, `ReservationServiceTest`, `VenueLayoutTest`, `EmailPrivacyAndCodeTest` | `test` | 없음(가짜 저장소 주입) |
| HTTP 계층 테스트 | `ApiWebTest` (MockMvc, 세션은 MockHttpSession) | `test` | 없음 |
| 통합 테스트 | `it/AuthSessionIT`, `it/SeatConcurrencyIT`, `it/QueueIT` | `verify` | 실제 MySQL·Redis |

통합 테스트가 확인하는 것(실제 MySQL·Redis·Lua·HTTP):
1. **애플리케이션 인스턴스 2개**(같은 Redis)를 띄우고, 인스턴스 1에서 받은 세션 쿠키를 인스턴스 2에 보내도 **로그인이 유지된다**. 세션 키가 Redis에 있고 TTL이 30분이며, 로그아웃하면 Redis에서 지워진다.
2. **CSRF 토큰 없이**(또는 다른 값으로) 상태 변경 요청 → **403 `CSRF_INVALID`**. 세션 없이 로그인 요청도 403.
3. **A 계정의 예매를 B 계정이** 목록에서 볼 수 없고, 취소하면 **404**. A의 좌석은 그대로.
4. **로그인(가입) 전후로 세션 ID가 바뀌고**(옛 ID는 Redis에서 사라짐) CSRF 토큰도 바뀐다. 쿠키는 `HttpOnly; SameSite=Lax; Path=/`.
5. **같은 계정이 두 번에 나눠 5석**을 확정하려 하면 두 번째가 **409 `BOOKING_LIMIT_EXCEEDED`**.
6. 한 인스턴스에서 대기열·선점 → **다른 인스턴스에서 확정** → 내 예매 → 취소 → 로그아웃 후 401.
7. 로그인 5회 연속 실패 → **429 `ACCOUNT_LOCKED` + `Retry-After`**(실패가 두 인스턴스로 나뉘어도 Redis에서 합산). 없는 이메일과 틀린 비밀번호의 응답이 같다.
8. (v2부터) 같은 좌석 동시 선점 50건 → 1건만 성공 / Redis 선점 키를 지운 뒤 두 계정이 같은 좌석 확정 → DB에서 1건만 / `QUEUE_MAX_ACTIVE=2`에서 5명 진입 → 완료·이탈마다 대기 1번 승격 / 입장 전 토큰 403, 남의 토큰 401.

```powershell
# 1-1로 MySQL·Redis를 먼저 띄운 뒤 (Maven 캐시는 named volume ticketing-m2에 보관)
docker run --rm -v "${PWD}:/src" -v ticketing-m2:/root/.m2 -w /src --network tkbe-dev_default `
  -e DB_HOST=mysql -e DB_NAME=ticketing_test -e DB_USER=ticketing -e DB_PASSWORD=dev-only-migrate-pw `
  -e REDIS_HOST=redis -e REDIS_PASSWORD=dev-only-redis-pw -e REDIS_DATABASE=1 `
  maven:3.9-eclipse-temurin-21 ./mvnw -B verify

# DB 없이 단위 테스트만
docker run --rm -v "${PWD}:/src" -v ticketing-m2:/root/.m2 -w /src maven:3.9-eclipse-temurin-21 ./mvnw -B test
```

통합 테스트는 개발 데이터와 섞이지 않게 **`ticketing_test` DB와 Redis DB 1번**을 쓰고, 테스트마다 Redis DB 1을 비웁니다.
단위 테스트의 대기열·선점 가짜 구현은 Lua와 같은 규칙을 흉내 낸 것이고, **Lua 자체의 동작은 통합 테스트가 실제 Redis로 검증**합니다. 단위 테스트의 BCrypt는 속도를 위해 cost 4입니다(운영 12).

---

## 3. 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `DB_HOST` | ✅ | — | MySQL 호스트 |
| `DB_PORT` | | `3306` | |
| `DB_NAME` | | `ticketing` | |
| `DB_USER` | ✅ | — | 서버: `ticketing_app`(SELECT/INSERT/UPDATE만), migrate: 소유자 계정 |
| `DB_PASSWORD` | ✅ | — | |
| `DB_SSL_MODE` | | `PREFERRED` | `DISABLED`·`PREFERRED`·`REQUIRED`·`VERIFY_CA`·`VERIFY_IDENTITY` |
| `DB_POOL_SIZE` | | `10` | Hikari 최대 연결 수(1~100) |
| `REDIS_HOST` | ✅ (서버) | — | migrate 모드에서는 쓰지 않음 |
| `REDIS_PORT` | | `6379` | |
| `REDIS_PASSWORD` | | (없음) | |
| `REDIS_SSL` | | `false` | ElastiCache 전송 암호화 시 `true` |
| `REDIS_DATABASE` | | `0` | 0~15 |
| `SESSION_IDLE_MINUTES` | | `30` | **v3** 요청이 없으면 이 시간(분) 뒤 세션 만료(1~1440) |
| `SESSION_COOKIE_SECURE` | | `true` | **v3** 세션 쿠키 `Secure`. 로컬 http는 **`false`로 지정** |
| `SEED_DEMO_EMAIL` | | — | **v3** migrate 전용. 시연 계정 이메일(비밀번호와 둘 다 있을 때만) |
| `SEED_DEMO_PASSWORD` | | — | **v3** migrate 전용. 시연 계정 비밀번호(8자 이상, 72바이트 이하) |
| `SEED_DEMO_NAME` | | `시연 사용자` | **v3** migrate 전용 |
| `QUEUE_MAX_ACTIVE` | | `100` | 회차당 좌석 화면 동시 입장 인원(시연: `1`) |
| `QUEUE_ADMIT_SECONDS` | | `600` | 입장 권한 유효 시간(초, ≥30) |
| `QUEUE_WAIT_TTL_SECONDS` | | `30` | 대기 중 폴링이 이만큼 끊기면 대기열에서 제외(초, ≥3) |
| `HOLD_SECONDS` | | `300` | 좌석 임시 선점 시간(초, ≥10). 연장 불가, 입장 만료를 넘지 않음 |
| `RATE_LIMIT_GENERAL_PER_MINUTE` | | `120` | IP당 분당, 일반 |
| `RATE_LIMIT_STRICT_PER_MINUTE` | | `30` | IP당 분당, 가입·로그인·대기열 진입·선점·선점 해제·예매 확정·예매 취소 |
| `RATE_LIMIT_POLL_PER_MINUTE` | | `240` | IP당 분당, 폴링(`/queue/status`, `/performances/:id/seats`) |
| `CORS_ALLOWED_ORIGINS` | | (비활성) | 쉼표 구분 `http(s)://호스트[:포트]`. `*` 불가 |
| `JAVA_TOOL_OPTIONS` | | — | JVM 옵션 추가가 필요할 때 |

필수 값이 비었거나 범위를 벗어나면 `@ConfigurationProperties` + Bean Validation 검증에서 **기동 즉시 실패**합니다. `AppProperties`의 `toString()`은 비밀번호를 가립니다.

---

## 4. 폴더 구조

```
backend/
├─ Dockerfile                 멀티스테이지(build → jlink JRE → runtime). --target runtime-jre 는 비교용
├─ docker-compose.dev.yml     개발용 MySQL 8.4 + Redis 7 (프로젝트 tkbe-dev, healthcheck)
├─ docker/mysql-init/         개발 DB 초기화(최소 권한 계정, 테스트 DB)
├─ .env.example               가짜 값만
├─ mvnw, mvnw.cmd, .mvn/      Maven Wrapper
├─ pom.xml
└─ src/
   ├─ main/java/com/ticketing/
   │  ├─ TicketingApplication.java   실행 모드 분기(서버 / migrate)
   │  ├─ config/        AppProperties(환경변수 검증), JacksonConfig(엄격한 JSON), WebConfig(CORS), Clock
   │  ├─ web/           필터: 요청 ID·접근 로그 → 보안 헤더 → body 16KB → 요청 제한 → (Spring Session) → CSRF
   │  ├─ common/        ErrorCode, ApiException(details·Retry-After), 전역 예외 처리, /error 대체, Transactions
   │  ├─ auth/          v3: 가입·로그인(AuthService), 세션 읽고 쓰기(SessionAuth), CsrfFilter, 사용자·로그인 실패 저장소
   │  ├─ show/          공연 목록·상세: controller → service → repository(JDBC), 상태 규칙(SaleStatus)
   │  ├─ queue/         대기열: QueueService → QueueStore(Redis Lua), 토큰 생성, Redis 키 이름
   │  ├─ seat/          좌석 화면·선점: SeatService → SeatRepository(JDBC) + HoldStore(Redis Lua)
   │  ├─ reservation/   확정·내 예매·취소, 멱등 저장소(Redis), 예매번호, 이메일 해시·마스킹
   │  ├─ ratelimit/     Redis 고정 창 카운터
   │  ├─ health/        /healthz, /readyz
   │  └─ migrate/       시드·공연장 배치 템플릿(migrate 프로필에서만 로드)
   ├─ main/resources/
   │  ├─ application.yml, application-migrate.yml
   │  ├─ db/migration/V1__init.sql, V2__users_and_reservation_owner.sql   (Flyway)
   │  └─ redis/*.lua    queue-common/enter/poll/peek/leave, hold-create/release, login-failure, rate-limit
   └─ test/java/com/ticketing/
      ├─ support/       InMemoryStore(가짜 저장소), TestApp(서비스 조립)
      ├─ auth/, show/, queue/, seat/, reservation/, migrate/, web/   단위·HTTP 테스트
      └─ it/            실제 MySQL·Redis 통합 테스트(*IT). AuthSessionIT는 앱 인스턴스 2개
```

### 데이터 모델

```
users ─────────────────────────────┐ (v3: email 유니크, password_hash=BCrypt, login_enabled)
shows ─┬─ grades (show_id, code, price)                     │
       └─ performances ─── seats (status AVAILABLE|SOLD, reservation_id)
                              │                             │
reservations (user_id ◄──────┼─────────────────────────────┘) ── reservation_seats (예매 당시 좌석·가격)
```

### Redis 키

| 키 | 타입 | 내용 | 수명 |
|---|---|---|---|
| `ticketing:session:sessions:{세션ID}` | HASH | **v3** Spring Session: 생성·마지막 접근 시각 + 속성 `uid`(사용자 id), `csrf`(CSRF 토큰) | 유휴 30분(요청마다 연장) |
| `auth:fail:{SHA-256(이메일)}` | STRING | **v3** 연속 로그인 실패 횟수(5 이상이면 잠김) | 마지막 실패로부터 15분 |
| `queue:{회차}:waiting` | ZSET | 대기자(점수 = 진입 순번) | — |
| `queue:{회차}:seen` | ZSET | 대기자의 마지막 폴링 시각(ms) | — |
| `queue:{회차}:active` | ZSET | 입장자(점수 = 입장 만료 ms) | — |
| `queue:{회차}:seq` | STRING | 진입 순번 카운터 | — |
| `queue:{회차}:user:{사용자}` | STRING | **v3** 이 사용자의 이 회차 토큰(회차당 1개) | 토큰과 같음 |
| `queue:token:{SHA-256(토큰)}` | HASH | `perf`, `uid`(v3), `hold` | 입장+대기 TTL+60초, 폴링마다 갱신 |
| `hold:{holdId}` | HASH | `token`, `uid`(v3), `perf`, `seats`, `total`, `expiresAt` | 선점 시간 |
| `seat:hold:{회차}:{좌석}` | STRING | 선점한 holdId | 선점 시간 |
| `idem:reservation:{사용자}:{key}` | STRING | 처리 중 표시 / 처음 201 응답(v3: 사용자별) | 60초 / 24시간 |
| `rl:{버킷}:{IP}` | STRING | 요청 수 | 1분 |

---

## 5. 설계 요점 — 왜 이렇게 했나

### 5-1. 계층형 + 생성자 주입
`controller(HTTP·검증) → service(업무 규칙) → repository(MySQL/Redis)`. 서비스는 저장소 **인터페이스**에만 의존합니다.
**왜?** 가입·잠금 규칙, 대기열 규칙, 선점 전부/전무, 확정 시 DB 방어선, 4석 제한, 본인 예매만 취소를 DB·Redis 없이 밀리초 단위로 테스트할 수 있습니다(`InMemoryStore`).
세션은 컨트롤러에서 `SessionAuth`로 사용자 id만 꺼내 서비스에 넘깁니다 → 서비스는 HTTP 세션을 모르고, 테스트는 사용자 id만 주면 됩니다.

### 5-2. 로그인과 세션 (v3)

**세션은 Redis에 둔다(Spring Session Data Redis).** 브라우저에는 세션 ID만 쿠키 `TKT_SESSION`으로 주고, 세션 내용(로그인한 사용자 id, CSRF 토큰)은 Redis HASH에 있습니다.

| | 서버 메모리 세션(기본 Tomcat) | **Redis 세션(이 프로젝트)** |
|---|---|---|
| 파드가 여러 개 | 로그인한 파드로만 가야 함 → **스티키 세션** 필요(ALB 쿠키 고정) | 어느 파드로 가도 같은 세션 |
| 파드 재시작·롤링 업데이트·HPA 축소 | 그 파드의 사용자 전원 **로그아웃** | 영향 없음 |
| 로그아웃·강제 만료 | 그 파드에서만 | Redis에서 지우면 즉시 전체 무효 |
| 추가 인프라 | 없음 | 없음(대기열·선점용 Redis를 이미 씀) |

실측: 앱 인스턴스 2개(통합 테스트) / 컨테이너 2개(curl)에서 한쪽에서 로그인·선점하고 다른 쪽에서 확정·취소해도 그대로 동작했습니다.

**쿠키**: `TKT_SESSION=<세션 ID(base64)>; Path=/; HttpOnly; SameSite=Lax` + 운영은 `Secure`(`SESSION_COOKIE_SECURE`).
`HttpOnly` → 자바스크립트가 읽을 수 없어 XSS로 세션을 훔치기 어렵다. `SameSite=Lax` → 다른 사이트에서 오는 POST에 쿠키가 실리지 않는다(CSRF 1차 방어). URL에 세션 ID를 붙이지 않는다(`tracking-modes: cookie`).
세션 ID는 Spring Session이 만드는 UUID(122비트 난수). **유휴 만료** `SESSION_IDLE_MINUTES`(30분): 요청이 올 때마다 Redis TTL이 연장됩니다. 저장소는 `repository-type: default`(세션당 HASH 하나 + TTL, Redis 키스페이스 알림 불필요).

**로그인 시 세션 ID 재발급**(`request.changeSessionId()`): 공격자가 미리 심어 둔 세션 ID로 피해자가 로그인하게 만드는 **세션 고정 공격**을 막습니다. 옛 ID의 Redis 키는 사라집니다(통합 테스트 4번). **로그아웃**은 `session.invalidate()` → Redis에서 세션 삭제 + 쿠키 만료.

**JWT와의 비교 — 왜 JWT가 아닌가**

| | JWT(무상태 토큰) | Redis 세션 |
|---|---|---|
| 즉시 무효화(로그아웃·잠금·강제 만료) | 어렵다(만료까지 유효, 막으려면 결국 서버에 차단 목록 = 상태) | `DEL` 한 번 |
| 브라우저 보관 | `localStorage`면 XSS에 노출, 쿠키면 결국 CSRF 대책 필요 | `HttpOnly` 쿠키(스크립트 접근 불가) |
| 토큰 크기 | 요청마다 수백 바이트~수 KB | 세션 ID만 |
| 서버 저장소 | 없음(이 점이 장점) | Redis 필요 — 이미 있음 |

이 서비스는 이미 Redis가 필수이고 브라우저 하나가 같은 출처로만 부르므로, JWT의 장점(저장소 없음, 다른 서비스로 위임)이 거의 없고 단점(무효화·보관)만 남습니다.

**CSRF — 동기화 토큰 방식(`CsrfFilter`)**: 쿠키 인증은 브라우저가 쿠키를 자동으로 실어 보내므로, 다른 사이트가 사용자의 브라우저를 시켜 요청을 보낼 수 있습니다.
- `GET`·`HEAD`(·CORS 사전요청 `OPTIONS`) 외 모든 `/api` 요청은 헤더 `X-CSRF-Token`이 **세션에 저장된 값과 같아야** 합니다(상수 시간 비교). 다르거나 없으면 `403 CSRF_INVALID`.
- 토큰(256비트 난수)은 **응답 body**(`GET /api/auth/me`, 가입·로그인 응답의 `csrfToken`)로만 줍니다. 다른 출처의 페이지는 이 응답을 읽을 수 없으므로 헤더를 만들 수 없습니다.
- **로그인 전에도** 익명 세션에 토큰을 발급해 가입·로그인 요청도 보호합니다(로그인 CSRF 방지). **로그인 성공 시 새 토큰**을 발급합니다.
- `SameSite=Lax`와 함께 이중 방어입니다.

**비밀번호**: BCrypt **cost 12**(`spring-security-crypto`). 8~72자, 그리고 **72바이트 초과는 거부**합니다(BCrypt는 72바이트 뒤를 버리므로, 한글 25자 이상이면 앞 24자만 같아도 로그인되는 문제를 막음). 원문·해시는 로그와 응답에 남기지 않습니다.

**로그인 실패**: "이메일 없음"과 "비밀번호 틀림"을 같은 `401 INVALID_CREDENTIALS`·같은 문구로, **없는 계정에도 더미 BCrypt 해시와 비교**해 응답 시간도 비슷하게 맞춥니다(가입 여부를 알아내는 계정 열거 방지). **계정당 연속 5회 실패 → 15분 잠금**(Redis `auth:fail:*`, 인스턴스가 여러 개여도 합산) → `429 ACCOUNT_LOCKED` + `Retry-After`. 잠긴 동안은 맞는 비밀번호도 거부, 성공하면 초기화. 없는 이메일에도 같은 잠금이 적용됩니다. IP 단위로는 strict 버킷(분당 30)이 따로 막습니다.

**가입**: 이메일은 trim + 소문자로 정규화해 저장하고 `users.email`에 **유니크 제약**(`utf8mb4_bin`, 악센트를 같은 글자로 합치지 않게). 동시에 같은 이메일로 가입해도 DB가 하나만 받아들이고 나머지는 `409 EMAIL_TAKEN`. 가입과 동시에 로그인(세션 ID·CSRF 토큰 재발급).

**왜 Spring Security 전체를 쓰지 않았나**: 필요한 것은 ① BCrypt ② 세션에서 사용자 id 확인 ③ CSRF 토큰 검증 세 가지뿐입니다. Spring Security 전체를 넣으면 기본 로그인 페이지·HTTP Basic·자체 오류 응답·자체 CSRF 저장소·필터 15개 안팎을 각각 끄거나 계약의 `ApiError` 형식·경로에 맞게 다시 설정해야 하고, 기존 필터(요청 ID·요청 제한·body 제한)와의 순서도 다시 맞춰야 합니다. 그래서 **BCrypt만 `spring-security-crypto`(검증된 구현)로 가져오고**, 세션·CSRF는 각각 50줄 남짓의 작은 클래스(`SessionAuth`, `CsrfFilter`)로 직접 만들어 테스트로 고정했습니다. 의존성 증가는 압축 기준 약 0.3MB입니다. 권한(역할)·OAuth·비밀번호 찾기 같은 기능이 생기면 그때 Spring Security로 옮기는 편이 맞습니다.

### 5-3. 서버는 상태가 없다 — 대기열·선점은 Redis + Lua, 스케줄러 없음
- 세션·대기열·선점·멱등키·로그인 실패 횟수는 전부 Redis에 있습니다. 서버 메모리에 사용자 상태가 없으므로 **복제본을 몇 개로 늘려도 동작이 같습니다**.
- 만료 정리·승격 같은 "시간이 흐르며 바뀌는 상태"를 **주기 작업 없이**, 요청이 들어올 때 Lua 스크립트가 원자적으로 전진시킵니다. **왜?** 스케줄러는 복제본마다 돌면 중복 실행되고, 하나만 돌리려면 리더 선출이 필요합니다.
- 시각은 Lua 안에서 **Redis `TIME`**을 씁니다 → 복제본마다 시계가 조금씩 달라도 만료 판단이 한 시계로 통일됩니다.

### 5-4. 접속 대기열 (회차 단위)

```
POST /queue/enter ──► (로그인 확인) 같은 사용자의 이전 토큰 반납 → [Lua enter] ① 상태 전진 ② 빈자리면 ADMITTED, 없으면 WAITING
GET  /queue/status ─► [Lua poll]   ① 내 폴링 시각 갱신(TTL 넘겼으면 제외) ② 상태 전진 ③ 내 상태·앞사람 수 (토큰 주인 ≠ 나 → 401)
DELETE /queue ──────► [Lua leave]  토큰 삭제 + 선점 해제 + 상태 전진(다음 대기자 즉시 승격). 남의 토큰은 무시
예매 완료 ───────────► [Lua leave]  입장 권한 반납

상태 전진(advance) = 만료된 입장자 정리 → 폴링 끊긴 대기자 제거 → 빈자리만큼 대기 순번대로 승격
```

- 좌석 조회·선점·확정 때는 **서버가** "로그인한 사용자 = 토큰 주인"이고 `ADMITTED`인지 확인합니다(`queue-peek.lua`).
- **v3: 토큰은 사용자에게 묶인다.** 다른 계정이 토큰을 손에 넣어도 401. **한 사용자는 회차당 토큰 1개** — 다시 진입하면 이전 토큰과 그 선점은 반납되므로, 탭을 여러 개 열어 입장 자리를 여러 개 차지할 수 없습니다.
- 토큰: `SecureRandom` 256비트(base64url 43자), **헤더 `X-Queue-Token`으로만**, 로그·URL에 없음, Redis에는 **SHA-256**만 저장, 발급된 회차에만 유효.
- 권장 폴링 간격(`pollAfterSeconds`): 앞사람 10명 미만 2초, 100명 미만 3초, 그 이상 5초. 대기 TTL(30초)의 1/3을 넘지 않습니다.

### 5-5. 좌석 임시 선점 (초과 판매 방지)

```
POST /performances/:id/holds
 ├─ 서버: 로그인 + 내 토큰 + ADMITTED 확인 → 판매 기간 → 1~4석·중복 없음 → DB에서 이미 SOLD인 좌석이면 SEAT_TAKEN
 └─ [Lua hold-create]  (원자적)
      ① 이 토큰의 이전 선점이 그사이 바뀌지 않았는지 확인
      ② 요청 좌석 키가 전부 비었는지 확인 — 내 이전 선점이 잡은 좌석은 빈 것으로 봄
         하나라도 남의 것이면 아무것도 하지 않고 그 좌석 목록 반환 → 409 SEAT_TAKEN(details.seatIds)
      ③ 이전 선점 해제 → 새 좌석 키 SET PX(ttl) → hold 정보 저장(token·uid·perf·좌석·금액)
      ttl = min(HOLD_SECONDS, 입장 만료까지 남은 시간)
```

- **전부 아니면 전무**: Redis는 스크립트를 통째로 실행하므로 "모두 비었는지 확인 → 전부 SET"이 원자적입니다.
- **자동 해제**: 좌석 키와 hold 정보에 TTL을 걸어 Redis가 지웁니다. 정리 작업이 없습니다.
- **좌석 독점 방지**: 1회 최대 4석, 토큰당 선점 1건, 사용자당 회차 토큰 1개, TTL 고정·연장 API 없음, 선점 만료가 입장 만료를 넘지 않음, 회차당 계정 합산 4석.
- `holdId`는 128비트 난수. 해제·확정은 "hold의 토큰 = 요청 토큰, hold의 사용자 = 로그인한 사용자"일 때만 됩니다.

### 5-6. 예매 확정 — DB가 최종 방어선

```
POST /reservations (로그인, X-CSRF-Token, X-Queue-Token, Idempotency-Key, body { holdId })
 ├─ ① 멱등키 확인(먼저!) — 키는 "사용자:키"로 나눈다. 이미 완료된 키 → 처음 201 응답 그대로
 ├─ ② 내 토큰 + ADMITTED → hold가 내 토큰·내 계정·같은 회차인지 → 판매 기간 → 계정에서 이름·이메일
 ├─ ③ MySQL 트랜잭션(READ COMMITTED)
 │      SELECT … FROM users WHERE id = 나 FOR UPDATE   ← 같은 사용자의 확정을 한 줄로 세움
 │      이 회차의 내 확정 좌석 수 + 이번 좌석 수 > 4 → 롤백 → 409 BOOKING_LIMIT_EXCEEDED
 │      INSERT reservations(user_id, 이름, 이메일 해시·마스킹)
 │      UPDATE seats SET status='SOLD' ... WHERE id IN (...) AND status='AVAILABLE'
 │      └ 영향 행 수 ≠ 좌석 수 → 롤백 → 409 SEAT_TAKEN (선점도 해제)
 │      INSERT reservation_seats (좌석·가격 기록)
 └─ ④ 커밋 후: 선점 삭제 + 입장 권한 반납(다음 대기자 승격)
```

- **왜 DB에서 한 번 더?** Redis는 짧게 사는 상태라 틀리거나 비어 있을 수 있습니다. `WHERE status='AVAILABLE'`의 영향 행 수를 확인하면 **Redis가 틀려도 같은 좌석이 두 번 팔리지 않습니다**(통합 테스트가 Redis 선점 키를 강제로 지우고 증명).
- **왜 4석 제한을 트랜잭션 안에서?** 선점 단계에서 세면, 같은 사용자의 확정 두 건이 동시에 "아직 3석"을 보고 둘 다 통과할 수 있습니다. 사용자 행을 잠그고 같은 트랜잭션에서 세야 경쟁에서도 지켜집니다.
- **왜 멱등키를 사용자별로?** 다른 사람이 내 `Idempotency-Key`를 알아내 같은 키로 요청해도 내 예매 응답(이름·좌석)을 받아 갈 수 없게 합니다.
- **왜 멱등 확인이 맨 앞?** 확정이 끝나면 입장 권한을 반납하므로, 재전송이 토큰 확인부터 하면 401이 납니다.
- **실패는 멱등 저장하지 않음**: 4xx·5xx는 부작용이 없으므로 같은 키로 재시도할 수 있습니다(429는 필터에서 막혀 여기까지 오지 않음).
- **내 예매·취소**: `WHERE code = ? AND user_id = 나`로만 찾습니다 → 남의 예매번호는 "없음"과 똑같은 404(존재 여부가 드러나지 않음). 취소는 예매 행 잠금 → 상태 변경 → `UPDATE seats SET status='AVAILABLE', reservation_id=NULL`. 목록은 예매 1번 + 좌석 1번, 쿼리 2개로 끝냅니다.

### 5-7. 좌석 화면은 폴링되므로 가볍게
좌석 조회 1번 = **DB 쿼리 1번**(회차 좌석 전체의 판매 상태) + **Redis MGET 1번**(그 좌석들의 선점 키) + 회차·등급 메타 조회. 좌석 상태 = DB `SOLD` > Redis 선점(내 것 `MINE` / 남의 것 `HELD`) > `AVAILABLE`.

### 5-8. 보안
| 요구 | 구현 |
|---|---|
| 인증 | 세션(Redis) + BCrypt cost 12, 8~72자·72바이트 이하. 실패 응답·시간 구분 없음(더미 해시), 계정당 5회 → 15분 잠금 |
| 세션 | 쿠키 `HttpOnly; SameSite=Lax; Path=/`(+운영 `Secure`), URL 미사용, 로그인 시 ID 재발급, 로그아웃 시 Redis에서 삭제, 유휴 30분 |
| CSRF | 동기화 토큰 + 상수 시간 비교, 익명 세션에도 발급, 로그인 시 재발급 → `403 CSRF_INVALID` |
| 인가 | 예매 흐름 전체 로그인 필수(`401 UNAUTHENTICATED`). 토큰·선점·멱등키·예매가 사용자에게 묶임. 남의 예매는 같은 404 |
| 입력 검증 | Bean Validation(한국어 메시지) + Jackson `FAIL_ON_UNKNOWN_PROPERTIES`, 중복 키 거부, 타입 강제 변환 금지. `GET /shows`는 정의되지 않은 쿼리 파라미터도 거부, 검색어 40자. 오류 `details`에 필드별 메시지 |
| 검색 | `LIKE :pattern ESCAPE '\\'` — 바인딩 + `%`·`_`·`\` 이스케이프 |
| body 16KB | `Content-Length` 검사 + chunked는 읽는 중 초과 시 중단 → `413` |
| 대기열 토큰·선점 | 256/128비트 난수, 헤더로만, Redis엔 토큰 SHA-256만, 회차·사용자 한정 |
| 예매번호 | `SecureRandom` 12자, 0/O/1/I/L 제외 |
| 개인정보 | 예매 테이블에 이메일 원문 없음(해시 + 마스킹), 응답은 `ab***@example.com`. 이메일 원문은 로그인용 `users`에만. 로그에 이름·이메일·비밀번호·해시·세션 ID·CSRF 토큰·대기열 토큰·IP 없음(통합 테스트 로그로 확인) |
| 오류 응답 | 모든 오류를 `ApiError` 형태로. 5xx는 고정 문구 + `requestId` |
| 보안 헤더 | `nosniff`, `Cache-Control: no-store`, `X-Frame-Options: DENY`, `CSP: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer` |
| 요청 제한 | Redis 고정 창(1분), IP당 3개 버킷: general 120 / strict 30 / poll 240. 신뢰하는 사설 대역 프록시가 붙인 `X-Forwarded-For`만 반영 |
| DB 권한 | 서버는 `SELECT/INSERT/UPDATE`만, DDL은 migrate용 소유자 계정 |
| 저작권 | 시드의 공연명·출연진·장소는 모두 지어낸 것. 포스터는 `{seed, hue}` 값만 |
| 의존성 | Spring Boot BOM. starter 4개 + Spring Session Data Redis + spring-security-crypto + Flyway + MySQL 드라이버. Actuator·Spring Security 전체 미사용 |

### 5-9. 프로브와 종료, 마이그레이션 분리
- `/healthz`: 프로세스 생존만. `/readyz`: MySQL `SELECT 1` + Redis `PING` + 종료 중 아님. 프로브는 세션을 만들지 않습니다.
- `server.shutdown=graceful`: SIGTERM에 새 연결을 거절하고 진행 중 요청을 끝낸 뒤(최대 20초) 종료. 세션은 Redis에 있어 파드 교체로 로그아웃되지 않습니다.
- 서버는 Flyway를 돌리지 않습니다(복제본 경쟁 방지, 서버 계정에 DDL 권한 불필요). **v3부터 스키마 변경은 새 버전 파일로 쌓습니다**(`V1` → `V2`).
- 로그: Spring Boot 구조화 로깅(ECS JSON) 한 줄씩 stdout, 모든 줄에 `requestId`.

---

## 6. 이미지 최적화 — 단계별 기록

측정 조건: 같은 PC(Docker 29, WSL2), 컨테이너 `--memory 512m --cpus 1`.
"압축 크기"는 레지스트리로 push될 때의 크기(`docker image ls`의 CONTENT SIZE), "디스크"는 풀린 크기.

| 단계 (v1에서 측정) | 내용 | 압축 크기 | 디스크 | Spring 기동 | 기동 직후 메모리 |
|---|---|---|---|---|---|
| 0. 최적화 없음 | `maven:3.9-eclipse-temurin-21` 한 단계에서 빌드·실행(root, JDK+Maven+~/.m2 포함) | 366 MB | 1.08 GB | 7.2–8.7 s | ~200 MiB |
| 1. 멀티스테이지 + layered jar + 공식 JRE | `eclipse-temurin:21-jre-alpine`, non-root (`--target runtime-jre`) | 108 MB | 359 MB | 6.2–8.1 s | ~186 MiB |
| 2. + jlink 맞춤 JRE | alpine 3.22 + 필요한 모듈 17개만 담은 JRE | **85.8 MB** | 224 MB | 5.8–8.3 s | ~180 MiB |
| 3. + AppCDS (**최종**) | 빌드 때 학습 실행으로 클래스 아카이브 생성 | 99.8 MB | 292 MB | **3.6–4.1 s** | **~156 MiB** |

### 버전별 비교 (같은 시점, 같은 조건으로 번갈아 측정)

| | 압축 크기 | 디스크 | 의존성 레이어 | 앱 코드 레이어 | Spring 기동(1 CPU) |
|---|---|---|---|---|---|
| v1 | 99.8 MB | 292.2 MB | 38.0 MB | 119 KB | 3.8–6.8 s (중앙값 5.1) |
| v2 | 99.9 MB | 292.7 MB | 38.0 MB | 209 KB | 4.2–5.0 s (중앙값 4.5) |
| v3 | **100 MB** | 294 MB | 38.3 MB | 246 KB | 4.4–4.9 s (중앙값 4.7) |

v3에서 Spring Session·spring-security-crypto가 늘었지만 의존성 레이어는 +0.3MB, 기동 시간 차이는 측정 잡음 범위입니다(다른 작업이 같은 PC를 쓰는 중이라 v1 첫 측정 3.6–4.1 s보다 전반적으로 느림). 없는 계정용 더미 BCrypt 해시는 **기동 때가 아니라 처음 필요할 때** 만들어 기동 시간을 늘리지 않습니다(cost 12 해시 1회 ≈ 0.2~0.3초).

### 각 단계에서 한 일과 이유
1. **멀티스테이지**: 빌드 단계(JDK·Maven·소스·~/.m2)는 버리고 결과물만 최종 이미지로. 빌드 도구가 없으니 공격 표면도 줄어듭니다.
2. **의존성 레이어 캐시**: `pom.xml`·wrapper를 먼저 복사해 `dependency:go-offline` → 소스만 바뀌면 이 레이어를 재사용. BuildKit 캐시 마운트로 다운로드도 재사용.
3. **layered jar**: `java -Djarmode=tools -jar app.jar extract --layers`로 `dependencies(38MB) / spring-boot-loader / snapshot-dependencies / application(~250KB)` 순서로 복사. 코드만 바뀌면 마지막 작은 레이어만 새로 만들어집니다.
4. **jlink**: `jdeps --print-module-deps`로 실제 쓰는 모듈을 뽑고, TLS(EC 암호)와 JNDI를 더해 `--strip-debug --no-man-pages --no-header-files --compress=zip-6`로 맞춤 JRE를 만듭니다.
5. **AppCDS**: `-XX:ArchiveClassesAtExit` + `-Dspring.context.exit=onRefresh`로 빌드 중 컨텍스트까지만 띄워(외부 접속 없음) 로드된 클래스를 `/app/app.jsa`에 저장, 실행 시 `-XX:SharedArchiveFile`로 매핑. 기동 약 2배 단축, 메모리 약 25MiB 감소. 대신 이미지가 압축 기준 14MB 커졌습니다.
6. **JVM 메모리**: `-XX:MaxRAMPercentage=75.0`(512MB → 힙 384MB), `-XX:+ExitOnOutOfMemoryError`, `-XX:-UsePerfData`(/tmp에 파일을 만들지 않음).

### 트레이드오프 (솔직한 기록)
- **CDS를 켜면 "코드만 바뀌면 작은 레이어만 push"가 약해집니다.** CDS 아카이브가 앱 코드 다음 레이어라 배포마다 약 14MB(압축)를 push합니다. HPA로 새 파드가 자주 뜨는 환경이라 **기동 시간을 우선**했습니다. push 크기가 더 중요하면 CDS `RUN` 한 줄과 `-XX:SharedArchiveFile`을 빼면 2단계(85.8MB)로 돌아갑니다.
- 최종 이미지는 alpine이라 `sh`·`busybox`가 남아 있습니다(디버깅 편의).

---

## 7. 프론트엔드가 알아둘 동작

- **세션 쿠키** `TKT_SESSION`(HttpOnly라 JS에서 안 보임). 같은 출처(`/api`)로 부르면 브라우저가 알아서 보냅니다. `fetch`는 기본값(`credentials: "same-origin"`)이면 됩니다.
- **CSRF 토큰(`csrfToken`)이 바뀌는 시점**: ① 앱 시작 시 `GET /api/auth/me`로 받음(익명이어도 줌) ② **가입·로그인 성공 응답에 새 토큰** → 반드시 교체 ③ **로그아웃 후**에는 세션이 사라지므로 `GET /api/auth/me`를 다시 불러 새 토큰을 받아야 함 ④ 세션 만료 후에도 같음. `GET`·`HEAD` 외 모든 `/api` 요청에 `X-CSRF-Token` 헤더(로그아웃·대기열 이탈·선점 해제·취소 포함).
- **세션 만료(유휴 30분) 시 응답**: 로그인 필요한 `GET`(내 예매·좌석 조회·대기 상태)은 **`401 UNAUTHENTICATED`**, 상태 변경 요청은 세션이 없어 토큰 비교가 먼저 실패하므로 **`403 CSRF_INVALID`**. 두 경우 모두 `GET /api/auth/me` → `user: null`이면 로그인 화면으로 보내면 됩니다(`csrfToken`도 새로 받음).
- **401 구분**: `UNAUTHENTICATED`(로그인 필요) / `QUEUE_TOKEN_INVALID`(대기열 토큰 없음·만료·이탈·다른 회차·다른 계정 → 예매하기부터 다시) / `INVALID_CREDENTIALS`(로그인 실패). **403**: `QUEUE_NOT_ADMITTED`(대기 화면으로) / `CSRF_INVALID`.
- **로그인 잠금**: `429 ACCOUNT_LOCKED` + `Retry-After`(초). 문구에 남은 분이 들어 있습니다. 같은 429라도 `RATE_LIMITED`(IP 요청 제한)와 `error.code`로 구분하세요.
- **가입 실패**: `409 EMAIL_TAKEN`, 입력 오류는 `400 VALIDATION_ERROR` + `details: [{field, message}]`(`email`·`password`·`name`). 비밀번호는 8~72자이고 **72바이트를 넘으면 거부**(한글이면 24자까지).
- **다시 진입하면 이전 토큰 무효**: 같은 회차에서 `POST /queue/enter`를 다시 부르면(다른 탭 포함) 이전 `queueToken`과 그 선점은 반납됩니다. 새로고침 때는 `sessionStorage`의 토큰을 재사용하세요.
- **예매 확정 body는 `{ holdId }`만**. 예전 `name`·`email`을 넣으면 정의되지 않은 필드라 400입니다. 응답의 `name`·`emailMasked`는 계정 정보입니다.
- **`BOOKING_LIMIT_EXCEEDED`**: `error.details = { alreadyBooked, remainingAllowance }`. 선점은 그대로 남아 있으니 좌석 수를 줄여 다시 선점하면 됩니다. (선점 단계에서는 이 제한을 검사하지 않습니다.)
- **내 예매**: `GET /api/me/reservations` → `{ reservations: Reservation[] }` 최근 순, 취소 건 포함. 취소는 `POST /api/me/reservations/:code/cancel`(body 없음, CSRF 헤더 필요).
- **요청 제한(IP당, 1분 고정 창)**
  | 버킷 | 대상 | 기본 한도 |
  |---|---|---|
  | poll | `GET /api/queue/status`, `GET /api/performances/:id/seats` | 240 |
  | strict | `POST /api/auth/signup`·`/login`, `POST /api/queue/enter`, `POST /api/performances/:id/holds`, `DELETE /api/holds/:id`, `POST /api/reservations`, `POST /api/me/reservations/:code/cancel` | 30 |
  | general | 그 밖의 `/api/*` (`/shows`, `/auth/me`, `/auth/logout`, `/me/reservations`, `DELETE /queue` 등) | 120 |
- **권장 폴링 간격**: 대기 화면은 `pollAfterSeconds`(2~5초, 30초 넘게 끊기면 대기열에서 빠짐), 좌석 화면 3~5초.
- **Idempotency-Key**: UUID 필수, 사용자별로 저장. 처음 201만 24시간 저장, 4xx·5xx는 저장하지 않습니다.
- **`GET /api/shows`**: 쿼리는 `genre`·`q`·`status`·`sort`만 허용, 그 밖(`_=` 등)은 400. 빈 `q=`는 조건 없음.
- **시각**: ISO 8601 UTC(`Z`), 초 미만이 0이면 생략될 수 있음 → `new Date()`로 파싱.
- **계약에 없는 보조 오류 코드**: `409 REQUEST_IN_PROGRESS`, `413 PAYLOAD_TOO_LARGE`, `404 NOT_FOUND`(없는 경로, 예: 옛 `/api/reservations/lookup`), `405 METHOD_NOT_ALLOWED`.

---

## 8. 알려진 한계

- Flyway 11.7(Spring Boot 3.5 BOM 고정)이 MySQL 8.4에 대해 "upgrade recommended" 경고를 남깁니다. 마이그레이션은 정상 적용됩니다.
- Lua 스크립트는 여러 키를 함께 다루므로 **Redis Cluster 모드에서는 동작하지 않습니다**. ElastiCache는 클러스터 모드 비활성으로 쓰세요.
- 세션 값은 Spring Session 기본(JDK 직렬화)으로 저장됩니다. 넣는 값이 `Long`·`String` 둘뿐이라 문제는 없지만, Redis에 쓰기 권한을 가진 쪽은 신뢰 범위 안에 있어야 합니다(Redis 비밀번호·네트워크 정책 필수).
- 쿠키 이름에 `__Host-` 접두사(도메인·경로 고정 강제)를 쓰지 않았습니다. 로컬 http에서는 `Secure` 없이 쓸 수 없기 때문입니다. 운영 https만 있다면 `__Host-TKT_SESSION`으로 바꾸는 것을 고려하세요.
- 로그인 잠금은 계정 단위라, 남의 이메일로 일부러 5번 틀려 15분 동안 잠그는 방해가 가능합니다(IP당 strict 30/분으로 완화). 더 강하게 하려면 IP+계정 조합이나 CAPTCHA가 필요합니다.
- 목록·상세는 요청마다 전체 좌석을 집계합니다(시드 기준 약 3,800석, 수 ms).
- 요청 제한은 고정 창이라 창 경계에서 순간적으로 최대 2배까지 허용될 수 있습니다. Redis 장애 시에는 제한을 건너뜁니다(fail-open). Redis가 죽으면 로그인·대기열·선점도 동작하지 않으므로 `/readyz`가 503이 됩니다.
- `DB_SSL_MODE=PREFERRED`는 암호화하되 인증서를 검증하지 않습니다. RDS에서 `VERIFY_IDENTITY`를 쓰려면 RDS CA를 트러스트스토어에 넣어야 합니다.
