# 티켓 예매 서비스 — 아키텍처 및 API 계약 (v3 + next)

> **next 변경 요약 (2026-11-24, 브랜치 `next`)**: 상태를 "잃으면 안 되는 것"과 "잃어도 되는 것"으로 나눴다(3.2.4).
> 로그인 세션과 로그인 실패 잠금을 Redis에서 **MySQL**로 옮겼다. 대기열·좌석 임시 선점·멱등키·요청 제한은 Redis에 남기되,
> Redis가 통째로 비워지거나 죽어도 안전하게 동작하도록 했다. `503 SERVICE_UNAVAILABLE`과 `/readyz`의 `redis` 항목이 생겼다.
> 새 화면용 API(배너, 공지, 랭킹, 좌석 배치 미리보기, 모의 결제 수단)는 `docs/next/API-v4.md`에 따로 적었다. 이 문서의 4장과 함께 본다.

> **v3 변경 요약 (v2 대비)**: 회원가입·로그인을 추가했다. 세션은 서버 메모리가 아니라 외부 저장소에 둔다(v3 당시 Redis, next부터 MySQL).
> 예매는 로그인한 사용자만 할 수 있고, 예매 내역은 "내 예매"에서 계정으로 찾는다.
> 예매번호+이메일로 조회·취소하던 비회원 엔드포인트(`/api/reservations/lookup`, `/cancel`)는 **없어진다**.
> 상세는 3.2.3, 3.4의 인증 항목, 4.1의 `User`·`AuthState`, 4.2의 "인증"과 "내 예매"를 본다.

이 문서는 백엔드·프론트엔드가 **서로의 코드를 보지 않고도** 개발할 수 있게 하는 단일 기준이다.
계약(4장)을 바꿔야 하면 임의로 바꾸지 말고 조율 세션에 먼저 알린다.

> v2 변경 요약: v1의 "공연 1개 = 일정 1개, 수량만 선택" 모델을 버리고
> **공연(Show) → 회차(Performance) → 좌석(Seat)** 모델로 바꿨다.
> 접속 대기열, 좌석 선택과 임시 선점, 장르·검색·랭킹·오픈 예정, 좌석 등급별 가격이 추가됐다.
> v1의 `/api/events` 엔드포인트는 없어진다.

## 1. 목표와 범위

- 실제 예매 사이트의 일반적인 흐름을 따르는 작은 서비스:
  **공연 찾기 → 상세에서 날짜·회차 선택 → 대기열 → 좌석 선택(임시 선점) → 예매자 정보 → 완료 → 조회·취소**
- 최종 목적은 EKS 배포 실습이다. 기능이 늘어도 **컨테이너에서 잘 도는 것**이 우선이다.
- 넣지 않는 것: 결제(예매 확정으로 대체), 쿠폰·할인, 배송, 관리자 화면, 리뷰, 소셜 로그인, 비밀번호 찾기(메일 발송 인프라가 없음), 비회원 예매.

### 1.1 참고한 실제 서비스의 공통 패턴 (기능과 흐름만)

공개 화면을 관찰해 얻은 일반적인 구성이다. 특정 사이트의 코드·이미지·문구·브랜드·배치는 가져오지 않는다.

| 화면 | 공통 기능 |
|---|---|
| 메인 | 장르 분류, 검색, 포스터 목록, 티켓 오픈 예정(오픈 일시·D-day), 판매 랭킹 |
| 공연 상세 | 포스터, 기간·장소, 관람 등급·관람 시간·출연, 좌석 등급별 가격, 달력에서 날짜 선택 → 회차 선택 → 등급별 잔여석, 유의사항(1인 4매 제한 등), 취소 안내 |
| 예매 | (트래픽이 몰리면) 대기 화면 → 좌석 배치도에서 등급별 색으로 좌석 선택 → 제한 시간 안에 예매자 정보 입력 → 완료 |
| 내 예매 | 예매번호로 확인·취소 |

## 2. 구성

```
[브라우저]
    │
[Ingress / (로컬은 gateway nginx)]
    ├─ /        → frontend : nginx가 정적 파일 서빙 (포트 8080)
    └─ /api/*   → backend  : Spring Boot API, 상태 없음 (포트 8080)
                    ├─ Redis 7  : 대기열, 좌석 임시 선점, 요청 제한, 멱등키 (잃어도 되는 상태)
                    └─ MySQL 8  : 회원·공연·회차·좌석·예매, 로그인 세션, 로그인 잠금 (기준 데이터)
```

