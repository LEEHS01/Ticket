# 티켓 예매 API (backend) — next (계약 v4)

공연 찾기 → 회차 선택 → **로그인** → **접속 대기열** → **좌석 선택(임시 선점)** → 예매 확정 → **내 예매**(조회·취소)를 제공하는 **상태 없는** Spring Boot API입니다.
계약은 [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) 4장(v3) + [`../docs/next/API-v4.md`](../docs/next/API-v4.md)(v4에서 추가·변경된 것)입니다.

| 항목 | 선택 |
|---|---|
| 언어/프레임워크 | Java 21, Spring Boot 3.5.16 (Spring MVC + **가상 스레드**) |
| DB 접근 | Spring JDBC `JdbcClient` (JPA 미사용), Flyway |
| 로그인 세션 | **Spring Session JDBC → MySQL**(서버 메모리 세션 없음) + BCrypt(`spring-security-crypto`) + 자체 CSRF 필터 |
| 잃으면 안 되는 상태 | **MySQL**: 회원·공연·좌석 판매·예매 + **로그인 세션 + 로그인 실패 잠금** |
| 잃어도 되는 상태 | Redis 7 (Lettuce) + **Lua 스크립트**: 대기열, 좌석 선점, 요청 제한, 멱등키(+ 없는 이메일의 로그인 실패 횟수) |

### v3 → next에서 바뀐 것 (API 계약은 v3 그대로)
- 기준: **"잃으면 안 되는 것은 MySQL, 잃어도 되는 것은 Redis"**(`docs/next/PLAN.md` 2.1). 나중에 멀티 클라우드 DR로 갈 때 클라우드 사이에 복제할 저장소는 MySQL 하나이고, Redis는 클라우드마다 따로 두며 장애 전환 뒤에는 빈 상태로 시작한다.
- **로그인 세션 Redis → MySQL**(Spring Session JDBC, 5-2). 쿠키·만료·로그인 시 세션 ID 재발급·로그아웃·CSRF 동작은 같다.
- **로그인 실패 잠금 Redis → `users` 열**(`failed_login_count`, `failed_login_until`). 장애 전환이나 Redis 비우기로 잠금이 풀리지 않는다.
- **Redis가 비어도 안전**하고(중복 판매 없음, 로그인 유지, 대기자는 다시 줄 서기, 선점 중이던 사람은 `409 HOLD_EXPIRED`), **Redis가 죽어도** 둘러보기·로그인·내 예매는 동작하며 예매 진행만 `503 SERVICE_UNAVAILABLE`(5-10).
- `/readyz`는 **MySQL 기준**. Redis 상태는 본문의 `redis: "up" | "down"`으로만 알린다.
- 확정(`POST /reservations`)은 **선점이 없으면 먼저 `409 HOLD_EXPIRED`**로 답한다(예전에는 토큰 확인이 먼저라 Redis가 비면 401이었다).
- 컨트롤러는 `@CurrentUser long userId`로 사용자 id만 받는다. 인증 확인은 `SessionAuth` 한 곳(토큰 방식으로 바꿔도 컨트롤러는 그대로).
- 스키마: **`V3__db_sessions_and_login_lock.sql`**(V1·V2는 그대로). **서버 DB 계정에 로그인 세션 테이블 두 개(`SPRING_SESSION`, `SPRING_SESSION_ATTRIBUTES`)에만 `DELETE`가 필요**해졌다(로그아웃·만료 정리). 예매·좌석·회원 테이블에는 DELETE를 주지 않는다. 새 DB는 `docker/mysql-init/01-init.sh`·`local/init-db.sh`가 migrate 전에 준다(5-8 DB 권한). 기존 DB는 migrate 뒤 한 번: `GRANT DELETE ON ticketing.SPRING_SESSION TO 'ticketing_app'@'%'; GRANT DELETE ON ticketing.SPRING_SESSION_ATTRIBUTES TO 'ticketing_app'@'%';`(앞서 `GRANT DELETE ON ticketing.*`를 줬다면 `REVOKE DELETE ON ticketing.* FROM 'ticketing_app'@'%';` 먼저).
- 환경변수 추가: `REDIS_TIMEOUT_MS`(500), `SESSION_TOUCH_SECONDS`(60), `SESSION_CLEANUP_SECONDS`(300). 없어진 환경변수는 없다(`REDIS_*`는 대기열·선점용으로 그대로 필요).
| 빌드 | Maven Wrapper (`./mvnw`, Maven 3.9.16) |
| 이미지 | 멀티스테이지 → **alpine + jlink 맞춤 JRE + AppCDS**, non-root(UID 10001), 읽기 전용 루트 FS |

> 이 PC에는 JDK 21이 없으므로 **빌드·테스트·실행을 모두 Docker로** 합니다. 아래 명령은 PowerShell 기준입니다
> (Git Bash에서는 `/tmp` 같은 경로가 바뀌지 않도록 앞에 `MSYS_NO_PATHCONV=1`을 붙이세요).

### API v4 (`docs/next/API-v4.md`, v3에서 추가·변경된 것만)

| 엔드포인트 | 내용 | DB 문장 | 쓰는 인덱스 |
|---|---|---|---|
| `GET /api/banners` | 노출 기간(`starts_at ≤ 지금 < ends_at`, NULL은 제한 없음) 안의 배너를 `sort_order` 순으로 최대 6개 | 1 | `idx_banners_order` |
| `GET /api/notices?category&page&size` | 고정 먼저, 그다음 게시 시각 최신순(같으면 id 큰 순). 게시 시각이 지난 것만 | 2(개수 + 쪽) | `idx_notices_list` / `idx_notices_category` |
| `GET /api/notices/:id` | 본문(일반 텍스트 그대로, HTML로 해석하지 않음). 게시 전·없음 → `404 NOTICE_NOT_FOUND` | 1 | PK |
| `GET /api/rankings?genre&period` | 기간(`DAILY` 24시간·`WEEKLY` 7일(기본)·`ALL`) 안에 **확정된 예매의 좌석 수**(취소 제외)로 순위, 최대 20개. `share` = 같은 조건(장르·기간) 전체 판매 좌석에 대한 %(소수 첫째 자리, 반올림) | 4(판매 집계 + 목록용 공연·등급·회차 집계) | `idx_reservations_status_created(status, created_at, performance_id)` |
| `GET /api/performances/:id/layout` | 좌석 배치 미리보기. **판매·선점 상태와 좌석 id를 담지 않는다**(쿼리가 `status`를 읽지 않음, Redis를 부르지 않음) → 대기열을 거치지 않고 볼 수 있다 | 3(회차, 등급, 좌석 칸) | PK / `uk_seats_position` |
| `GET /api/shows`, `/api/shows/:id` | `tagline`·`region`·`createdAt`(상세는 `venueInfo{name, region, seatCount}` = 회차 하나의 좌석 수) 추가. 목록에 `region=`(정확히 일치, 10자 이내) | v3와 같음 | `idx_shows_region` |
| `POST /api/reservations` | body `paymentMethod?: CARD｜EASY_PAY｜BANK_TRANSFER`(없거나 null이면 `CARD`). 정의되지 않은 값·소문자·숫자(`0`)·객체는 `400 VALIDATION_ERROR`. 응답·내 예매·취소 응답의 `Reservation`에 `paymentMethod` | v3와 같음 | — |

