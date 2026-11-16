# 미리내 마당: 티켓 예매 서비스 프론트엔드 (v3)

공연을 찾고, 날짜·회차를 고르고, 대기열을 거쳐 좌석을 선택해 예매하고, 예매번호와 이메일로 조회·취소하는 웹 UI입니다.
React + Vite + TypeScript로 만들고, 빌드한 정적 파일을 `nginx-unprivileged`로 서빙합니다.
API 계약은 `../docs/ARCHITECTURE.md`(v3) 4장을 따릅니다. 공연·출연진·공연장은 모두 지어낸 것입니다. 포스터는 직접 생성한 이미지(`public/posters/`)를 번들에 넣어 쓰고, 이미지가 없는 공연은 생성형 SVG 포스터를 그립니다.

## 화면 흐름

```
메인(장르 탭·검색·판매 랭킹·티켓 오픈 예정·포스터 목록)   GET /api/shows
 └ 공연 상세(포스터, 정보, 달력 → 회차 → 등급별 가격·잔여석) GET /api/shows/:id
    └ 예매하기 (비로그인이면 /login?next=/shows/:id?perf=회차 → 로그인 후 그 회차로 복귀)
       └ /book/:performanceId/queue 대기                  POST /api/queue/enter, GET /api/queue/status
          └ /book/:id/seats 좌석 선택(최대 4석)            GET /api/performances/:id/seats, POST …/holds
             └ /book/:id/confirm 예매 확인(남은 시간)     POST /api/reservations { holdId }
                └ /complete 완료(티켓)
/login, /signup 로그인·회원가입                            POST /api/auth/login, /signup, /logout
앱 시작 시 로그인 상태                                     GET /api/auth/me
/me/reservations 내 예매(목록·취소)                        GET /api/me/reservations, POST …/:code/cancel
```

## 실행 방법

### 개발 (백엔드 없이, v3 모의 API)

```bash
npm ci
npm run dev:mock      # http://localhost:5173
```

모의 API(`mock/server.ts`)는 `vite.config.ts`에서 mock 모드일 때만 import되므로 **프로덕션 번들에 들어가지 않습니다**.
Docker 빌드 단계에서 `dist`에 모의 코드 흔적(`__mock`, 테스트 이메일)이 있으면 빌드가 실패하도록 검사합니다.

| 보고 싶은 상태 | 방법 |
|---|---|
| 대기 → 입장 | 아무 회차나 예매하기. 모든 회차가 대기로 시작해 몇 번 갱신하면 입장. 〈파도 위의 정원〉 첫 회차는 대기가 깁니다 |
| `NOT_ON_SALE` | 오픈 예정 공연의 회차 주소로 직접 이동(예: `/book/114/queue`) |
| `SOLD_OUT` | 매진 회차로 직접 이동(`/book/107/queue`) |
| `QUEUE_NOT_ADMITTED` | 대기 중에 `/book/:id/seats`로 직접 이동 |
| `QUEUE_TOKEN_INVALID` | 개발자 도구에서 sessionStorage `mirinae.booking.v2`의 `queueToken`을 바꿈 |
| `SEAT_TAKEN` | 좌석을 고른 뒤 `POST /api/__mock/steal` `{ "seatIds": [...] }`로 다른 관객이 먼저 잡은 것처럼 만들고 선택 완료 |
| 불규칙 배치 | 〈파도 위의 정원〉(부채꼴), 〈밤의 라디오 공개방송〉(모서리·기둥) |
| 회차 바꾸기 | 좌석 화면의 "날짜·회차 바꾸기" |
| 확보 시간 만료(화면) | 좌석 화면 주소에 `?shorthold=1` → 확보 시간 20초 |
| `RATE_LIMITED` | 검색어 `ratelimit`, 또는 위의 계정 이메일 |
| 목록 서버 오류 | 메인 주소에 `?fail=1` |
| 로그인 | 시연 계정 `test@example.com` / `test1234`(모의 서버 전용, 예매 2건이 들어 있음). 새로 가입해도 됩니다 |
| `INVALID_CREDENTIALS` / `ACCOUNT_LOCKED` | 비밀번호를 틀리게 입력. 5번 틀리면 15분 잠금(`Retry-After` 카운트다운) |
| `EMAIL_TAKEN` | 이미 있는 이메일로 가입 |
| 세션 만료(401) | `POST /api/__mock/expire-session` 뒤 아무 요청 → 만료 안내와 함께 로그인 화면, 로그인하면 하던 화면으로 |
| `CSRF_INVALID` 재시도 | `POST /api/__mock/rotate-csrf` 뒤 변경 요청(예: 로그아웃) → 403 → `/auth/me`로 새 토큰 → 한 번 재시도 |
| `BOOKING_LIMIT_EXCEEDED` | 같은 회차에 3석 예매한 뒤 2석 더 예매 |
| 예매 확정 오류 | 계정 이메일을 `ratelimit@test.kr`(429), `offline@test.kr`(연결 끊김), `expired@test.kr`(HOLD_EXPIRED), `fail@test.kr`(500)로 가입해 예매 |