| 구성요소 | 기술 | 선택 이유 |
|---|---|---|
| backend | Java 21 + Spring Boot 3 (Maven) | 수업(PetClinic·Maven 멀티스테이지)의 연장. layered jar·JRE 경량화·JVM 메모리 설정 등 컨테이너 최적화를 보여줄 수 있음 |
| frontend | React + Vite + TypeScript, nginx-unprivileged로 서빙 | 빌드 결과가 정적 파일이라 런타임 이미지가 매우 작음 |
| DB | MySQL 8 (운영: RDS) | 수업에서 다룬 DB, RDS 연계 |
| 캐시 | Redis 7 (운영: ElastiCache 또는 클러스터 내부) | 대기열·좌석 선점처럼 "짧게 살고 원자성이 필요하며 잃어도 다시 만들 수 있는 상태"를 담당. 클라우드 사이에 복제하지 않는다 |

## 3. 설계 원칙

### 3.1 백엔드 구조 — 계층형 + 의존성 주입

```
controller (HTTP·검증) → service (업무 규칙) → repository (MySQL/Redis 접근)
```

- 각 계층은 아래 계층의 **인터페이스**에만 의존한다. 생성자 주입만 쓴다(테스트 시 가짜 저장소 주입).
- DB 접근은 JPA 대신 Spring JDBC(`JdbcClient`)로 SQL을 직접 쓴다.
- 설정은 전부 환경변수(12-factor). 시작 시 검증하고, 빠지면 즉시 종료한다.
- **서버는 상태가 없다.** 대기열·선점·멱등키는 Redis에, 로그인 세션은 MySQL에 있으므로 복제본을 몇 개로 늘려도 동작이 같아야 한다. 서버 메모리에 사용자 상태를 두지 않는다. 주기 작업(스케줄러)에 의존하지 않고, 요청이 들어올 때 Lua 스크립트로 상태를 전진시킨다.

### 3.1.1 JVM 컨테이너 최적화

- Maven 멀티스테이지 빌드, 의존성 레이어 캐시, layered jar, jlink 맞춤 JRE, AppCDS, `MaxRAMPercentage`, graceful shutdown, 가상 스레드 (v1에서 구현됨. 유지한다).

### 3.2 예매 핵심 로직

#### 3.2.1 접속 대기열 (회차 단위)

- 좌석 화면에 동시에 들어갈 수 있는 인원을 회차당 `QUEUE_MAX_ACTIVE`(환경변수, 기본 100)로 제한한다.
- `POST /api/queue/enter` → 무작위 `queueToken` 발급. 자리가 있으면 즉시 `ADMITTED`, 없으면 `WAITING`.
- Redis: 대기자는 ZSET(점수 = 진입 시각), 입장자는 만료 시각을 가진 ZSET. 상태 조회 때 Lua로 "만료된 입장자 정리 → 빈자리만큼 대기자 승격"을 원자적으로 수행한다.
- 입장 권한은 `QUEUE_ADMIT_SECONDS`(기본 600초) 동안 유효하고, 예매 완료 시 반납한다. 대기 중 폴링이 `QUEUE_WAIT_TTL_SECONDS`(기본 30초) 끊기면 대기열에서 빠진다.
- 장애 유예: Redis가 잠시 멈췄다가 같은 데이터로 돌아온 경우(예: 주 서버에서 대기 서버로 전환), 멈춰 있던 시간을 폴링 끊김으로 세지 않는다. 대기열 스크립트가 마지막으로 돈 Redis 시각과의 공백이 대기 TTL의 절반보다 길면 그때부터 대기 TTL 동안은 폴링 끊김으로 사람을 빼지 않는다. 판단은 Redis 시각과 Redis 키로만 하므로 서버가 여러 대여도 결과가 같다.
- 좌석 조회·선점·예매 확정은 `ADMITTED` 상태의 토큰이 있어야 한다.
- 시연용: `QUEUE_MAX_ACTIVE=1`로 두면 두 번째 브라우저가 대기 화면을 보게 된다.

#### 3.2.2 좌석 임시 선점 (초과 판매 방지)