- 새 GET은 모두 로그인·토큰이 필요 없고 **MySQL만** 씁니다(Redis가 죽어도 동작). 요청 제한은 general 버킷(IP당 분당 120). 정의되지 않은 쿼리 파라미터는 `/api/shows`처럼 400입니다(`/api/banners`는 파라미터를 받지 않음). 응답 헤더(`Cache-Control: no-store` 등)는 v3와 같습니다.
- 결제는 모의 결제입니다. 고른 수단의 이름만 `reservations.payment_method`에 기록하고 결제 정보는 받지 않습니다. 같은 `Idempotency-Key` 재전송은 처음 응답(처음 고른 수단)을 그대로 돌려줍니다.
- 스키마 `V4__api_v4_content_ranking_payment.sql`: `shows.tagline VARCHAR(30)`·`shows.region VARCHAR(10)`(+`idx_shows_region`), `reservations.payment_method`(기본 `CARD`, CHECK 3종, 기존 예매는 `CARD`) + `idx_reservations_status_created`, 새 테이블 `banners`(slug 유니크, `show_id` FK, 노출 기간, `image_url`은 `/`로 시작하는 프론트 경로만 CHECK), `notices`(slug 유니크, 분류 CHECK, `show_id` FK NULL 가능).
- **시드**(재실행해도 slug 기준 upsert라 중복 없음, 문구는 모두 새로 씀):
  - 배너 6개: 공연 15, 4, 1, 6, 8, 12 순서. `imageUrl` = `/banners/banner-{showId}.webp`, `mobileImageUrl` = null, 노출은 그 공연의 마지막 회차 시작까지.
  - 공지 6건: 오픈 예정 공연(6·9·11)마다 `TICKET_OPEN` 1건(공연 연결, 오픈 일시 = 판매 시작 시각) + `SERVICE` 3건(대기열 이용 방법[고정], 결제 수단 안내, 로그인 제한 안내).
  - 공연 18개 모두 `tagline`(30자 이내)과 `region`. 지역은 가상 공연장마다 고정: **서울 7(누리 아트홀·별무리 라이브홀·온새미로 극장·나래 소극장), 경기 6(다온 아트센터 대극장·별빛 씨어터·하늘결 체임버홀), 대구 3(모퉁이 극장·미리내 콘서트홀), 부산 2(물결 야외극장·소금꽃 소극장)**.
  - 시드 예매 시각을 "판매 시작 ~ 지금"(최대 14일)에 흩어 놓아 기간별 랭킹이 달라집니다(공연마다 최근에 몰리는 정도가 다름). **새 DB에만 적용**됩니다(이미 좌석이 있는 회차에는 시드 예매를 새로 만들지 않으므로 기존 DB의 시드 예매는 모두 "그때의 지금" 시각이고, 기간별 결과가 비슷하게 나올 수 있음).
- v3의 `ShowSummary.rank`와 `GET /api/shows?sort=ranking`은 그대로(전체 기간 판매 기준)입니다.

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

- 먼저 `cp .env.example .env` 후 비밀번호 칸(`MYSQL_ROOT_PASSWORD`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `DB_PASSWORD`, `REDIS_PASSWORD`)을 채웁니다. `DB_PASSWORD`는 `DB_APP_PASSWORD`와 같은 값입니다. 저장소에는 비밀번호를 두지 않습니다.
- MySQL 8.4, Redis 7. 둘 다 healthcheck가 통과해야 `--wait`가 끝납니다.
- 처음 볼륨이 만들어질 때 `docker/mysql-init/01-init.sh`가 **앱 전용 최소 권한 계정**(`ticketing_app`)과 테스트 DB(`ticketing_test`)를 만듭니다.

### 1-2. 이미지 빌드

```powershell
docker build -t ticketing-backend .
```

### 1-3. 마이그레이션 + 시드 (서버와 분리된 실행 모드)

같은 이미지를 `migrate` 인자로 실행하면 **Flyway 마이그레이션 + 시드만 하고 종료**합니다(웹 서버를 띄우지 않음, Redis 불필요).
DDL 권한이 있는 소유자 계정(`ticketing`)으로 실행합니다. 여러 번 실행해도 안전합니다. 나중에 K8s에서는 **Job**으로 돌립니다.

```powershell
docker run --rm --read-only --tmpfs /tmp --network tkbe-dev_default `
  --env-file .env -e DB_USER=ticketing -e DB_PASSWORD=<.env의 DB_OWNER_PASSWORD> `
  -e SEED_DEMO_EMAIL=demo@example.com -e SEED_DEMO_PASSWORD=<시연용 비밀번호 8자 이상> `
  ticketing-backend migrate
```

로그 마지막 줄 예(새 DB): `마이그레이션·시드 완료: 공연 18개·회차 40개 upsert, 새 좌석 6082석, 새 시드 예매 517건, 시연 계정 생성·갱신` (두 번째부터는 0석·0건).
공연 12개였던 기존 DB에 돌리면 새 공연 6개분만 추가됩니다(실측: 새 좌석 2274석, 새 시드 예매 225건).

- **공연 id는 연속으로 매겨집니다**(포스터 파일 `frontend/public/posters/{id}.webp`와 맞추기 위해). 공연 upsert는 "slug로 조회 → 있으면 UPDATE, 없으면 INSERT"라 다시 돌려도 id(AUTO_INCREMENT)를 소모하지 않습니다.
  예전 방식(`INSERT … ON DUPLICATE KEY UPDATE`)은 갱신만 해도 id를 하나씩 소모해서, migrate를 세 번 돌린 DB는 다음 id가 49였습니다.
  이런 기존 DB를 위해 시드 시작 시 공연 테이블의 AUTO_INCREMENT가 `최대 id + 1`보다 크면 되돌립니다(로그: `공연 id 카운터를 49 → 13로 되돌림`). 새 공연은 반드시 `SHOWS` 목록 **맨 끝**에 붙입니다.

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
| CONCERT | 노을빛 재즈 쿼텟 〈밤 열한 시〉 (id 13) | 판매 중 |
| CONCERT | 겨울맞이 포크 콘서트 〈첫눈 오는 날〉 (id 14) | 판매 중 |
| MUSICAL | 뮤지컬 〈달빛 세탁소〉 (id 15) | 판매 중(4회차) |
| PLAY | 연극 〈버스는 여덟 시에 떠난다〉 (id 16) | 판매 중(첫 회차는 실행 당일 20:00) |
| CLASSIC | 첼로와 피아노의 밤 〈긴 겨울의 노래〉 (id 17) | 판매 중 |
| MUSICAL | 뮤지컬 〈고양이 우체부〉 (id 18) | 판매 중 |

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
- 복제본을 하나 더 띄우려면 이름·포트만 바꿔 같은 명령을 한 번 더 실행하세요(예: `tkbe-api-2`, `18081`). 세션이 MySQL에 있어 어느 쪽으로 요청해도 로그인이 유지됩니다(next).
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
| 서비스 단위 테스트 | `RankingAndV4FieldsTest`(v4), `ContentServiceTest`(v4), `SeedSpreadTest`(v4), `AuthServiceTest`, `SessionAndCsrfTest`, `ShowServiceTest`, `QueueServiceTest`, `SeatServiceTest`, `ReservationServiceTest`, `VenueLayoutTest`, `EmailPrivacyAndCodeTest` | `test` | 없음(가짜 저장소 주입) |
| HTTP 계층 테스트 | `ApiWebTest` (MockMvc, 세션은 MockHttpSession) | `test` | 없음 |
| 통합 테스트 | `it/V4ApiIT`(v4), `migrate/SeedV4IT`(v4), `it/RedisPauseIT`, `it/AuthSessionIT`, `it/RedisLossIT`, `it/RedisDownIT`, `it/SessionCleanupIT`, `it/SeatConcurrencyIT`, `it/QueueIT`, `migrate/SeedIdContinuityIT` | `verify` | 실제 MySQL·Redis (`RedisDownIT`는 `redis-server` 실행 파일도, 없으면 건너뜀) |

통합 테스트가 확인하는 것(실제 MySQL·Redis·Lua·HTTP):
1. **애플리케이션 인스턴스 2개**(같은 DB)를 띄우고, 인스턴스 1에서 받은 세션 쿠키를 인스턴스 2에 보내도 **로그인이 유지된다**. 세션은 `SPRING_SESSION` 1행 + 속성 2행(uid, csrf)이고 Redis에는 세션 키가 없다. 유휴 만료 1800초. 다른 인스턴스에서 로그아웃해도 세션 행과 속성 행이 지워진다.
2. **세션 쓰기 줄이기**: 60초 안의 연속 요청은 `LAST_ACCESS_TIME`을 바꾸지 않고, 마지막 접근이 2분 전이면 다음 요청이 한 번 갱신한다.
3. **요청당 DB 왕복**: 로그인한 `GET /api/queue/status` 한 번에 서버가 받은 문장 수 = **1**(세션 SELECT만. `SHOW GLOBAL STATUS LIKE 'Questions'` 차이로 측정).
4. **CSRF 토큰 없이**(또는 다른 값으로) 상태 변경 요청 → **403 `CSRF_INVALID`**. 세션 없이 로그인 요청도 403.
5. **로그인(가입) 전후로 세션 ID가 바뀌고**(옛 ID로는 찾을 수 없음) CSRF 토큰도 바뀐다. 쿠키는 `HttpOnly; SameSite=Lax; Path=/`.
6. A 계정의 예매를 B가 보거나 취소할 수 없다(404) / 같은 계정 3석 + 2석 → `409 BOOKING_LIMIT_EXCEEDED` / 한 인스턴스에서 선점 → 다른 인스턴스에서 확정 → 같은 멱등키 재전송은 같은 응답 → 취소 → 로그아웃 후 401.
7. 로그인 5회 연속 실패 → **429 `ACCOUNT_LOCKED` + `Retry-After`**(두 인스턴스로 나눠 실패해도 `users` 열에서 합산). 없는 이메일과 틀린 비밀번호의 응답이 같다.
8. **Redis를 통째로 비우면**(`RedisLossIT`, 장애 전환과 같은 상황): 로그인·CSRF 유지 / 선점 중이던 확정은 `409 HOLD_EXPIRED`, 좌석 조회는 `401 QUEUE_TOKEN_INVALID`, 다른 사람이 그 좌석을 사고 판매는 1건 / 팔린 좌석은 비운 뒤에도 `SEAT_TAKEN`, 옛 선점이 되살아나도(덤프 복원) DB가 두 번째 판매를 막음 / 대기자는 401 후 다시 진입 / 로그인 잠금은 유지, 잠금 시각이 지나면 풀리고 다음 실패는 1부터.
9. **Redis를 멈추면**(`RedisDownIT`, 테스트 전용 `redis-server`를 껐다 켬): 공연 목록·상세, `/auth/me`, 로그인(없는 이메일은 401), 가입, 내 예매 조회·취소, `/readyz`(redis: down) = 정상 / 대기열 진입·상태·이탈, 좌석, 선점, 확정 = `503 SERVICE_UNAVAILABLE` + `Retry-After: 5`, 응답에 내부 정보 없음, 실측 8ms / Redis를 다시 켜면 **서버 재시작 없이** 진입 200.
10. **만료 세션 정리를 두 서버가 동시에**(`SessionCleanupIT`, 5번 반복): 만료 1100개 + 유효 20개를 두 정리 작업이 같은 순간 시작 → 매번 만료 세션과 속성만 모두 지워지고 유효 세션은 남음. 5번 중 4번은 InnoDB가 한쪽을 교착으로 되돌렸고(외래 키 연쇄 삭제의 간격 잠금), 그 배치를 다시 시도해 끝까지 지웠다(재시도 각 1번).
11. (v2부터) 같은 좌석 동시 선점 50건 → 1건만 성공 / Redis 선점 키를 지운 뒤 두 계정이 같은 좌석 확정 → DB에서 1건만 / `QUEUE_MAX_ACTIVE=2`에서 5명 진입 → 완료·이탈마다 대기 1번 승격 / 입장 전 토큰 403, 남의 토큰 401.
12. **Redis가 잠시 멈췄다가 같은 데이터로 돌아오면**(`RedisPauseIT`, 전용 `redis-server`를 `SIGSTOP` 45초 → `SIGCONT`, 운영 기본 대기 TTL 30초): 대기자는 줄에 남고(순번 그대로), 입장자도 유지, 유예(30초)가 끝난 뒤 폴링을 멈춘 사람만 401. 약 90초 걸림.

**WSL(`ticketing` 배포판)에서 실행**(next에서 검증한 방법. JDK 21·MySQL 8.0·Redis 7이 배포판 안에 있다):

```bash
# 한 번만: 검증용 DB와 계정(기존 ticketing DB는 건드리지 않음). 비밀번호는 ~/.tkn-next.env(권한 600)에만
sudo mysql -e "CREATE DATABASE ticketing_next_test; CREATE USER 'tkn_owner'@'localhost' IDENTIFIED BY '<임의 값>'; GRANT ALL ON ticketing_next_test.* TO 'tkn_owner'@'localhost';"