### 개발 (실제 백엔드)

```bash
npm run dev           # /api → http://localhost:8080 프록시
```

다른 백엔드(예: 통합 환경)에 붙이거나 프로덕션 빌드를 확인할 때는 `API_PROXY`로 대상을 바꿉니다.

```bash
API_PROXY=http://localhost:8088 npm run dev
```

```bash
npm run build && API_PROXY=http://localhost:8088 npm run preview   # http://localhost:4173
```

### 검사와 빌드

```bash
npm run typecheck
npm run build
npm audit --omit=dev
```

### 컨테이너

```bash
docker build -t ticketing-frontend .
```

```bash
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop ALL --security-opt no-new-privileges:true ticketing-frontend
```

- 실행 사용자 uid/gid **101**(non-root), 포트 **8080**, 쓰기가 필요한 경로는 **`/tmp` 하나**.
- `GET /healthz` → `200 {"status":"ok"}`. 쿠버네티스 liveness·readiness 프로브용.
- 종료 신호 `SIGQUIT`(진행 중 요청을 마치고 종료). 쿠버네티스에서는 `preStop`에 `nginx -s quit; sleep 5`를 권장합니다.
- `/api`는 nginx가 프록시하지 않습니다(운영은 Ingress, 로컬 통합은 gateway). 잘못 들어오면 계약 형식의 `503 API_UNAVAILABLE`.

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 101
  runAsGroup: 101
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities: { drop: ["ALL"] }
volumeMounts:
  - { name: tmp, mountPath: /tmp }
volumes:
  - { name: tmp, emptyDir: { medium: Memory, sizeLimit: 16Mi } }