1. `POST /api/performances/{id}/holds`에서 좌석 1~4개를 **전부 아니면 전무**로 선점한다. Lua 스크립트로 각 좌석 키를 `SET NX EX`하고 하나라도 실패하면 전부 되돌린다.
2. 선점은 `HOLD_SECONDS`(기본 300초) 뒤 Redis TTL로 **자동 해제**된다. 별도 정리 작업이 없다.
3. 한 토큰은 동시에 선점 1건만 가진다. 새로 선점하면 이전 선점은 해제된다.
4. 예매 확정(`POST /api/reservations`)은 선점 소유를 확인한 뒤 MySQL 트랜잭션으로 좌석을 판매 처리한다. `UPDATE ... WHERE status='AVAILABLE'`의 영향 행 수가 좌석 수와 다르면 롤백한다. **Redis가 틀려도 DB에서 중복 판매가 막힌다.**
5. 확정 후 선점 키 삭제, 대기열 입장 권한 반납. `Idempotency-Key`로 중복 확정을 막는다.
6. 취소 시 DB에서 좌석을 다시 `AVAILABLE`로 돌린다.

좌석 상태는 "DB의 판매 여부 + Redis의 선점 여부"를 합쳐서 보여준다. MySQL이 기준 데이터다.

#### 3.2.3 로그인과 세션