cd /mnt/d/ticketing-next/backend
DB_HOST=127.0.0.1 DB_NAME=ticketing_next_test DB_USER=tkn_owner DB_PASSWORD='<임의 값>' \
REDIS_HOST=127.0.0.1 REDIS_DATABASE=2 ./mvnw -B verify
```

Docker로 실행할 때(v3 방식)는 `-e DB_NAME=ticketing_test … -e REDIS_DATABASE=1`을 주고 `maven:3.9-eclipse-temurin-21` 컨테이너에서 `./mvnw -B verify`를 돌립니다.
통합 테스트는 개발 데이터와 섞이지 않게 **별도 DB와 별도 Redis DB 번호**를 쓰고, 테스트마다 그 Redis DB만 비웁니다(`FLUSHDB`. 앱은 그 DB 하나만 쓰므로 앱 입장에서는 `FLUSHALL`과 같다).
단위 테스트의 대기열·선점 가짜 구현은 Lua와 같은 규칙을 흉내 낸 것이고, **Lua 자체의 동작은 통합 테스트가 실제 Redis로 검증**합니다. 단위 테스트의 BCrypt는 속도를 위해 cost 4입니다(운영 12).

---

## 3. 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `DB_HOST` | ✅ | — | MySQL 호스트 |
| `DB_PORT` | | `3306` | |
| `DB_NAME` | | `ticketing` | |
| `DB_USER` | ✅ | — | 서버: `ticketing_app`(SELECT/INSERT/UPDATE + **세션 테이블 두 개만 DELETE**, next), migrate: 소유자 계정 |
| `DB_PASSWORD` | ✅ | — | |
| `DB_SSL_MODE` | | `PREFERRED` | `DISABLED`·`PREFERRED`·`REQUIRED`·`VERIFY_CA`·`VERIFY_IDENTITY` |
| `DB_POOL_SIZE` | | `10` | Hikari 최대 연결 수(1~100) |
| `REDIS_HOST` | ✅ (서버) | — | 대기열·선점·멱등키·요청 제한용. migrate 모드에서는 쓰지 않음. 서버는 Redis가 없어도 뜨고 둘러보기·로그인은 동작 |
| `REDIS_PORT` | | `6379` | |
| `REDIS_PASSWORD` | | (없음) | |
| `REDIS_SSL` | | `false` | ElastiCache 전송 암호화 시 `true` |
| `REDIS_DATABASE` | | `0` | 0~15 |
| `REDIS_TIMEOUT_MS` | | `500` | **next** Redis 명령·연결 시간 초과(50~10000). 짧게 두어 Redis 장애 때 예매 진행 요청이 빨리 503으로 끝나게 한다 |
| `SESSION_IDLE_MINUTES` | | `30` | **v3** 요청이 없으면 이 시간(분) 뒤 세션 만료(1~1440) |
| `SESSION_TOUCH_SECONDS` | | `60` | **next** 세션의 마지막 접근 시각을 DB에 쓰는 최소 간격(0~600초). 0이면 요청마다 쓴다 |
| `SESSION_CLEANUP_SECONDS` | | `300` | **next** 만료 세션 정리 주기(10~86400초). 돌지 않아도 결과는 틀리지 않는다(5-2) |
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
   │  ├─ config/        AppProperties(환경변수 검증), JacksonConfig(엄격한 JSON), WebConfig(CORS·@CurrentUser), Clock,
   │  │                 RedisClientConfig(next: 짧은 시간 초과·끊기면 즉시 거절·빠른 재연결)
   │  ├─ web/           필터: 요청 ID·접근 로그 → 보안 헤더 → body 16KB → 요청 제한 → (Spring Session = MySQL) → CSRF
   │  ├─ common/        ErrorCode, ApiException(details·Retry-After), 전역 예외 처리(Redis 실패 → 503), /error 대체,
   │  │                 Transactions, RedisBackoff(Redis 없어도 되는 곳의 짧은 차단기)
   │  ├─ auth/          가입·로그인(AuthService), 세션 읽고 쓰기(SessionAuth), @CurrentUser, CsrfFilter, 사용자 저장소(잠금 열 포함),
   │  │                 next: SessionConfig(Spring Session JDBC 조립), ThrottledSessionRepository(쓰기 줄이기),
   │  │                 SessionTransactions(조회는 트랜잭션 없이), SessionCleanup(만료 세션 정리, SKIP LOCKED)
   │  ├─ show/          공연 목록·상세: controller → service → repository(JDBC), 상태 규칙(SaleStatus), v4 랭킹(RankingController)
   │  ├─ content/       v4 배너·공지: controller → service → repository(JDBC)
   │  ├─ queue/         대기열: QueueService → QueueStore(Redis Lua), 토큰 생성, Redis 키 이름
   │  ├─ seat/          좌석 화면·선점: SeatService → SeatRepository(JDBC) + HoldStore(Redis Lua)
   │  ├─ reservation/   확정·내 예매·취소, 멱등 저장소(Redis), 예매번호, 이메일 해시·마스킹
   │  ├─ ratelimit/     Redis 고정 창 카운터
   │  ├─ health/        /healthz, /readyz
   │  └─ migrate/       시드·공연장 배치 템플릿(migrate 프로필에서만 로드), v4 문구(ContentSeed: 한 줄 소개·지역·배너·공지)
   ├─ main/resources/
   │  ├─ application.yml, application-migrate.yml
   │  ├─ db/migration/V1__init.sql, V2__users_and_reservation_owner.sql, V3__db_sessions_and_login_lock.sql, V4__api_v4_content_ranking_payment.sql (Flyway)
   │  └─ redis/*.lua    queue-common/enter/poll/peek/leave, hold-create/release, login-failure(없는 이메일만), rate-limit
   └─ test/java/com/ticketing/
      ├─ support/       InMemoryStore(가짜 저장소), TestApp(서비스 조립)
      ├─ auth/, show/, queue/, seat/, reservation/, migrate/, web/   단위·HTTP 테스트
      └─ it/            실제 MySQL·Redis 통합 테스트(*IT). AuthSessionIT는 앱 인스턴스 2개,
                        RedisLossIT(Redis 비우기), RedisDownIT(전용 redis-server를 껐다 켬), SessionCleanupIT(동시 정리)
```