```

## 폴더 구조

```
src/
├─ api.ts                 API 호출 모듈 + 계약 v3 자료형, CSRF 헤더·재시도, 401 처리, ApiError(supportId, takenSeatIds)
├─ auth.tsx               로그인 상태(AuthProvider), 로그인 필요 화면(RequireAuth), 돌아갈 경로 검사(safeNext)
├─ booking.ts             예매 진행 상태(queueToken, hold, 좌석 요약)를 sessionStorage에 보관
├─ format.ts              한국 시간 날짜·D-day·금액·예매번호 표시, 장르·상태 이름
├─ uuid.ts                Idempotency-Key용 UUID v4 (HTTP에서도 동작)
├─ App.tsx                라우팅, 머리글(예매 단계 표시), 페이지 전환 시 포커스 이동
├─ pages/
│  ├─ HomePage.tsx        장르 탭·검색·랭킹·오픈 예정·포스터 목록
│  ├─ ShowPage.tsx        공연 상세 + 달력·회차·잔여석·예매 버튼
│  ├─ QueuePage.tsx       대기열 진입·대기 화면
│  ├─ SeatsPage.tsx       좌석 선택·선점
│  ├─ ConfirmPage.tsx     예매 확인(좌석·합계·남은 시간·예매자) 후 확정
│  ├─ CompletePage.tsx    완료(티켓)
│  ├─ MyReservationsPage.tsx 내 예매(목록·취소)
│  ├─ AuthPages.tsx       로그인·회원가입
│  └─ NotFoundPage.tsx
└─ components/
   ├─ PosterArt.tsx       포스터 자리: 이미지가 있으면 <img>, 없거나 못 불러오면 생성형 포스터
   ├─ Poster.tsx          생성형 리소 포스터(SVG)
   ├─ SeatMap.tsx         좌석 배치도(키보드 조작, 접근성 이름) + 범례
   ├─ Calendar.tsx        회차가 있는 날만 고르는 월 달력
   ├─ PerfSwitcher.tsx    좌석 화면의 날짜·회차 바꾸기(토큰 반납 후 재진입)
   ├─ Steps.tsx           예매 5단계 표시
   ├─ Ticket.tsx          절취선 티켓(완료·조회 공용)
   └─ bits.tsx            상태 표시, 알림, 카운트다운, 폴링 반복기(usePoller)