- **세션 저장소는 MySQL**이다(Spring Session JDBC, 테이블 `SPRING_SESSION`·`SPRING_SESSION_ATTRIBUTES`). 서버 메모리에 세션을 두지 않으므로, 복제본이 여러 개여도 어느 파드로 요청이 가든 로그인이 유지되고, 파드가 재시작돼도 로그아웃되지 않는다. 스티키 세션이 필요 없다. Redis가 비워지거나 죽어도 로그인은 유지된다.
- 세션 테이블 부하를 줄인다: 로그인한 요청의 세션 확인은 DB 왕복 1번, 마지막 접근 시각 갱신은 `SESSION_TOUCH_SECONDS`(기본 60초)보다 촘촘하지 않게, 값이 바뀔 때만 저장. 만료 세션 삭제는 `SESSION_CLEANUP_SECONDS`(기본 300초)마다 여러 서버가 동시에 돌려도 안전한 방식으로 하고, 정합성은 정리에 의존하지 않는다(읽을 때 만료를 판단).
- 브라우저에는 세션 ID만 쿠키로 준다: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure`는 환경변수 `SESSION_COOKIE_SECURE`(운영 `true`, 로컬 http는 `false`).
- 세션은 `SESSION_IDLE_MINUTES`(기본 30분) 동안 요청이 없으면 만료된다. 로그인 성공 시 세션 ID를 새로 발급한다(세션 고정 공격 방지). 로그아웃은 DB의 세션을 지운다.
- JWT를 쓰지 않는 이유: 서버에서 즉시 무효화(로그아웃, 강제 만료)가 되고, 토큰을 브라우저 저장소에 둘 필요가 없어 XSS에 강하다. 예매 서비스는 어차피 DB가 살아 있어야 동작하므로 세션이 DB에 의존해도 가용성이 더 나빠지지 않는다.
- **CSRF**: 쿠키 인증이므로 상태를 바꾸는 요청(`GET`·`HEAD` 외 모든 `/api` 요청)은 헤더 `X-CSRF-Token`이 세션에 저장된 값과 같아야 한다. 값은 `GET /api/auth/me`와 로그인·가입 응답의 `csrfToken`으로 받는다. 로그인 전 요청(가입·로그인)도 익명 세션의 토큰을 쓴다.
- 비밀번호는 BCrypt(cost 12 이상)로 해시해 저장한다. 원문·해시를 로그와 응답에 남기지 않는다.
- 예매 흐름(대기열 진입, 좌석 조회, 선점, 예매 확정)은 로그인이 필요하다. 대기열 토큰과 선점은 발급받은 사용자에게 묶인다. 예매자 이름·이메일은 계정 정보를 쓴다(예매할 때 다시 입력하지 않는다).
- 한 계정이 한 회차에 가질 수 있는 확정 좌석은 최대 4석이다(여러 번 나눠 예매해도 합산).

#### 3.2.4 상태를 어디에 두는가 (next)

나중에 멀티 클라우드 DR 구성으로 올린다. 클라우드 사이에 복제하는 저장소는 MySQL 하나이고, Redis는 클라우드마다 따로 두며 복제하지 않는다. 다른 클라우드로 넘어가면 Redis는 빈 상태로 시작한다.

| 상태 | 저장소 | 다른 클라우드로 넘어가면 |
|---|---|---|
| 회원, 공연, 회차, 좌석 판매 여부, 예매 | MySQL | 유지 |
| 로그인 세션 | MySQL | 유지(복제 지연만큼의 최근 로그인은 다시 로그인) |
| 로그인 실패 잠금(있는 계정) | MySQL (`users`의 실패 횟수·잠금 해제 시각) | 유지 |
| 없는 이메일의 로그인 실패 횟수 | Redis | 사라짐(계정 존재 여부가 드러나지 않게 세는 값일 뿐이다) |
| 접속 대기열 | Redis | 사라짐. 다시 줄을 선다 |
| 좌석 임시 선점 | Redis | 사라짐. 다시 고른다. 판매된 좌석은 DB에 있어 영향 없다 |
| 멱등키, 요청 제한 | Redis | 사라짐(영향 없음) |

Redis의 상태별 동작(통합 테스트 `RedisLossIT`, `RedisDownIT`, `RedisPauseIT`로 확인한다):

| 상황 | 둘러보기·로그인·내 예매 | 대기열 | 좌석·선점 | 예매 확정 | `/readyz` |
|---|---|---|---|---|---|
| 비워졌다(장애 전환, 재시작) | 정상, 로그인·잠금 유지 | `401 QUEUE_TOKEN_INVALID` → 다시 진입 | 옛 토큰 401, 팔린 좌석은 `409 SEAT_TAKEN` | 선점 중이었으면 `409 HOLD_EXPIRED`. 중복 판매 없음 | 200 |
| 죽어 있다 | 정상 | `503 SERVICE_UNAVAILABLE` + `Retry-After` | 503 | 503 | 200, `redis: "down"` |
| 다시 살아났다 | 정상 | 서버 재시작 없이 정상 | 정상 | 정상 | `redis: "up"` |
| 잠시 멈췄다 같은 데이터로 돌아왔다 | 정상 | 대기 순번과 입장 상태 유지(3.2.1 장애 유예) | 선점 유지(만료 시각은 그대로 흐름) | 정상 | `redis: "up"` |

- Redis가 죽었을 때 예매 진행을 통과시키지 않고 닫는다. 대기열 없이 열면 줄 선 순서가 무너지고 가장 몰리는 순간에 DB가 직접 부하를 받기 때문이다. 중복 판매는 어느 경우에도 DB가 막는다(3.2.2의 4번).
- Redis 명령·연결 시간 초과는 `REDIS_TIMEOUT_MS`(기본 500)로 짧게 잡아 요청이 매달리지 않게 한다.

### 3.3 컨테이너 친화 요건 (양쪽 공통)

- 멀티스테이지 Dockerfile, 최종 이미지는 **non-root** 사용자, 빌드 도구 미포함.
- 루트 파일시스템 읽기 전용으로 실행 가능해야 한다(쓰기는 `/tmp`만).
- 로그는 stdout에 JSON 한 줄씩. 파일에 쓰지 않는다.
- `SIGTERM` 수신 시 새 요청을 막고 진행 중 요청을 끝낸 뒤 종료(롤링 업데이트 무중단).
- 백엔드: `GET /healthz`(프로세스 생존), `GET /readyz`(MySQL 연결 기준. Redis가 죽었다고 Pod가 트래픽에서 빠지면 둘러보기까지 죽으므로 Redis 상태는 응답 본문의 `redis` 항목으로만 알린다).
- DB 스키마 변경·시드는 서버 시작과 분리된 **별도 실행 모드**(`migrate` 인자)로 돌린다. 나중에 K8s Job으로 돌린다.
- `.dockerignore`로 `target`, `node_modules`, `.env`, `.git` 제외.

### 3.4 보안 요건

| 항목 | 요구사항 |
|---|---|
| 입력 검증 | 모든 body/params/query를 검증, 정의되지 않은 필드 거부, body 크기 16KB 제한. 검색어는 길이 제한(40자) |
| SQL | 매개변수 바인딩만 사용. 검색의 `LIKE`도 바인딩하고 `%`·`_`를 이스케이프 |
| 비밀값 | 코드·이미지·저장소에 넣지 않는다. 환경변수로만 주입. `.env.example`에는 가짜 값만 |
| 요청 제한 | IP당 제한(Redis). 대기열 진입·선점·예매·조회·취소는 더 엄격하게. 폴링 엔드포인트(대기 상태, 좌석 조회)는 폴링 주기를 감안해 별도 한도 |
| 대기열 토큰 | 암호학적 난수 128비트 이상. **헤더(`X-Queue-Token`)로만** 전달, URL·로그에 남기지 않음. 토큰은 발급된 회차에만 유효 |
| 선점 | `holdId`도 추측 불가능한 난수. 선점한 토큰만 해제·확정 가능. 남의 선점은 `MINE`으로 보이지 않음 |
| 대기열 우회 방지 | 좌석 조회·선점·확정은 서버가 `ADMITTED`를 확인. 클라이언트 화면 전환만으로 막지 않는다 |
| 좌석 독점 방지 | 1회 선점 최대 4석, 토큰당 선점 1건, 선점 TTL 고정(연장 불가) |
| 인증 | 비밀번호 8~72자, BCrypt 해시. 로그인 실패 응답은 "이메일이 없음"과 "비밀번호 틀림"을 구분하지 않는다(`INVALID_CREDENTIALS`). 계정당 연속 실패 5회면 15분 잠금(MySQL, DB 시계 기준), IP당 로그인·가입 요청 제한 |
| 세션 | 3.2.3 참고. 세션 ID는 추측 불가능한 난수, 쿠키로만 전달, URL·로그에 남기지 않음. 로그인 시 재발급, 로그아웃 시 서버에서 삭제 |
| CSRF | 상태 변경 요청은 `X-CSRF-Token` 검증. 실패 시 `403 CSRF_INVALID` |
| 예매 조회·취소 | 로그인한 본인 예매만. 남의 예매번호는 존재 여부를 드러내지 않고 같은 404 |
| 예매번호 | 암호학적 난수(`SecureRandom`), 혼동 문자 제외 12자 |
| 개인정보 | 이메일은 응답에서 마스킹, 로그에 이름·이메일을 남기지 않음, URL에 넣지 않음 |
| 오류 응답 | 스택·SQL·내부 경로를 노출하지 않음. 5xx는 고정 문구 + 요청 ID |
| HTTP 헤더 | 백엔드는 보안 헤더 필터. 프론트 nginx에서 CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` |
| CORS | 같은 출처라 기본 **비활성** |
| 프론트 | `dangerouslySetInnerHTML` 금지, 외부 스크립트·CDN·외부 이미지 금지, 비밀값을 번들에 넣지 않음. 토큰은 `sessionStorage`까지만(`localStorage` 금지) |
| 저작권 | 실제 공연 포스터·공연명·출연진·실제 사이트의 문구와 디자인을 쓰지 않는다. 공연 데이터는 전부 가상이다. 포스터는 사용자가 이 프로젝트용으로 직접 생성한 이미지를 프론트 정적 파일(`frontend/public/posters/{공연 id}.webp`, 작은 크기 `{id}-sm.webp`, 896×1200과 448×600)로 번들에 포함해 쓰고, 해당 파일이 없는 공연은 프론트가 4.1 `poster` 값으로 직접 그린다. 외부 주소의 이미지는 쓰지 않는다 |
| 의존성 | 최소한으로. 프론트 `npm audit --omit=dev` high 이상 없음. 백엔드는 Spring Boot BOM으로 버전 관리 |