### 데이터 모델

```
users ─────────────────────────────┐ (email 유니크, password_hash=BCrypt, login_enabled,
                                    │  next: failed_login_count, failed_login_until = 로그인 잠금)
shows ─┬─ grades (show_id, code, price)                     │
       └─ performances ─── seats (status AVAILABLE|SOLD, reservation_id)
                              │                             │
reservations (user_id ◄──────┼─────────────────────────────┘) ── reservation_seats (예매 당시 좌석·가격)

SPRING_SESSION (세션 1행: SESSION_ID 유니크, 시각은 epoch ms) ── SPRING_SESSION_ATTRIBUTES (속성마다 1행: uid, csrf. ON DELETE CASCADE)
```

### MySQL에 둔 짧게 사는 상태 (next)

| 테이블·열 | 내용 | 인덱스 | 수명·정리 |
|---|---|---|---|
| `SPRING_SESSION` | 세션 1행: `PRIMARY_ID`(내부 키), `SESSION_ID`(쿠키 값, 로그인 때 재발급), 생성·마지막 접근 시각, `MAX_INACTIVE_INTERVAL`(1800초), `EXPIRY_TIME` | PK, `IX1(SESSION_ID)` 유니크 — 요청마다 이것으로 찾음, `IX2(EXPIRY_TIME)` — 정리, `IX3(PRINCIPAL_NAME)` — 호환용(안 씀) | 유휴 30분. 만료 행은 읽을 때 무효 처리 + `SessionCleanup`이 5분마다 정리 |
| `SPRING_SESSION_ATTRIBUTES` | 속성 1행씩: `uid`(Long), `csrf`(String), JDK 직렬화 BLOB | PK(`SESSION_PRIMARY_ID`, `ATTRIBUTE_NAME`) | 세션과 함께 삭제(CASCADE) |
| `users.failed_login_count`, `users.failed_login_until` | 연속 로그인 실패 횟수와 "이 시각까지 기억"(실패마다 지금+15분). 횟수 ≥ 5면 그 시각이 잠금 해제 시각 | PK(id), `uk_users_email` — 로그인 때 이미 읽는 행 | 시각이 지나면 0으로 본다(정리 작업 없음). 로그인 성공 시 0 |

### Redis 키 (next: 전부 "잃어도 되는 상태". 세션 키 `ticketing:session:*`는 더 이상 없다)

| 키 | 타입 | 내용 | 수명 |
|---|---|---|---|
| `auth:fail:{SHA-256(이메일)}` | STRING | **없는 이메일**의 연속 로그인 실패 횟수(5 이상이면 429). next: 있는 계정은 `users` 열 | 마지막 실패로부터 15분 |
| `queue:{회차}:waiting` | ZSET | 대기자(점수 = 진입 순번) | — |
| `queue:{회차}:seen` | ZSET | 대기자의 마지막 폴링 시각(ms) | — |
| `queue:{회차}:active` | ZSET | 입장자(점수 = 입장 만료 ms) | — |
| `queue:{회차}:seq` | STRING | 진입 순번 카운터 | — |
| `queue:{회차}:tick` | STRING | **next** 이 회차의 대기열 스크립트가 마지막으로 돈 Redis 시각(ms). 공백이 대기 TTL/2보다 길면 Redis가 멈춰 있었다고 봄 | — |
| `queue:{회차}:grace` | STRING | **next** 있으면 장애 유예 중(폴링 끊김으로 대기자를 빼지 않음) | 대기 TTL(30초) |
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

### 5-2. 로그인과 세션 (next: MySQL)

**세션은 MySQL에 둔다(Spring Session JDBC).** 브라우저에는 세션 ID만 쿠키 `TKT_SESSION`으로 주고, 세션 내용(로그인한 사용자 id, CSRF 토큰)은 `SPRING_SESSION`(1행) + `SPRING_SESSION_ATTRIBUTES`(속성마다 1행)에 있습니다.
**왜 Redis에서 옮겼나**: 나중에 멀티 클라우드 DR로 넘어갈 때 클라우드 사이에 복제하는 저장소는 MySQL 하나이고 Redis는 빈 상태로 시작합니다. 세션이 Redis에 있으면 장애 전환·Redis 재시작마다 **전원 로그아웃**됩니다. 로그인은 "잃으면 안 되는 상태"로 분류했습니다(`docs/next/PLAN.md` 3장).

| | 서버 메모리 세션(기본 Tomcat) | Redis 세션(v3) | **MySQL 세션(next)** |
|---|---|---|---|
| 파드가 여러 개 | **스티키 세션** 필요 | 어느 파드로 가도 같음 | 어느 파드로 가도 같음 |
| 파드 재시작·롤링 업데이트 | 그 파드 사용자 **로그아웃** | 영향 없음 | 영향 없음 |
| Redis 재시작·비우기·장애 전환 | — | **전원 로그아웃** | **영향 없음**(복제 지연만큼의 최근 로그인만 다시) |
| 로그아웃·강제 만료 | 그 파드에서만 | `DEL` → 즉시 전체 무효 | `DELETE` → 즉시 전체 무효 |
| 요청당 비용 | 메모리 | Redis 왕복 1~2번 | **MySQL SELECT 1번**(+ 1분에 1번 UPDATE) |

실측: 앱 인스턴스 2개(통합 테스트) / WSL 서버 2개(curl)에서 한쪽에서 가입·로그인하고 다른 쪽에서 인증·확정·로그아웃이 됐고, Redis DB를 `FLUSHDB`한 직후에도 양쪽에서 로그인이 유지됐으며, 서버를 재시작해도 같은 쿠키로 로그인 상태였습니다.

**쿠키**(v3와 같음): `TKT_SESSION=<세션 ID(base64)>; Path=/; HttpOnly; SameSite=Lax` + 운영은 `Secure`(`SESSION_COOKIE_SECURE`).
`HttpOnly` → 자바스크립트가 읽을 수 없어 XSS로 세션을 훔치기 어렵다. `SameSite=Lax` → 다른 사이트에서 오는 POST에 쿠키가 실리지 않는다(CSRF 1차 방어). URL에 세션 ID를 붙이지 않는다(`tracking-modes: cookie`).
세션 ID는 Spring Session이 만드는 UUID(122비트 난수). **유휴 만료** `SESSION_IDLE_MINUTES`(30분).

**로그인 시 세션 ID 재발급**(`request.changeSessionId()` → `UPDATE SPRING_SESSION SET SESSION_ID = 새 값`): 세션 고정 공격을 막습니다. 옛 ID로는 더 찾을 수 없습니다(통합 테스트 5번). **로그아웃**은 `session.invalidate()` → 세션 행 삭제(속성은 `ON DELETE CASCADE`) + 쿠키 만료.

**인증 확인은 한 곳**: 컨트롤러는 `@CurrentUser long userId` 인자로 사용자 id만 받고, 값은 `CurrentUserResolver` → `SessionAuth.requireUserId()`가 채웁니다(없으면 401). 나중에 세션 대신 토큰 방식으로 바꿔도 `SessionAuth`만 바뀌고 컨트롤러·서비스는 그대로입니다. 입력 검증(400)이 먼저 보이도록 이 인자는 `@RequestBody` 뒤에 둡니다(v3와 같은 오류 우선순위).

**세션 테이블 쓰기·읽기 줄이기**(`auth/SessionConfig.java`에서 직접 조립):