mock/server.ts            개발 전용 v2 모의 API (번들 제외)
nginx/                    nginx.conf, security-headers.conf
```

## 동작 설계

### 폴링

| 대상 | 보이는 탭 | 숨겨진 탭 | 화면을 떠나면 | 429 |
|---|---|---|---|---|
| 대기 상태 `GET /queue/status` | 서버의 `pollAfterSeconds`(1~30초로 제한) | **10초**로 늦춤(서버가 30초 무응답이면 대기에서 빼므로 멈추지 않음) | 중단(요청 abort) | `Retry-After`만큼 대기 |
| 좌석 상태 `GET /performances/:id/seats` | **4초** | **멈춤**, 다시 보이면 즉시 갱신 | 중단 | `Retry-After`만큼 대기 |

네트워크 오류·5xx는 대기 화면 5초, 좌석 화면 6초 뒤 다시 시도합니다(대기 순서를 잃지 않도록).

### 토큰·개인정보

- `queueToken`은 `X-Queue-Token` 헤더로만, `holdId`는 body로만 보냅니다. URL에는 회차 번호만 들어갑니다.
- 새로고침에 견디도록 토큰·선점 정보·좌석 요약을 **sessionStorage**(`mirinae.booking.v2`)에만 둡니다. `localStorage`는 쓰지 않습니다. 이름·이메일은 저장하지 않습니다. 예매가 확정되면 지웁니다.
- 토큰 없이 좌석·정보 화면에 들어오면 대기열 진입부터 시작합니다(서버도 막음).

### 예매 확정

- `Idempotency-Key`는 입력값(holdId·이름·이메일)과 묶습니다. 네트워크 실패·5xx·429 뒤 같은 입력으로 다시 보내면 같은 키, 입력이 바뀌거나 확정 응답(201, 4xx)을 받으면 새 키.
- 요청 중 버튼 비활성화 + `useRef` 잠금으로 연타 시 요청 1회.
- 확보 남은 시간은 `expiresAt` 기준으로 세고, 0이 되면 좌석 선택으로 돌려보냅니다.

### 오류별 처리

| 코드 | 화면의 반응 |
|---|---|
| `QUEUE_TOKEN_INVALID` | 진행 상태를 지우고 대기열부터 다시(대기 화면에서는 "다시 줄 서기") |
| `QUEUE_NOT_ADMITTED` | 대기 화면으로(토큰 유지) |
| `HOLD_EXPIRED` | 좌석 선택으로 돌아가 안내 |
| `SEAT_TAKEN` | 빠진 좌석을 "A열 1번, A열 2번"처럼 알려 주고 선택에서 뺀 뒤 배치도 갱신. 폴링 중 내가 고른 좌석이 남에게 넘어가도 같은 방식으로 알림 |
| `SOLD_OUT`, `NOT_ON_SALE` | 이유와 함께 공연 정보로 돌아가는 길 제공 |
| `RATE_LIMITED` | `Retry-After` 카운트다운 동안 버튼 잠금 |
| 네트워크 실패 | 같은 키로 재시도 가능함을 안내 |

서버 `message`는 React 기본 이스케이프로 보여 줍니다. 요청 ID는 5xx일 때만 보여 줍니다.

## 로그인과 세션 (v3)

- **세션**: 서버가 주는 `HttpOnly` 쿠키. 자바스크립트로 읽지 않고(읽을 수도 없음), 같은 출처 `fetch`에 자동으로 붙습니다. 토큰을 브라우저 저장소에 두지 않습니다.
- **CSRF**: 앱 시작 시 `GET /api/auth/me`로 로그인 상태와 `csrfToken`을 받고, `GET`·`HEAD` 외 모든 요청에 `X-CSRF-Token`을 붙입니다. 로그인·가입 응답의 새 토큰으로 바꾸고, `403 CSRF_INVALID`면 `/auth/me`로 다시 받아 **한 번만** 재시도합니다. 토큰은 `api.ts` 모듈 메모리에만 있습니다.
- **비밀번호**: 폼 상태(메모리)에만 있고, 제출 직후 지웁니다. `autocomplete`는 이메일 `username`, 로그인 `current-password`, 가입 `new-password`. 비밀번호 보기 전환이 있습니다.
- **비로그인 예매**: 예매하기 → `/login?next=/shows/:id?perf=회차` → 로그인(또는 가입) 후 그 공연, 그 회차가 선택된 상태로 돌아옵니다. `/book/*`, `/me/*`에 직접 들어와도 같은 방식으로 로그인 화면을 거칩니다.
- **오픈 리다이렉트 방지**: `next`는 `/`로 시작하는 앱 내부 경로만 허용합니다. `//host`, `/\host`, `https://…`, `javascript:` 등은 모두 `/`로 바꿉니다(같은 출처로 해석되는지도 확인).
- **세션 만료(401 UNAUTHENTICATED)**: 어떤 요청에서 받든 로그인 상태를 비우고, "로그인이 만료되었습니다" 안내와 함께 로그인 화면으로 보냅니다. 예매 도중이었다면 확보해 둔 좌석이 풀렸을 수 있다고 알리고, 다시 로그인하면 하던 화면으로 돌아옵니다.
- **로그아웃**: 진행 중인 대기열 토큰을 반납하고(`DELETE /api/queue`) 예매 진행 상태를 지운 뒤 `POST /api/auth/logout`, 메인으로 이동합니다.
- **예매 확인 단계**: 이름·이메일 입력이 없어지고, 계정의 이름·이메일을 보여 준 뒤 확정합니다. `Idempotency-Key`는 선점(holdId) 하나에 묶여, 네트워크 실패 뒤 재시도는 같은 키를 씁니다.
- **내 예매**: 다가오는 공연과 지난·취소한 예매로 나눠 보여 주고, 좌석(열·번호·등급)·회차·합계·예매번호·상태를 표시합니다. 취소는 확인 단계를 거치며 덜 위험한 "그대로 두기"에 포커스가 갑니다. v2의 `/lookup` 주소는 내 예매로 이동합니다.

| 오류 | 화면의 반응 |
|---|---|
| `INVALID_CREDENTIALS` | "이메일 또는 비밀번호가 맞지 않습니다"(어느 쪽인지 구분하지 않음), 비밀번호 칸을 비움 |
| `ACCOUNT_LOCKED` | `Retry-After` 기준 남은 시간(분·초)을 세고 그동안 로그인 버튼을 잠금 |
| `EMAIL_TAKEN` | 그 이메일로 로그인하는 링크 제공 |
| 비밀번호 규칙 | 8~72자를 화면에서 먼저 검사, 서버의 `VALIDATION_ERROR` 문구도 그대로 표시 |
| `BOOKING_LIMIT_EXCEEDED` | 회차당 계정 4석 제한 안내와 내 예매 링크 |

## 디자인 결정

**v1 정체성(리소 인쇄 전단지)을 발전시켰습니다.** v2의 시각적 핵심이 생성형 포스터인데, 실제 공연 전단지에서 흔한 리소 인쇄(두 가지 잉크 겹침, 망점, 판 어긋남, 종이 질감)가 "같은 입력이면 같은 그림"을 만드는 규칙 기반 그래픽과 잘 맞았기 때문입니다. 대신 화면 대부분을 포스터가 채우게 되었으므로 UI 자체는 v1보다 더 조용하게 만들었습니다.

| 항목 | 결정 |
|---|---|
| 색 | 종이 `#EDEFF2`, 잉크 `#1D2A4D`, 행동은 리소 블루 `#2F4FD8` 하나, 핑크 `#F0469A`는 급함(D-1·D-DAY, 남은 시간 1분, 잔여석 적음)에만. 좌석 등급 `#D6336C` `#2F4FD8` `#C98500` `#12866F` |
| 서체 | 제목·숫자 **Black Han Sans**, 본문 **IBM Plex Sans KR** 400/600 (둘 다 SIL OFL 1.1, `@fontsource`로 번들) |
| 생성형 포스터(이미지가 없을 때) | 화면에서는 글자 없이(`bare`) 그림만 그립니다(제목은 카드 아래). 제목을 넣어 그리는 모드도 남아 있으며, 이때 그림은 제목 영역 위로만 그리고(SVG clipPath) 제목 위에 잉크 선을 둡니다. `poster.hue`로 첫 잉크, 시드로 고른 보색 계열로 둘째 잉크. 둘째 판은 시드만큼 어긋나게 찍고 `mix-blend-mode: multiply`로 겹침. 장르별 모티프: 콘서트=음파 동심원과 이퀄라이저, 뮤지컬=막과 조명 원뿔, 연극=무대 세트 도형·의자·달, 클래식=오선과 홀의 아치 |
| 메인 | 판매 랭킹은 **같은 크기의 포스터 다섯 장**을 한 줄로 두고, 아래에 작은 순위 숫자(받은 목록 안에서 1부터, 1위만 파란색)와 제목(두 줄까지)·공연장을 둡니다. 오픈 예정은 절취선 행 + D-day, 전체 목록은 포스터 아래에 제목·공연장·기간·가격. 매진·종료는 그림 위가 아니라 가격 줄의 태그로, 종료 공연은 포스터를 흐리게(회색) |
| 좌석 | 등받이 모양 좌석, 무대는 위쪽의 큰 곡선 막, 행 이름은 배치도 양쪽. **고를 수 있는 좌석만 등급색**으로 칠하고 판매·선점된 좌석은 모두 같은 흐린 회색(색이 보이는 곳 = 고를 수 있는 곳). 내가 고른 좌석은 남색+체크. 판매/선점 구분은 접근성 이름과 범례로 |
| 움직임 | 확정 도장 한 번, 좌석을 고를 때 작은 튐, 남은 1분 깜빡임. `prefers-reduced-motion`이면 모두 끔 |

### 포스터 이미지와 제목 위치

- **이미지**: `public/posters/{공연 id}.webp`(896×1200, 상세) / `{공연 id}-sm.webp`(448×600, 카드·랭킹·대기 화면). 3:4. `width`/`height`를 지정해 불러오기 전에도 자리가 잡히고(레이아웃 밀림 없음), 상세의 큰 포스터 외에는 `loading="lazy"`.
- **어느 공연에 이미지가 있는지**: `vite.config.ts`의 `posterImages` 플러그인이 빌드할 때 폴더를 읽어 두 크기가 모두 있는 id 목록을 `virtual:poster-images` 모듈로 만듭니다. 목록에 없는 공연은 처음부터 생성형 포스터를 그리므로 없는 파일을 요청하지 않습니다(404·콘솔 오류 없음). 목록에 있는데도 못 불러오면(배포 누락 등) `onError`에서 생성형 포스터로 바꿔 빈 칸이 남지 않습니다. 이미지를 추가하면 다시 빌드하면 됩니다.
- **제목은 포스터 밖, 아래에 글자로 한 번만**: 이미지는 장마다 밝기와 색이 크게 다르고(짙은 남색, 밝은 크림색, 형광 연두…) 아래 1/3의 빈 정도도 제각각이라, 같은 방식으로 제목을 얹으면 어떤 장에서는 읽히지 않습니다. 모든 배경에서 읽히게 하려면 그림을 덮는 그라데이션·띠가 필요한데, 그림을 가리고 리소풍 평면 그림과도 어울리지 않습니다. 그래서 포스터는 그림만 두고 제목은 카드 아래(상세에서는 h1)에 둡니다. 생성형 포스터도 같은 규칙으로 글자 없이(`bare`) 그려 이미지가 있는 카드와 없는 카드가 같은 모양입니다.
- **대체 텍스트**: 상세의 포스터는 "{공연명} 포스터". 카드·랭킹에서는 같은 링크 안에 제목 글자가 바로 있으므로 이미지를 장식(`alt=""`)으로 두어 화면 낭독기가 제목을 두 번 읽지 않게 했습니다.
- **캐시**: nginx `/posters/`는 파일명에 해시가 없으므로 `public, max-age=86400, must-revalidate`(하루 뒤 ETag로 재검증 → 304). 없는 파일은 `index.html`이 아니라 404.

v1에서 바꾼 것: 일정표 행 목록 → 포스터 벽(v2는 공연이 여러 회차라 날짜 하나로 정렬하는 일정표가 맞지 않음), 큰 날짜 강조 → 큰 포스터와 랭킹 숫자, 상태 태그의 핑크 채움 → 테두리만(포스터 색과 경쟁하지 않게).

뻔한 기본값에서 피한 것: 그림자 있는 둥근 카드 격자, 그라데이션 배너, 영문 대문자 라벨, 가운뎃점으로 이은 메타 정보, 버튼의 `→`. 예매 단계에만 번호(1 대기 → 2 좌석 → 3 정보)를 씁니다. 실제 순서가 있는 흐름이기 때문입니다.

### 예매 단계와 주문 요약

- 단계 표시 **1 회차 선택 → 2 대기 → 3 좌석 선택 → 4 예매 확인 → 5 완료**를 공연 상세의 예매 패널(1단계)과 예매 화면 머리글(2~5단계)에 둡니다. 좁은 화면에서는 번호와 현재 단계 이름만 보입니다.
- 좌석 선택·예매 확인 화면 모두 **예매 내용 요약**(공연명, 날짜·회차, 장소, 고른 좌석의 열·번호·등급, 합계)을 보여 줍니다. 좌석 화면의 모바일에서는 요약과 선택 완료 버튼이 화면 아래에 붙습니다.
- 회차 선택 단계에서 등급별 가격과 잔여석을 함께 보여 주고, 잔여석이 판매 기준이라 다른 관객이 고르는 중인 좌석이 포함될 수 있다고 안내합니다.

### 좌석 화면에서 날짜·회차 바꾸기

대기열 토큰은 회차 단위입니다. "날짜·회차 바꾸기"에서 다른 회차를 고르면 먼저 "지금 고른 좌석 N석(확보해 둔 좌석 포함)이 모두 풀리고 새 회차의 대기열에 다시 들어간다"고 알린 뒤, 확인하면 `DELETE /api/queue`(토큰 반납 + 선점 해제) → 진행 상태 삭제 → 새 회차 `POST /api/queue/enter` 순서로 진행합니다. 매진·종료·오픈 예정 회차는 고를 수 없게 보입니다.

### 불규칙한 좌석 배치

- `seats[]`에 없는 (행, 번호)는 빈칸으로 비워 둡니다. `number`를 격자 열 위치로 쓰므로 나머지 좌석이 당겨지지 않습니다(부채꼴, 모서리 빠짐, 기둥 자리 모두 같은 방식).
- 키보드 이동은 빈칸을 건너뜁니다(예: E열 2번에서 → 를 누르면 기둥 자리 3·4번을 건너 5번으로).
- 좌석 크기는 배치도 폭과 `seatsPerRow`·통로 수로 계산해 12~34px(2px 단위) 클래스로 지정합니다(`ResizeObserver`, 인라인 style 없음). 처음에는 **배치도 전체가 화면에 들어오게** 줄이고(좁은 화면은 행 이름·간격도 줄임), 좌석이 26px보다 작아지면 "좌석 크게 보기"로 30px로 키울 수 있습니다. 크게 보면 가로로 넘치므로 가운데(무대 정면)에서 시작하고, 오른쪽 끝 흐림과 "배치도를 옆으로 밀어 보세요" 안내로 밀 수 있다는 것을 보여 줍니다.
- 모의 데이터: 〈파도 위의 정원〉·〈네온 사막〉은 앞줄이 짧은 부채꼴, 〈골목의 끝, 세탁소〉·〈밤의 라디오 공개방송〉은 뒤쪽 모서리가 빠지고 E열에 기둥 자리가 있는 배치입니다.

### 좌석 배치도 접근성·모바일

- 배치도 안에서는 좌석 하나만 Tab으로 들어가고(roving tabindex) 화살표로 이동, Home/End로 행 끝, 스페이스·엔터로 선택.
- 좌석마다 `A열 5번, R석 130,000원, 선택 가능` 형식의 이름과 `aria-pressed`(선택 여부). 판매·선점된 좌석은 `aria-disabled`라 이동은 되고 선택은 안 됩니다.
- 모바일은 **처음엔 전체 보기, 필요하면 확대 후 가로 스크롤** 방식입니다. 확대했을 때 행 이름은 양 끝에 붙어 따라옵니다. 고른 좌석 요약과 선택 완료 버튼은 화면 아래에 붙습니다.
- 가로 스크롤 영역(랭킹 줄, 장르 탭, 배치도)은 `contain: paint`로 그리기를 가둬, 안의 포스터·좌석이 페이지 폭을 넓히지 않게 했습니다.

## 보안 헤더 (nginx)

| 헤더 | 값·이유 |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` (frame-ancestors를 모르는 오래된 브라우저용) |
| `Permissions-Policy` | 카메라·마이크·위치·결제·USB 끔 |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | `same-origin` |
| `server_tokens off` | 버전 숨김 |

**CSP와 생성형 그래픽**: 실제 컨테이너에서 확인한 결과 `style-src 'self'`는 인라인 `style` **속성**을 막습니다(`style-src-attr` 위반). CSSOM으로 속성을 바꾸는 것(`el.style.x = …`)은 막지 않습니다. 미리내 마당은 둘 다 쓰지 않습니다. 포스터 색은 SVG 표현 속성(`fill`, `stroke`)으로, 좌석 등급 색은 클래스(`g0`~`g3`)와 CSS 변수로, 진행 막대는 `<progress>`의 `value` 속성으로 표현해 CSP를 느슨하게 풀지 않았습니다.

캐시: `/assets/*` 1년 immutable, `/posters/*` 하루 + 재검증, `index.html`·SPA 경로 no-cache, 그 밖의 루트 파일 1시간. gzip은 텍스트 형식에만. `GET`/`HEAD` 외 메서드는 403.

## 의존성

런타임: `react`, `react-dom`, `react-router`, `@fontsource/black-han-sans`, `@fontsource/ibm-plex-sans-kr`. 개발: `vite`, `@vitejs/plugin-react`, `typescript`, 타입 정의. UI 키트 없음.