## 4. API 계약

기본 경로 `/api`. 요청·응답은 `application/json; charset=utf-8`. 시각은 ISO 8601 UTC 문자열, 금액은 원 단위 정수.

### 4.1 자료형

```ts
type Genre = "CONCERT" | "MUSICAL" | "PLAY" | "CLASSIC";
type SaleStatus = "UPCOMING" | "ON_SALE" | "SOLD_OUT" | "CLOSED";

type Grade = { code: string; name: string; price: number };   // 예: { code: "R", name: "R석", price: 99000 }

// 포스터는 이미지 파일이 아니다. 프론트가 이 값으로 직접 그린다(SVG/CSS).
type Poster = { seed: number; hue: number };                   // hue: 0~359

type ShowSummary = {
  id: number;
  title: string;
  genre: Genre;
  venue: string;
  firstStartsAt: string;       // 첫 회차 시작
  lastStartsAt: string;        // 마지막 회차 시작
  saleOpensAt: string;
  minPrice: number;
  maxPrice: number;
  status: SaleStatus;          // 공연 전체 기준
  remainingSeats: number;      // 판매 중인 모든 회차의 잔여석 합
  totalSeats: number;
  rank: number | null;         // 판매량 순위(1부터). 판매 0이면 null
  poster: Poster;
};

type PerformanceSummary = {
  id: number;
  startsAt: string;
  status: SaleStatus;
  remainingByGrade: { grade: string; remaining: number; total: number }[];
};

type ShowDetail = ShowSummary & {
  ageRating: string;           // 예: "8세 이상"
  runningMinutes: number;
  cast: string[];
  description: string;         // 일반 텍스트(줄바꿈 포함). HTML 아님
  notices: string[];           // 유의사항
  maxSeatsPerBooking: 4;
  grades: Grade[];
  performances: PerformanceSummary[];   // 시작 시각 오름차순
};

type QueueState = {
  queueToken: string;          // enter 응답에만 포함. status 응답에는 없음
  status: "WAITING" | "ADMITTED";
  position: number;            // 내 앞에 남은 인원. ADMITTED면 0
  admittedUntil: string | null;
  pollAfterSeconds: number;    // 다음 조회까지 권장 간격
};

type Seat = {
  id: number;
  row: string;                 // "A", "B", ...
  number: number;              // 1부터
  grade: string;               // Grade.code
  status: "AVAILABLE" | "HELD" | "SOLD" | "MINE";   // MINE = 내 토큰이 선점한 좌석
};

type SeatMap = {
  performance: { id: number; showId: number; showTitle: string; venue: string; startsAt: string };
  grades: Grade[];
  rows: string[];              // 무대에서 가까운 순
  seatsPerRow: number;
  aisleAfter: number[];        // 이 번호 뒤에 통로. 예: [4, 12]
  seats: Seat[];
  myHold: Hold | null;
};

type Hold = { holdId: string; seatIds: number[]; totalPrice: number; expiresAt: string };

type Reservation = {
  code: string;
  show: { id: number; title: string; venue: string };
  performance: { id: number; startsAt: string };
  seats: { row: string; number: number; grade: string; price: number }[];
  totalPrice: number;
  name: string;
  emailMasked: string;
  status: "CONFIRMED" | "CANCELLED";
  createdAt: string;
  cancelledAt: string | null;
};

type ApiError = { error: { code: string; message: string; requestId: string; details?: unknown } };

// v3
type User = { id: number; email: string; name: string };      // 본인에게만 주므로 이메일을 마스킹하지 않는다
type AuthState = { user: User | null; csrfToken: string };
```