| 손댄 곳 | 기본 Spring Session JDBC | 이 프로젝트 | 효과 |
|---|---|---|---|
| 마지막 접근 시각 | 요청마다 `UPDATE` | `SESSION_TOUCH_SECONDS`(60초)보다 자주 쓰지 않음(`ThrottledSessionRepository`) | 폴링(2~5초)마다 하던 UPDATE가 1분에 1번 |
| 저장 시점·대상 | — | `FlushMode.ON_SAVE`(요청 끝에 한 번), `SaveMode.ON_SET_ATTRIBUTE`(값을 바꿀 때만) | 바뀐 것이 없으면 SQL 0개 |
| 조회의 트랜잭션 | `BEGIN`(autocommit 끄기)·`SELECT`·`COMMIT`·autocommit 켜기 = 왕복 4번 | 조회는 트랜잭션 없이 `SELECT` 1문장(`SessionTransactions`). 쓰기만 트랜잭션(READ COMMITTED) | 왕복 4 → 1 |
| 같은 요청 안의 재조회 | Spring Session 필터가 응답 커밋 때와 필터 끝에 두 번 커밋하면서 세션을 **다시 SELECT**(실측 요청당 2번) | 요청 단위 캐시(`SessionLookupCache`, 요청이 끝나면 버림) | SELECT 2 → 1 |

대가: 유휴 만료가 최대 60초 일찍 올 수 있습니다(마지막 기록 시각 기준으로 30분). 세션 시각(`LAST_ACCESS_TIME`·`EXPIRY_TIME`)은 Spring Session이 **앱 서버 시계**로 씁니다. 서버 간 시계 차이(NTP 기준 수 ms~수 초)는 30분 유휴 만료에 비해 무시할 만해 DB 시계로 바꾸지 않았습니다(로그인 잠금처럼 짧고 보안에 직접 쓰이는 시각은 DB 시계, 아래).

**만료 세션 정리 — 돌지 않아도 틀리지 않고, 여러 서버가 동시에 돌려도 안전**(`SessionCleanup`):
- 정합성은 정리 작업에 기대지 않습니다. 만료된 세션은 읽을 때 Spring Session이 만료로 판단해 지우고 새 세션으로 처리합니다. 정리는 테이블이 커지지 않게 하는 청소입니다(Spring Session 자체 정리 작업은 끔).
- 모든 서버가 `SESSION_CLEANUP_SECONDS`(5분)마다 돌립니다. 한 번에 500행씩 `SELECT … WHERE EXPIRY_TIME < (DB 시각) ORDER BY EXPIRY_TIME LIMIT 500 FOR UPDATE SKIP LOCKED` → 그 행만 `DELETE`. 다른 서버가 잡은 행은 건너뛰므로 같은 행을 두고 기다리지 않고, READ COMMITTED라 부모 테이블에 범위 잠금이 없어 정리 중에도 새 세션 `INSERT`가 막히지 않습니다. **다만** 속성 테이블의 `ON DELETE CASCADE`는 READ COMMITTED에서도 외래 키용 간격 잠금을 쓰므로, 두 서버의 배치가 같은 순간 겹치면 InnoDB가 한쪽을 교착으로 되돌립니다(실측: 동시에 시작한 5번 중 4번). 되돌린 쪽은 아무것도 지우지 않았고 지우기는 멱등이라 **그 배치만 20~100ms 쉬었다가 다시 시도**합니다(최대 5번, 그래도 안 되면 다음 주기). 결과(만료 세션만 모두 삭제)는 매번 같았습니다(통합 테스트 10번). 운영에서는 서버마다 기동 시각이 달라 동시에 겹치는 일은 드뭅니다.

**JWT와의 비교 — 왜 JWT가 아닌가**

| | JWT(무상태 토큰) | DB 세션 |
|---|---|---|
| 즉시 무효화(로그아웃·잠금·강제 만료) | 어렵다(만료까지 유효, 막으려면 결국 서버에 차단 목록 = 상태) | `DELETE` 한 번 |
| 브라우저 보관 | `localStorage`면 XSS에 노출, 쿠키면 결국 CSRF 대책 필요 | `HttpOnly` 쿠키(스크립트 접근 불가) |
| 토큰 크기 | 요청마다 수백 바이트~수 KB | 세션 ID만 |
| 서버 저장소 | 없음(이 점이 장점) | MySQL(이미 있음). 요청당 SELECT 1번 |

브라우저 하나가 같은 출처로만 부르는 서비스라 JWT의 장점(저장소 없음, 다른 서비스로 위임)이 거의 없고 단점(무효화·보관)만 남습니다. 요청당 SELECT 1번이 부담이 되면 토큰 방식으로 바꿀 수 있게 인증 확인을 `SessionAuth` 한 곳에 모아 두었습니다.

**CSRF — 동기화 토큰 방식(`CsrfFilter`)**: 쿠키 인증은 브라우저가 쿠키를 자동으로 실어 보내므로, 다른 사이트가 사용자의 브라우저를 시켜 요청을 보낼 수 있습니다.
- `GET`·`HEAD`(·CORS 사전요청 `OPTIONS`) 외 모든 `/api` 요청은 헤더 `X-CSRF-Token`이 **세션에 저장된 값과 같아야** 합니다(상수 시간 비교). 다르거나 없으면 `403 CSRF_INVALID`.
- 토큰(256비트 난수)은 **응답 body**(`GET /api/auth/me`, 가입·로그인 응답의 `csrfToken`)로만 줍니다. 다른 출처의 페이지는 이 응답을 읽을 수 없으므로 헤더를 만들 수 없습니다.
- **로그인 전에도** 익명 세션에 토큰을 발급해 가입·로그인 요청도 보호합니다(로그인 CSRF 방지). **로그인 성공 시 새 토큰**을 발급합니다.
- `SameSite=Lax`와 함께 이중 방어입니다.

**비밀번호**: BCrypt **cost 12**(`spring-security-crypto`). 8~72자, 그리고 **72바이트 초과는 거부**합니다(BCrypt는 72바이트 뒤를 버리므로, 한글 25자 이상이면 앞 24자만 같아도 로그인되는 문제를 막음). 원문·해시는 로그와 응답에 남기지 않습니다.

**로그인 실패**: "이메일 없음"과 "비밀번호 틀림"을 같은 `401 INVALID_CREDENTIALS`·같은 문구로, **없는 계정에도 더미 BCrypt 해시와 비교**해 응답 시간도 비슷하게 맞춥니다(가입 여부를 알아내는 계정 열거 방지). **계정당 연속 5회 실패 → 15분 잠금** → `429 ACCOUNT_LOCKED` + `Retry-After`. 잠긴 동안은 맞는 비밀번호도 거부, 성공하면 초기화.
next: 있는 계정의 잠금은 **`users.failed_login_count`·`failed_login_until`**(MySQL)에 있어 Redis를 비우거나 장애 전환해도 풀리지 않습니다. 실패 기록은 한 `UPDATE`로 원자적으로 하고(`기억 시각이 지났으면 1, 아니면 +1` + `기억 시각 = NOW(3) + 15분`, 같은 트랜잭션에서 다시 읽어 이번 횟수 확인), 잠금 판단은 로그인 때 어차피 읽는 사용자 행에서 DB 시계로 계산합니다(추가 쿼리 없음). 지난 기록을 지우는 작업은 없습니다(시각이 지나면 0으로 봄).
**없는 이메일**에도 같은 잠금이 적용되어야 잠금 여부로 가입 여부를 알 수 없으므로, 없는 이메일의 횟수는 지금처럼 Redis(`auth:fail:{SHA-256(이메일)}`)에 셉니다. 지킬 계정이 없으니 "잃어도 되는 상태"이고, Redis가 죽어 있으면 세지 않고 401만 줍니다(로그인 기능은 Redis 없이 동작). IP 단위로는 strict 버킷(분당 30)이 따로 막습니다.

**가입**: 이메일은 trim + 소문자로 정규화해 저장하고 `users.email`에 **유니크 제약**(`utf8mb4_bin`, 악센트를 같은 글자로 합치지 않게). 동시에 같은 이메일로 가입해도 DB가 하나만 받아들이고 나머지는 `409 EMAIL_TAKEN`. 가입과 동시에 로그인(세션 ID·CSRF 토큰 재발급).