`ShowSummary.rank`는 전체 공연 기준 순위다. 장르로 거른 목록에서 순위를 보여줄 때 UI는 `rank`가 아니라 **받은 목록 안에서의 순서(1부터)**를 쓴다.

상태 규칙(회차): 현재 < 공연의 `saleOpensAt` → `UPCOMING`, 현재 ≥ 회차 `startsAt` → `CLOSED`, 잔여 0 → `SOLD_OUT`, 그 외 `ON_SALE`.
상태 규칙(공연): 모든 회차가 `CLOSED`면 `CLOSED`, `UPCOMING`이면 `UPCOMING`, 닫히지 않은 회차가 전부 `SOLD_OUT`이면 `SOLD_OUT`, 그 외 `ON_SALE`.
목록·상세의 잔여석은 판매(DB) 기준이며 선점은 반영하지 않아도 된다.

### 4.2 엔드포인트

**조회 (토큰 불필요)**

| 메서드·경로 | 요청 | 성공 | 실패 |
|---|---|---|---|
| `GET /api/shows` | query: `genre?`(Genre), `q?`(제목·장소 검색, 1~40자), `status?`(SaleStatus), `sort?`(`date` 기본 \| `ranking` \| `opening`) | `200 { shows: ShowSummary[] }` | `400 VALIDATION_ERROR` |
| `GET /api/shows/:id` | — | `200 ShowDetail` | `404 SHOW_NOT_FOUND` |