**왜 Spring Security 전체를 쓰지 않았나**: 필요한 것은 ① BCrypt ② 세션에서 사용자 id 확인 ③ CSRF 토큰 검증 세 가지뿐입니다. Spring Security 전체를 넣으면 기본 로그인 페이지·HTTP Basic·자체 오류 응답·자체 CSRF 저장소·필터 15개 안팎을 각각 끄거나 계약의 `ApiError` 형식·경로에 맞게 다시 설정해야 하고, 기존 필터(요청 ID·요청 제한·body 제한)와의 순서도 다시 맞춰야 합니다. 그래서 **BCrypt만 `spring-security-crypto`(검증된 구현)로 가져오고**, 세션·CSRF는 각각 50줄 남짓의 작은 클래스(`SessionAuth`, `CsrfFilter`)로 직접 만들어 테스트로 고정했습니다. 의존성 증가는 압축 기준 약 0.3MB입니다. 권한(역할)·OAuth·비밀번호 찾기 같은 기능이 생기면 그때 Spring Security로 옮기는 편이 맞습니다.

### 5-3. 서버는 상태가 없다 — 상태는 "잃으면 안 되는 것"(MySQL)과 "잃어도 되는 것"(Redis)으로 나눈다

| 상태 | 저장소 | Redis를 비우면(장애 전환·재시작) | Redis가 죽어 있으면 |
|---|---|---|---|
| 회원, 공연·회차, 좌석 판매 여부, 예매 | MySQL | 영향 없음(기준 데이터) | 영향 없음 |
| **로그인 세션** | **MySQL** `SPRING_SESSION` | **유지**(다시 로그인할 필요 없음) | 로그인·가입·로그아웃·`/auth/me` 정상 |
| **로그인 실패 잠금**(있는 계정) | **MySQL** `users.failed_login_*` | **유지**(잠금이 풀리지 않음) | 정상 |
| 없는 이메일의 로그인 실패 횟수 | Redis `auth:fail:*` | 0부터 다시 셈(지킬 계정이 없음) | 세지 않고 401만(로그인 기능은 정상) |
| 접속 대기열(대기·입장) | Redis | 사라짐 → 상태 조회 `401 QUEUE_TOKEN_INVALID` → **다시 줄 서기** | 진입·상태·이탈 `503 SERVICE_UNAVAILABLE` |
| 좌석 임시 선점 | Redis | 사라짐 → 확정 `409 HOLD_EXPIRED` → **다시 좌석 고르기**. 판매된 좌석은 DB라 영향 없음 | 좌석 조회·선점·해제 `503` |
| 멱등키 | Redis | 사라짐. 선점도 함께 사라지므로 재전송은 `409 HOLD_EXPIRED` → **중복 예매 없음** | 확정 `503` |
| 요청 제한 카운터 | Redis | 한도가 0부터 다시 | **제한 없이 통과**(fail-open, 3초마다 다시 시도) |

- 서버 메모리에 사용자 상태가 없으므로 **복제본을 몇 개로 늘려도 동작이 같습니다**(요청 단위 세션 캐시는 요청이 끝나면 버림. `RedisBackoff`는 "Redis가 방금 실패했다"는 서버 상태일 뿐 사용자 상태가 아님).
- 대기열·선점의 "시간이 흐르며 바뀌는 상태"(만료 정리·승격)는 **주기 작업 없이**, 요청이 들어올 때 Lua 스크립트가 원자적으로 전진시킵니다. 시각은 Lua 안의 **Redis `TIME`**(Redis 하나의 시계). 로그인 잠금은 **MySQL `NOW(3)`**(DB 하나의 시계)로 판단합니다.
- 주기 작업은 만료 세션 청소(`SessionCleanup`) 하나이고, 돌지 않아도 결과가 틀리지 않습니다(5-2).

### 5-3-1. 요청별 DB 왕복 수와 쓰는 인덱스 (실측: performance_schema로 서버가 받은 문장을 셈)

| 경로 | 빈도 | MySQL 문장 | 쓰는 인덱스 | Redis |
|---|---|---|---|---|
| 모든 로그인 요청의 세션 확인 | 요청마다 | `SELECT` 세션 ⟕ 속성 **1번** (+ 60초에 1번 `UPDATE SPRING_SESSION` by PK) | `SPRING_SESSION_IX1(SESSION_ID)` 유니크 → PK `SPRING_SESSION_ATTRIBUTES(SESSION_PRIMARY_ID, …)` 접두 | — |
| 쿠키 없는 요청(둘러보기 첫 방문) | | 0번(세션을 찾지 않음) | | |
| `GET /api/queue/status`(대기 화면 폴링 2~5초) | 폴링 | **1번**(세션만. 통합 테스트로 고정) | 위와 같음 | Lua 1번 + 토큰 소유 확인 HMGET 1번 |
| `GET /api/performances/:id/seats`(좌석 화면 폴링 3~5초) | 폴링 | **4번**: 세션, 회차+공연, 좌석 전체, 등급 | IX1 / PK / `uk_seats_position(performance_id, …)` / PK `grades(show_id, code)` | 토큰 확인 2번 + 선점 MGET 1번 + 내 선점 1~2번 |
| `GET /api/auth/me` | 화면 진입 | 2번: 세션, 사용자 | IX1 / PK `users` | — |
| `GET /api/me/reservations` | | 2~3번: 세션, 예매, (예매가 있으면) 좌석 | IX1 / `idx_reservations_user_created` / PK `reservation_seats` | — |
| `POST /api/auth/login` | | 세션, 사용자(잠금 열 포함 1번), 성공 시 세션 ID 변경 `UPDATE` + 속성 `INSERT`/`UPDATE`(트랜잭션 1개). 실패 시 `UPDATE users` + `SELECT`(트랜잭션 1개) | IX1 / `uk_users_email` / PK | 없는 이메일만 `GET`·Lua 1번씩 |
| `POST /api/auth/logout` | | 세션, `DELETE SPRING_SESSION`(속성 CASCADE) | IX1 / PK | — |
| 만료 세션 정리 | 5분마다 × 서버 수 | 500행 배치마다 `SELECT … FOR UPDATE SKIP LOCKED` + `DELETE` | `SPRING_SESSION_IX2(EXPIRY_TIME)` 범위 + PK | — |

v3(세션 = Redis)와 비교하면, 로그인한 요청마다 **MySQL SELECT 1번이 늘었습니다**(대신 Redis 세션 조회가 빠짐). 대기 화면 폴링은 v3에서 MySQL 0번이었던 것이 1번이 됩니다. 부하는 폴링 간격(`pollAfterSeconds` 2~5초)으로 조절하고, 세션 조회는 유니크 인덱스 한 번 + 속성 2행이라 가볍습니다.

### 5-4. 접속 대기열 (회차 단위)

```
POST /queue/enter ──► (로그인 확인) 같은 사용자의 이전 토큰 반납 → [Lua enter] ① 상태 전진 ② 빈자리면 ADMITTED, 없으면 WAITING
GET  /queue/status ─► [Lua poll]   ① 내 폴링 시각 갱신(TTL 넘겼으면 제외) ② 상태 전진 ③ 내 상태·앞사람 수 (토큰 주인 ≠ 나 → 401)
DELETE /queue ──────► [Lua leave]  토큰 삭제 + 선점 해제 + 상태 전진(다음 대기자 즉시 승격). 남의 토큰은 무시
예매 완료 ───────────► [Lua leave]  입장 권한 반납

상태 전진(advance) = 만료된 입장자 정리 → 폴링 끊긴 대기자 제거(장애 유예 중이면 건너뜀, 5-10) → 빈자리만큼 대기 순번대로 승격
```

- 좌석 조회·선점·확정 때는 **서버가** "로그인한 사용자 = 토큰 주인"이고 `ADMITTED`인지 확인합니다(`queue-peek.lua`).
- **v3: 토큰은 사용자에게 묶인다.** 다른 계정이 토큰을 손에 넣어도 401. **한 사용자는 회차당 토큰 1개** — 다시 진입하면 이전 토큰과 그 선점은 반납되므로, 탭을 여러 개 열어 입장 자리를 여러 개 차지할 수 없습니다.
- 토큰: `SecureRandom` 256비트(base64url 43자), **헤더 `X-Queue-Token`으로만**, 로그·URL에 없음, Redis에는 **SHA-256**만 저장, 발급된 회차에만 유효.
- 권장 폴링 간격(`pollAfterSeconds`): 앞사람 10명 미만 2초, 100명 미만 3초, 그 이상 5초. 대기 TTL(30초)의 1/3을 넘지 않습니다.
- **상태 전진 한 번의 일에 상한**(next, 부하 테스트로 발견): 폴링이 끊긴 대기자는 한 번에 최대 500명(오래 끊긴 순)만 지우고, 승격도 한 번에 최대 500명입니다. 승격 후보 중 아직 지우지 못한 끊긴 대기자는 승격하지 않고 지웁니다(떠난 사람에게 입장 자리를 주지 않음). 예전에는 끊긴 대기자를 한 번에 전부 지워, 대기자 30만 명이 한꺼번에 끊기면 Lua 한 번에 **1.4초** 동안 Redis 전체가 멈췄습니다(그동안 다른 회차·선점·요청 제한까지 대기). 지금은 같은 상황에서 한 번에 **약 3.7ms**이고 나머지는 다음 요청들이 이어서 지웁니다. 그 사이 남은 끊긴 대기자는 다른 사람의 순번(앞 인원)에 잠시 더해져 보일 수 있습니다. 상한 때문에 빈자리와 대기자가 함께 남을 수 있어, **새 진입은 기다리는 사람이 없을 때만 바로 입장**합니다(새치기 없음). 수치: `docs/next/load-test.md`.

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
 ├─ ② hold가 있는지(없으면 409 HOLD_EXPIRED, next) → 내 토큰 + ADMITTED → hold가 내 토큰·내 계정·같은 회차인지 → 판매 기간 → 계정에서 이름·이메일
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
| 인증 | 세션(MySQL) + BCrypt cost 12, 8~72자·72바이트 이하. 실패 응답·시간 구분 없음(더미 해시), 계정당 5회 → 15분 잠금(`users` 열, DB 시계) |
| 세션 | 쿠키 `HttpOnly; SameSite=Lax; Path=/`(+운영 `Secure`), URL 미사용, 로그인 시 ID 재발급, 로그아웃 시 세션 행 삭제, 유휴 30분, 인증 확인은 `SessionAuth` 한 곳(`@CurrentUser`) |
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
| 요청 제한 | Redis 고정 창(1분), IP당 3개 버킷: general 120 / strict 30 / poll 240. 신뢰하는 사설 대역 프록시가 붙인 `X-Forwarded-For`만 반영. Redis 장애 때는 통과(fail-open, 5-10) |
| DB 권한 | 서버는 `SELECT/INSERT/UPDATE` + **`SPRING_SESSION`·`SPRING_SESSION_ATTRIBUTES`에만 `DELETE`**(next, 로그아웃·만료 정리). 예매·좌석·회원은 DELETE·DROP·ALTER 불가. DDL은 migrate용 소유자 계정. 테이블이 아직 없을 때(migrate 전) MySQL은 테이블 단위 GRANT를 `CREATE`와 함께일 때만 받으므로(`DELETE`만이면 ERROR 1146) 초기화 스크립트는 `GRANT DELETE, CREATE ON ticketing.SPRING_SESSION …`으로 준다. `CREATE`는 그 이름의 테이블을 만드는 권한뿐이다. 실측(새 DB): 초기화 → migrate → 가입·로그아웃·만료 세션 정리 권한 오류 0, 앱 계정의 `DELETE FROM reservations/seats/users`·`DROP`·`ALTER`는 ERROR 1142 |
| 저작권 | 시드의 공연명·출연진·장소는 모두 지어낸 것. 포스터는 `{seed, hue}` 값만 |
| 의존성 | Spring Boot BOM. starter 4개 + Spring Session JDBC(next) + spring-security-crypto + Flyway + MySQL 드라이버. Actuator·Spring Security 전체 미사용 |

### 5-9. 프로브와 종료, 마이그레이션 분리
- `/healthz`: 프로세스 생존만. `/readyz`: **MySQL `SELECT 1` + 종료 중 아님**으로 판단(200 `{"status":"ready","redis":"up"|"down"}` / 503 `{"status":"unavailable","redis":…}`). next: Redis는 판단에 넣지 않습니다 — Redis가 죽었다고 파드가 트래픽에서 빠지면 Redis 없이 되는 둘러보기·로그인·내 예매까지 함께 죽기 때문입니다. `redis` 항목은 참고용이고, 상태가 바뀔 때만 로그(WARN/INFO)를 남깁니다. 프로브는 세션을 만들지 않습니다.
- `server.shutdown=graceful`: SIGTERM에 새 연결을 거절하고 진행 중 요청을 끝낸 뒤(최대 20초) 종료. 세션은 MySQL에 있어 파드 교체로 로그아웃되지 않습니다.
- 서버는 Flyway를 돌리지 않습니다(복제본 경쟁 방지, 서버 계정에 DDL 권한 불필요). **v3부터 스키마 변경은 새 버전 파일로 쌓습니다**(`V1` → `V2`).
- 로그: Spring Boot 구조화 로깅(ECS JSON) 한 줄씩 stdout, 모든 줄에 `requestId`.


### 5-10. Redis가 비거나 죽었을 때 (next)

Redis는 **언제든 비어 있을 수 있다**는 전제로 만들었습니다(멀티 클라우드 DR에서는 다른 클라우드의 빈 Redis로 넘어감). 통합 테스트 8·9·12번이 이 표를 실제 MySQL·Redis로 확인합니다. "비워진 경우"(데이터 소실)와 "잠시 끊겼다 같은 데이터로 돌아온 경우"(데이터 유지)는 결과가 다릅니다.

| 상황 | 둘러보기(목록·상세) | 가입·로그인·로그아웃·`/auth/me` | 내 예매 조회·취소 | 대기열 | 좌석 조회·선점 | 예매 확정 | `/readyz` |
|---|---|---|---|---|---|---|---|
| **비워졌다 — 데이터 소실**(FLUSHALL, 저장 없이 재시작, 다른 클라우드의 빈 Redis로 전환) | 정상 | 정상, **로그인 유지**, 잠금 유지 | 정상 | 대기자: `401 QUEUE_TOKEN_INVALID` → 다시 진입하면 정상 | 옛 토큰 `401` → 다시 줄 서기. 팔린 좌석은 `409 SEAT_TAKEN` | 선점 중이던 사람: **`409 HOLD_EXPIRED`** → 좌석 다시 고르기. 중복 판매 없음(DB) | 200 |
| **끊겨 있는 동안**(연결 거부·응답 없음) | 정상 | 정상(없는 이메일 실패 횟수만 세지 못함) | 정상 | **`503 SERVICE_UNAVAILABLE`** + `Retry-After: 5` | `503` | `503`(멱등 확인이 먼저라 아무것도 쓰지 않음) | 200, `redis: "down"` |
| **빈 상태로 돌아왔다** | 정상 | 정상 | 정상 | 서버 재시작 없이 정상(빈 줄부터). 실측: 다시 켠 뒤 첫 시도부터 200 | 정상 | 정상 | 200, `redis: "up"` |
| **잠시 끊겼다 같은 데이터로 돌아왔다**(주 서버 → 대기 서버 자동 전환, 수십 초) | 정상 | 정상 | 정상 | **순번 유지**: 끊긴 시간이 대기 TTL(30초)보다 길어도 폴링 끊김으로 빠지지 않는다(장애 유예, 아래). 입장 권한(600초)의 만료 시각은 끊긴 동안에도 그대로 흘러, 그 사이 끝난 입장은 끝난다 | 선점(300초)도 만료 시각이 그대로 흐른다. 아직 안 끝났으면 그대로 선점 중, 끝났으면 다시 고르기 | 선점이 살아 있으면 정상, 끝났으면 `409 HOLD_EXPIRED`. 끊기기 직전 확정이 시간 초과로 `503`이었다면 같은 멱등키 재전송으로 처음 결과를 받는다 | 200 |