`sort=opening`은 `saleOpensAt` 오름차순(오픈 예정 목록용), `sort=ranking`은 판매량 내림차순.

**인증 (v3)** — 상태 변경 요청은 모두 헤더 `X-CSRF-Token` 필요

| 메서드·경로 | 요청 | 성공 | 실패 |
|---|---|---|---|
| `GET /api/auth/me` | — | `200 AuthState`(비로그인이면 `user: null`. 항상 200) | — |
| `POST /api/auth/signup` | body `{ email: string, password: string(8~72), name: string(1~40) }` | `201 AuthState`(가입과 동시에 로그인) | `409 EMAIL_TAKEN`, `400 VALIDATION_ERROR` |
| `POST /api/auth/login` | body `{ email: string, password: string }` | `200 AuthState`(세션 쿠키 재발급, 새 `csrfToken`) | `401 INVALID_CREDENTIALS`, `429 ACCOUNT_LOCKED`(`Retry-After`) |
| `POST /api/auth/logout` | — | `204` | — |

로그인이 필요한 엔드포인트를 비로그인으로 부르면 `401 UNAUTHENTICATED`.

**내 예매 (v3, 로그인 필요)**

| 메서드·경로 | 요청 | 성공 | 실패 |
|---|---|---|---|
| `GET /api/me/reservations` | — | `200 { reservations: Reservation[] }`(최근 예매 순, 취소 건 포함) | `401 UNAUTHENTICATED` |
| `POST /api/me/reservations/:code/cancel` | — | `200 Reservation`(`CANCELLED`) | `404 RESERVATION_NOT_FOUND`, `409 ALREADY_CANCELLED`, `409 PERFORMANCE_CLOSED` |

**대기열 (v3부터 로그인 필요)**

| 메서드·경로 | 요청 | 성공 | 실패 |
|---|---|---|---|
| `POST /api/queue/enter` | body `{ performanceId: number }` | `200 QueueState`(`queueToken` 포함) | `404 PERFORMANCE_NOT_FOUND`, `409 NOT_ON_SALE`, `409 SOLD_OUT` |
| `GET /api/queue/status` | 헤더 `X-Queue-Token` | `200 QueueState`(`queueToken` 제외) | `401 QUEUE_TOKEN_INVALID`(만료·없음) |
| `DELETE /api/queue` | 헤더 `X-Queue-Token` | `204`(대기·입장 포기, 선점도 해제) | — (없는 토큰도 204) |

**좌석 (헤더 `X-Queue-Token` 필수, `ADMITTED`여야 함)**

| 메서드·경로 | 요청 | 성공 | 실패 |
|---|---|---|---|
| `GET /api/performances/:id/seats` | — | `200 SeatMap` | `401 QUEUE_TOKEN_INVALID`, `403 QUEUE_NOT_ADMITTED`, `404 PERFORMANCE_NOT_FOUND` |
| `POST /api/performances/:id/holds` | body `{ seatIds: number[] }`(1~4개, 중복 없음) | `201 Hold` | `409 SEAT_TAKEN`(`details: { seatIds: number[] }`), `409 NOT_ON_SALE`, `400 VALIDATION_ERROR`, 위 401/403/404 |
| `DELETE /api/holds/:holdId` | — | `204` | `404 HOLD_NOT_FOUND`(내 것이 아니거나 없음) |

**예매**

| 메서드·경로 | 요청 | 성공 | 실패 |
|---|---|---|---|
| `POST /api/reservations` | 로그인 필요. 헤더 `X-Queue-Token`, `Idempotency-Key: <uuid>` 필수. body `{ holdId: string }`(이름·이메일은 계정에서 가져온다) | `201 Reservation` | `409 HOLD_EXPIRED`(만료·없음·내 것 아님), `409 SEAT_TAKEN`, `409 NOT_ON_SALE`, `409 BOOKING_LIMIT_EXCEEDED`(회차당 계정 4석 초과), `400 VALIDATION_ERROR`, 401/403 |

조회·취소는 위 "내 예매"를 쓴다. v2의 `/api/reservations/lookup`, `/api/reservations/cancel`은 없어졌다.

**상태 확인**: `GET /healthz` → `200 { status: "ok" }`, `GET /readyz` → `200 { status: "ready", redis: "up" | "down" }` 또는 `503`(MySQL에 연결할 수 없을 때). Redis가 죽어도 200이다.

공통 실패: `429 RATE_LIMITED`(`Retry-After` 헤더), `500 INTERNAL_ERROR`, `503 SERVICE_UNAVAILABLE`(`Retry-After` 헤더. Redis 장애 때 대기열·좌석·선점·예매 확정 요청에만 나온다. 조회·로그인·내 예매에는 나오지 않는다).
예매 확정에서 선점이 없으면(만료, Redis 소실) 다른 검사보다 먼저 `409 HOLD_EXPIRED`를 준다.
`message`는 사용자에게 그대로 보여줄 수 있는 한국어 문장으로 준다.

### 4.3 화면 흐름과 API의 대응

```
메인(장르·검색·랭킹·오픈 예정)      GET /shows
  └ 공연 상세(달력 → 회차 → 등급별 잔여)  GET /shows/:id
      └ [예매하기] (비로그인이면 로그인 화면으로, 로그인 후 원래 공연으로 복귀)
                                      POST /queue/enter
          ├ WAITING → 대기 화면        GET /queue/status (pollAfterSeconds 간격)
          └ ADMITTED → 좌석 선택       GET /performances/:id/seats (3~5초 간격 갱신)
              └ [좌석 선택 완료]        POST /performances/:id/holds
                  └ 예매 확인 + 남은 시간   POST /reservations
                      └ 완료 화면
회원가입·로그인·로그아웃               POST /auth/signup, /auth/login, /auth/logout
앱 시작 시 로그인 상태 확인            GET /auth/me
내 예매(목록·취소)                    GET /me/reservations, POST /me/reservations/:code/cancel
```

### 4.4 시드 데이터 요건

- 가상 공연 68개(처음 18개 + 2026-11-25에 추가한 50개, `docs/next/SHOWS-ADD.md`), 장르 4종이 고루 섞이게. 새 공연은 목록 끝에 추가해 기존 공연의 id가 바뀌지 않게 한다(포스터 파일 이름이 공연 id다). 공연당 회차 1~10개, 등급 2~3개.
- 좌석 배치는 회차당 8~12행 × 12~18석. 앞쪽 행이 높은 등급.
- 상태가 섞이도록 실행 시각 기준 상대 날짜: 판매 중(대부분), 오픈 예정 2~3개(그중 하나는 며칠 안에 오픈), 매진 회차 포함 1~2개, 종료 1개.
- 랭킹이 비지 않도록 일부 좌석은 미리 판매된 상태로 시드.
- 공연명·출연진·장소는 **전부 지어낸 것**이어야 한다(실존 아티스트·공연장 이름 금지).
- 시연용 계정: migrate 실행 시 환경변수 `SEED_DEMO_EMAIL`과 `SEED_DEMO_PASSWORD`가 **둘 다** 있을 때만 그 값으로 계정을 만든다. 비밀번호를 코드나 SQL에 적지 않는다. 미리 판매된 시드 좌석은 별도의 로그인 불가 시드 계정 소유로 둔다.

## 5. 폴더와 담당

```
ticketing/
├─ docs/ARCHITECTURE.md   ← 이 문서 (조율 세션 담당)
├─ backend/               ← 백엔드 세션만 수정
├─ frontend/              ← UI 세션만 수정
├─ gateway/nginx.conf     ← 로컬 통합용 게이트웨이 (조율 세션 담당)
└─ docker-compose.yml     ← 전체 스택 통합 실행 (조율 세션 담당)
```

- 각 세션은 자기 폴더 밖을 수정하지 않는다.
- 두 서비스 모두 컨테이너 포트는 **8080**.
- 로컬 개발: 백엔드 `http://localhost:8080`, 프론트 Vite 개발 서버는 `/api`를 백엔드로 프록시.
- 전체 스택이 `http://localhost:8088`에서 실행 중일 수 있다. 조율 세션의 통합 환경이므로 각 세션은 이 컨테이너들(`ticketing-*`)을 내리거나 다시 만들지 않는다. 자기 검증에는 다른 포트와 다른 compose 프로젝트 이름을 쓴다.