- **503 응답**: `{"error":{"code":"SERVICE_UNAVAILABLE","message":"예매 진행이 잠시 원활하지 않습니다. 잠시 후 다시 시도해 주세요.","requestId":…}}`. 스택·주소·예외 이름은 응답에 없고, 서버 로그에 한 줄(WARN, 예외 클래스 이름만)을 남깁니다. **계약 4.2에 없는 코드라 제안으로 보고**합니다.
- **오래 매달리지 않게**(`config/RedisClientConfig`): 명령·연결 시간 초과 `REDIS_TIMEOUT_MS`(500ms), 연결이 끊긴 동안의 명령은 쌓지 않고 **즉시 거절**(Lettuce `REJECT_COMMANDS`, 실측 503까지 8ms), 자동 재연결 간격 100ms~2초. 요청 제한과 없는 이메일의 로그인 실패 횟수는 한 번 실패하면 3초 동안 Redis를 부르지 않습니다(`RedisBackoff`).
- **장애 유예(대기열, 잠시 끊겼다 돌아온 경우)**: v3 설계는 "대기 중 폴링이 `QUEUE_WAIT_TTL_SECONDS`(30초) 끊기면 줄에서 뺀다"여서, Redis가 30초 넘게 멈췄다가 같은 데이터로 돌아오면 첫 상태 전진에서 **대기자 전원이 빠졌습니다**(실측: 45초 정지 뒤 대기자 `401`). 그동안은 Redis가 멈춰 아무도 폴링할 수 없었으므로 사용자 잘못이 아닙니다. 그래서 회차마다 "대기열 스크립트가 마지막으로 돈 Redis 시각"(`queue:{회차}:tick`)을 남기고, 다음 스크립트가 돌 때 그 공백이 **대기 TTL의 절반(15초)보다 길면** 멈춰 있었다고 보고 **지금부터 대기 TTL(30초) 동안 폴링 끊김 제외를 쉽니다**(`queue:{회차}:grace`, TTL 30초). 화면은 503이어도 5초마다 다시 묻기 때문에 돌아온 사람은 유예 안에 폴링을 이어 가고, 유예가 끝난 뒤에도 폴링하지 않은 사람(정말 떠난 사람)만 빠집니다. 정상 폴링 간격은 대기 TTL의 1/3 이하라, 공백이 TTL의 절반 이하인 짧은 장애로는 원래도 빠지는 사람이 없습니다. 판단은 모두 Redis 시각·Redis 키로 하므로 서버가 여러 대여도 같습니다. 대가: 유예 동안 정말 떠난 사람도 줄에 남아, 그 사이 차례가 오면 입장 자리를 입장 시간만큼 차지할 수 있습니다(이탈하지 않고 떠난 입장자와 같은 한계). 실측(`RedisPauseIT`, 대기 TTL 30초·45초 정지): 정지 중 상태 조회 503 8번 → 돌아온 직후 대기자 순번 0 그대로, 입장자도 입장 유지, 유예가 끝난 뒤 폴링을 멈춘 사람만 `401`.
- **확정 순서를 바꾼 이유**: v3는 토큰 확인이 먼저라 Redis가 비면 확정이 `401 QUEUE_TOKEN_INVALID`였습니다. 선점이 없으면 먼저 `409 HOLD_EXPIRED`로 답하게 바꿔, 화면이 "좌석 확보가 풀렸습니다 → 좌석 화면"으로 가고, 좌석 조회가 401을 받으면 그때 다시 줄을 서게 했습니다. 선점이 있으면 지금까지처럼 토큰을 확인합니다(남의 토큰 401, 대기 중 403).
- **중복 판매가 없는 이유**: 판매의 기준은 Redis가 아니라 MySQL `seats.status`이고, 확정은 `UPDATE … WHERE status='AVAILABLE'`의 영향 행 수로 검증합니다. Redis가 틀려 같은 좌석에 선점이 두 개 생겨도(테스트: 옛 선점을 덤프에서 복원) 두 번째 확정은 `409 SEAT_TAKEN`입니다.

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

- **next: 프론트 수정은 필요 없습니다**(계약 v3 그대로). 다만 다음 두 가지가 새로 나올 수 있습니다.
  - `503 SERVICE_UNAVAILABLE`(+ `Retry-After: 5`): Redis 장애로 예매 진행(대기열·좌석·선점·확정)만 잠시 안 될 때. 지금 화면은 5xx를 "다시 시도할 수 있는 오류"로 보여 주므로 그대로 동작합니다. 둘러보기·로그인·내 예매는 영향이 없습니다.
  - 장애 전환·Redis 재시작 직후 확정은 `409 HOLD_EXPIRED`(좌석 화면으로), 대기·좌석 화면은 `401 QUEUE_TOKEN_INVALID`(다시 줄 서기)가 됩니다. 로그인은 유지됩니다.
- **v4 세부(프론트가 알 것)**
  - **공지 페이지 번호**: `page`는 **1부터**(기본 1), `size` 기본 20·최대 50. `page`·`size`가 0 이하·숫자 아님·범위 밖이면 `400 VALIDATION_ERROR`(details의 field가 `page`·`size`·`category`). 마지막 쪽을 넘긴 `page`는 400이 아니라 **빈 `notices`와 실제 `totalPages`·`totalCount`**를 돌려줍니다.
  - **빈 결과 형태**: 공지가 없으면 `{ notices: [], page: 1, totalPages: 0, totalCount: 0 }`. 배너가 없으면 `{ banners: [] }`. 랭킹에 판매가 없으면 `{ rankedAt, period, items: [] }`.
  - **랭킹**: 그 기간·장르에 **판매가 0인 공연은 `items`에 없습니다**(순위·점유율 0으로 넣지 않음). 동률은 공연 id 오름차순이고 `rank`는 1부터 빈틈없이 매깁니다(동률도 다른 번호). `share`는 반올림 때문에 합이 정확히 100.0이 아닐 수 있고, 21위 이하가 잘리면 합이 100보다 작습니다. `items[].show`는 목록과 같은 `ShowSummary`이고 그 안의 `rank`는 v3 그대로 **전체 기간** 순위라 랭킹 화면의 `rank`와 다를 수 있습니다. `rankedAt`은 계산한 서버 시각입니다.
  - **좌석 배치**: `GET /api/performances/:id/layout`의 `seats[]`는 `{row, number, grade}`만 있고 좌석 `id`·상태가 없습니다(미리보기 전용. 선택은 대기열 입장 뒤 `/seats`로).
  - **`paymentMethod`**: 안 보내면 `CARD`. 대문자 이름만 받습니다(`"easy_pay"`는 400).
  - **`createdAt`**(공연 등록 시각)은 DB에 공연 행이 생긴 시각입니다. 시드 공연은 처음 migrate한 시각이라 모두 비슷합니다.
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
- 세션 값은 Spring Session 기본(JDK 직렬화 BLOB)으로 저장됩니다. 넣는 값이 `Long`·`String` 둘뿐이라 문제는 없지만, 세션 테이블에 쓰기 권한을 가진 쪽은 신뢰 범위 안에 있어야 합니다(앱 계정만 쓰기).
- next: 로그인한 요청마다 MySQL `SELECT` 1번이 듭니다(v3는 Redis). 대기 화면 폴링도 MySQL을 1번 씁니다. 동시 접속이 크게 늘면 MySQL 읽기 부하가 먼저 늘어나므로, 폴링 간격·읽기 복제본·토큰 방식 전환(인증 확인이 `SessionAuth` 한 곳이라 가능)을 검토합니다.
- next: 세션 유휴 만료는 마지막 접근 기록 간격(60초)만큼 일찍 올 수 있고, 세션 시각은 앱 서버 시계로 씁니다(로그인 잠금은 DB 시계).
- next: 장애 전환 때 MySQL 복제 지연만큼의 최근 세션(그 사이 로그인·세션 ID 재발급)은 없을 수 있습니다 → 그 사용자만 다시 로그인.
- 쿠키 이름에 `__Host-` 접두사(도메인·경로 고정 강제)를 쓰지 않았습니다. 로컬 http에서는 `Secure` 없이 쓸 수 없기 때문입니다. 운영 https만 있다면 `__Host-TKT_SESSION`으로 바꾸는 것을 고려하세요.
- 로그인 잠금은 계정 단위라, 남의 이메일로 일부러 5번 틀려 15분 동안 잠그는 방해가 가능합니다(IP당 strict 30/분으로 완화). 더 강하게 하려면 IP+계정 조합이나 CAPTCHA가 필요합니다.
- 목록·상세는 요청마다 전체 좌석을 집계합니다(시드 기준 약 6,100석, 수 ms).
- 요청 제한은 고정 창이라 창 경계에서 순간적으로 최대 2배까지 허용될 수 있습니다. Redis 장애 시에는 제한을 건너뜁니다(fail-open) → 그동안은 IP당 한도가 없으므로 앞단(로드밸런서·WAF)의 한도가 유일한 보호입니다. 예매 진행은 그동안 503이라 좌석 독점은 생기지 않습니다.
- next: Redis 주소가 응답 없이 막힌 경우(패킷 유실) 예매 진행 요청은 `REDIS_TIMEOUT_MS`(500ms)까지 기다린 뒤 503입니다. 요청 제한·없는 이메일 로그인은 한 번 실패하면 3초 동안 Redis를 부르지 않습니다. 이 경우는 통합 테스트로 재현하지 않았습니다(테스트는 Redis 프로세스를 끄는 경우).
- `DB_SSL_MODE=PREFERRED`는 암호화하되 인증서를 검증하지 않습니다. RDS에서 `VERIFY_IDENTITY`를 쓰려면 RDS CA를 트러스트스토어에 넣어야 합니다.
