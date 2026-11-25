# 미리내 마당: 공연 예매 프론트엔드 (next)

콘서트·뮤지컬·연극·클래식 공연을 찾고, 관람일·회차를 고르고, 대기열을 거쳐 좌석을 골라 예매·취소하는 웹 화면입니다.
React + Vite + TypeScript로 만들고, 빌드한 정적 파일을 `nginx-unprivileged`로 서빙합니다.

- 화면 기준: `../docs/next/benchmark/03-screen-spec.md`(치수·색·글자 크기), 근거는 `02-design-basis.md`
- API 계약: `../docs/ARCHITECTURE.md` 4장(v3) + `../docs/next/API-v4.md`(v4 추가·변경)
- 공연·출연진·공연장·포스터는 모두 지어낸 것입니다. 다른 서비스의 로고·색·이미지·문구는 쓰지 않습니다.

## 화면과 주소

| 화면 | 주소 | 로그인 |
|---|---|---|
| 메인(배너·공지 띠·티켓 오픈 예정·랭킹·이번 주·모든 공연) | `/` | |
| 장르 | `/genre/concert` · `musical` · `play` · `classic` | |
| 랭킹 | `/ranking?genre=&period=` | |
| 티켓 오픈 예정 | `/open` | |
| 검색 | `/search?q=&genre=&status=&region=&sort=` | |
| 공연 상세(소개·출연진·공연장·예매/취소 안내 탭) | `/shows/:id` | |
| 대기 → 좌석 선택 → 예매 확인·결제 | `/book/:performanceId/queue` · `seats` · `confirm` | 필요 |
| 예매 완료 | `/complete` | |
| 로그인 / 회원가입 | `/login`, `/signup` | |
| 내 예매 / 회원 정보(모바일 '마이') | `/my/reservations`, `/my` | 필요 |
| 공지사항 목록·상세 | `/notices`, `/notices/:id` | |
| 이용안내·자주 묻는 질문 | `/help`, `/help/faq` | |
| 이용약관 / 개인정보처리방침 | `/policy/terms`, `/policy/privacy` | |

옛 주소는 새 주소로 넘깁니다: `/?genre=MUSICAL` → `/genre/musical`, `/?q=…` → `/search?q=…`, `/me/reservations`·`/lookup` → `/my/reservations`.

## 실행

### 개발 (백엔드 없이, 계약 v4 모의 API)

```bash
npm ci
npm run dev:mock      # http://localhost:5173
```

모의 API(`mock/server.ts`)는 `vite.config.ts`에서 mock 모드일 때만 불러오므로 프로덕션 번들에 들어가지 않습니다.
Docker 빌드 단계에서 `dist`에 모의 코드 흔적(조작 경로, 시연 계정)이 있으면 빌드를 멈춥니다.
모의 서버의 공연 18개는 백엔드 시드 1~18번과 같은 이름·공연장·좌석 배치·등급입니다(포스터 파일 이름 = 공연 id). 백엔드 시드에 추가된 19~68번 공연과 배너 7~16번째는 모의 서버에 아직 없습니다(그림 파일은 `public/`에 있음).

| 보고 싶은 상태 | 방법 |
|---|---|
| 로그인 | 시연 계정 `test@example.com` / `test1234`(모의 서버 전용, 예매 3건). 새로 가입해도 됩니다 |
| 긴 대기열 | 〈달빛 세탁소〉 첫 회차. 앞사람이 없어진 뒤에도 "곧 입장해요"로 몇 번 더 기다립니다 |
| 매진 회차 / 매진 공연 | 〈푸른 주파수〉 첫 회차 / 〈마지막 편지는 목요일에〉 |
| 오픈 예정(D-n, 카운트다운) | 〈구름 정거장〉(D-2), 〈미리내 청년 오케스트라〉, 〈두 번째 이사〉 |
| 판매 종료 | 〈물결 인디 페스티벌 2026〉 |
| `SEAT_TAKEN` | 좌석을 고른 뒤 `POST /api/__mock/steal` `{ "seatIds": [...] }` 후 선택 완료 |
| 좌석 확보 시간 만료 | 좌석 화면 주소에 `?shorthold=1` → 확보 20초 |
| 좌석 선택 시간 만료 | 대기 화면 주소에 `?shortadmit=1` → 입장 40초 |
| 임시 저장소(Redis) 장애 | `POST /api/__mock/redis?down=1` → 대기열·좌석·선점·확정이 `503 SERVICE_UNAVAILABLE`(`Retry-After: 5`). `?down=0`으로 복구 |
| v4가 없는 백엔드(v3) | `POST /api/__mock/v3?on=1` → 배너·공지·랭킹·배치 미리보기 `404`, v4 필드 없음. `?on=0`으로 복구 |
| `RATE_LIMITED` | 검색어 `ratelimit` |
| 목록 서버 오류 | 메인 주소에 `?fail=1` |
| `INVALID_CREDENTIALS` / `ACCOUNT_LOCKED` | 비밀번호를 틀리게 입력. 5번 틀리면 15분 잠금 |
| 세션 만료(401) | `POST /api/__mock/expire-session` 뒤 아무 요청 |
| `CSRF_INVALID` 재시도 | `POST /api/__mock/rotate-csrf` 뒤 변경 요청 |
| `BOOKING_LIMIT_EXCEEDED` | 같은 회차에 3석 예매한 뒤 2석 더 |
| 예매 확정 오류 | 계정 이메일 `ratelimit@test.kr`(429), `offline@test.kr`(연결 끊김), `expired@test.kr`(HOLD_EXPIRED), `fail@test.kr`(500) |

### 개발 (실제 백엔드)

```bash
npm run dev                                      # /api → http://localhost:8080
API_PROXY=http://localhost:8088 npm run dev      # 다른 백엔드
```

### 검사와 빌드

```bash
npm run typecheck
npm run build
npm audit --omit=dev
npm run preview      # http://localhost:4173, nginx와 같은 CSP 헤더를 붙여 프로덕션 빌드의 CSP 위반을 확인
```

`npm run preview`는 `nginx/security-headers.conf`의 CSP를 읽어 그대로 응답에 붙입니다. 모의 데이터로 프로덕션 빌드를 보려면 `npm run dev:mock`을 띄운 채 `API_PROXY=http://localhost:5173 npm run preview`.

### 컨테이너

```bash
docker build --build-arg APP_VERSION=next -t ticketing-frontend:next .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop ALL --security-opt no-new-privileges:true ticketing-frontend:next
```

- 멀티스테이지(node:24-alpine에서 빌드 → nginx-unprivileged 1.30 alpine-slim). 실행 사용자 uid/gid 101, 포트 8080, 쓰기 경로는 `/tmp` 하나.
- `GET /healthz` → `200 {"status":"ok"}`. `/api/`는 `backend:8080`(Docker 네트워크·쿠버네티스 Service 이름)으로 프록시합니다.

## 디자인 기준 (03 문서 요약)

| 항목 | 값 |
|---|---|
| 본문 폭 | 1200 고정(1280 이상), 좌우 여백 20/24/32 |
| 포스터 목록 | 5열(필터 있는 검색은 4열) / 4 / 3 / 2열, 포스터 3:4 |
| 목록 나누기 | 홈·장르의 전체 목록과 검색 결과는 20개씩 그리고 `더 보기 (n개 남음)`으로 20개씩 늘림(API는 한 번에 받음). 필터·정렬을 바꾸면 처음 20개. 누르면 새로 나온 첫 카드로 포커스. 펼친 개수·상태 칩·정렬은 방문 기록(history state)에 두어 상세에 갔다가 뒤로 오면 그대로, 스크롤 위치도 되살림. 랭킹·티켓 오픈 예정은 나누지 않음 |
| 색 | 흰 바탕, 글자 회색 4단계, 행동 색 청록 `#0A7C78` 하나, 경고 빨강 `#C8233A` 하나. 별 노랑 `#F2B200`은 로고의 별에만 |
| 글꼴 | Pretendard 하나(가변·다이내믹 서브셋, npm `pretendard` 번들). 굵기 400·600·700·800 |
| 모서리 | 머리표·좌석 4, 버튼·입력창·포스터 8, 상자·배너 12, 대화상자·하단 판 16, 칩·검색창 완전 둥금 |
| 그림자 | 떠 있는 것(펼침 상자·토스트·하단 판)에만. 카드·상자는 1px 선 |
| 움직임 | 150~200ms ease-out. 배너 5초 자동 넘김(마우스 올림·포커스·화면 밖·탭 숨김이면 멈춤, 일시정지 단추). `prefers-reduced-motion`이면 자동 넘김과 전환을 끔 |

토큰은 `src/styles.css` 맨 위 `:root`에 03 문서 이름 그대로 둡니다(`--c-*`, `--t-*`·`--ls-*`, `--s-*`, `--r-*`, `--shadow-*`).

## 이미지

| 종류 | 경로 | 크기 | 없을 때 |
|---|---|---|---|
| 포스터 | `public/posters/{id}.webp`, `{id}-sm.webp` | 896×1200, 448×600 | 생성형 포스터(SVG, 글자 없음) |
| 메인 배너 | `public/banners/banner-{showId}.webp`, `-sm.webp` | 1440×480, 1200×400 | 포스터 색(hue)으로 만든 어두운 2색 그라데이션 + 오른쪽 포스터. 모바일은 원래 포스터 카드 |
| 안내 그림 | `public/illust/illust-queue.webp` · `illust-empty.webp` · `illust-404.webp` | 800×800 | 아이콘 원(지름 64) |

- 어떤 파일이 있는지는 `vite.config.ts`가 빌드할 때 폴더를 읽어 가상 모듈(`virtual:poster-images`, `virtual:banner-images`, `virtual:illust-images`)로 만듭니다. 목록에 없는 파일은 요청하지 않으므로 404가 생기지 않습니다. 이미지를 넣으면 다시 빌드하면 됩니다.
- 배너 API의 `imageUrl`은 같은 출처의 `/banners/` 경로만 씁니다. 외부 주소는 쓰지 않습니다.
- 모바일(767px 이하)은 배너 칸에 포스터를 쓰므로 배너 그림을 아예 내려받지 않습니다.
- nginx는 세 폴더 모두 하루 캐시 후 재검증, 없는 파일은 404.

### 받은 그림을 넣는 방법

원본은 `.ref/images-incoming/`(저장소 밖)에 두고 변환본만 `public/`에 넣습니다. 2026-11-25에 받은 것을 이렇게 넣었습니다.

- 배너 6장(공연 15·4·1·6·8·12, 원본 1584×672)과 안내 그림 3장
- 추가 배너 10장(공연 33·21·34·37·52·56·42·32·68·45, 원본 3168×1344 = 21:9)
- 추가 포스터 50장(공연 19~68, 원본 1792×2400). 20번은 `poster-20_3eb6cf79.jpg`, 27번은 `poster-27_2620a5df.jpg`(사용자 선택본)

| 할 일 | 기준 |
|---|---|
| 가장자리 정리 | 종이 여백·테두리·옆에 덧붙은 색 띠를 빼고 안쪽 그림만 쓴다. 포스터 1~18번처럼 그림이 끝까지 차게 한다(손으로 찍은 듯한 경계까지 빼려고 여백 끝에서 14px 더 들어감) |
| 포스터 | 3:4로 맞춰 896×1200(품질 82), 448×600(품질 80) |
| 3:1로 자르기 | 원본 해상도 안에서 자르고 억지로 키우지 않는다. 큰 것 1440×480, 작은 것 1200×400. 21:9 원본은 가운데 띠를 자르되 주인공(시계탑 첨탑 등)이 잘리면 위아래로 옮긴다 |
| 글자 자리 대비 | 화면의 글자 그늘(`.hero__shade`)을 깐 상태에서 글자가 놓이는 칸(왼쪽 64px부터)의 대비를 잰다. 제목 3:1 이상, 부제·기간·장르(흰색 70~85%) 4.5:1 이상 |
| 밝은 배너 | 왼쪽이 밝아 대비가 모자라면 변환할 때 왼쪽만 밤하늘 남색으로 눌러 굽는다(코드는 그대로) |
| 용량 | WebP, 큰 것 300KB·작은 것 120KB·안내 그림 60KB 이하 |
| 안내 그림 | 1024 → 800×800, 흰 바탕이 끝까지인지 확인 |

## API (v4)와 v3 백엔드에서의 동작

API 호출은 `src/api.ts` 한 곳에 모으고, 자료형은 계약 v3 + v4 그대로 둡니다. v3 응답에 v4 필드가 없으면 `api.ts`에서 기본값을 채웁니다.

| v4 기능 | 엔드포인트가 없거나(404) 실패할 때 |
|---|---|
| 메인 배너 `GET /api/banners` | 판매 중 인기 공연 5개 + 가장 가까운 오픈 예정 1개로 배너를 만들어 보여 줌 |
| 공지 `GET /api/notices` | 메인 공지 띠를 숨김. 공지 화면은 "준비하고 있어요" 빈 상태 |
| 랭킹 `GET /api/rankings` | `GET /api/shows?sort=ranking`의 순서(전체 기간)로 대신하고 기준 시각·기간 단추·점유율을 숨김 |
| 배치 미리보기 `GET /api/performances/:id/layout` | 상세 공연장 섹션의 미리보기를 숨김 |
| `tagline`, `region`, `createdAt`, `venueInfo` | 한 줄 소개·지역 필터·지역 표기를 숨기고, 총 좌석은 첫 회차 등급별 좌석 합으로 계산 |
| `paymentMethod` | 기본값 `CARD`는 보내지 않음(계약: 없으면 CARD). 다른 수단을 고르면 보냄 |

화면에서 계산하는 것: D-day, 매진 임박(잔여 < 15%), 이번 주 공연, 최근 오픈, 검색 필터·정렬, 최근 검색어, 캘린더 파일(.ics), 취소 가능 기한.

## 예매 흐름의 동작

### 폴링

| 대상 | 보이는 탭 | 숨겨진 탭 | 429 | 5xx·연결 끊김 |
|---|---|---|---|---|
| 대기 상태 `GET /queue/status` | 서버 `pollAfterSeconds`(1~30초) | 10초(서버가 30초 무응답이면 대기에서 빼므로 멈추지 않음) | `Retry-After` | 화면을 그대로 두고 계속. `Retry-After`가 있으면(503 `SERVICE_UNAVAILABLE`은 5초) 그 간격, 없으면 5→10→20→30초. "지금 다시 시도" 단추 |
| 좌석 상태 `GET /performances/:id/seats` | 4초 | 멈춤, 다시 보이면 즉시 | `Retry-After` | 위와 같음. "좌석 상태가 최신이 아닐 수 있어요" 안내 |

### 오류별 반응

5xx는 코드 이름에 기대지 않고 상태 코드와 서버 `message`로 처리합니다. 임시 저장소(Redis) 장애 때 예매 진행 요청(대기열·좌석·선점·확정)은 `503 SERVICE_UNAVAILABLE` + `Retry-After`를 받고, 화면은 그 초만큼 다시 시도 단추를 잠갔다가 풉니다(폴링은 그 간격으로 다시 시도). Redis가 비워진 뒤의 `QUEUE_TOKEN_INVALID`·`HOLD_EXPIRED`는 아래 표대로 처리하고 로그인은 유지됩니다. 요청 번호는 5xx일 때만 보여 줍니다.

| 상황 | 화면의 반응 |
|---|---|
| 예매 진행 요청의 5xx(대기열 진입·선점·확정) | "잠시 후 다시 시도해 주세요" + 서버 문구 + 다시 시도 단추(`Retry-After` 동안 "N초 뒤에 다시 시도"로 잠금). 확정은 같은 `Idempotency-Key`로 재시도 |
| `QUEUE_TOKEN_INVALID` | 진행 상태를 지우고 대기열부터 다시(대기 화면에서는 "다시 줄 서기") |
| `QUEUE_NOT_ADMITTED` | 대기 화면으로 |
| 좌석 선택 남은 시간 끝 | 대화상자 "좌석 선택 시간이 지났어요" → 공연 정보로 |
| 좌석 확보 시간 끝 / `HOLD_EXPIRED` | 대화상자 "좌석 확보 시간이 지났어요" → 좌석 선택으로 |
| `SEAT_TAKEN` | 빠진 좌석을 열·번호로 알리고 선택에서 뺀 뒤 배치도 갱신. 폴링 중 남에게 넘어간 좌석도 같은 방식 |
| 5석째 선택 | 토스트 "한 번에 4석까지 고를 수 있어요" |
| `BOOKING_LIMIT_EXCEEDED` | 회차당 계정 4석 안내 + 내 예매 링크 |
| `RATE_LIMITED` / `ACCOUNT_LOCKED` | `Retry-After` 동안 단추 잠금, 남은 시간 표시 |

### 모의 결제

예매 확인 화면 안의 섹션입니다(화면 수는 그대로). 수단 이름만 고르는 라디오 카드 3개와 "실습용 모의 결제" 머리표, "카드 번호 같은 결제 정보는 받지 않아요" 문장만 둡니다. 카드 번호·유효기간 같은 입력칸은 없습니다. 필수 동의 2개를 체크해야 "결제하고 예매 완료"를 누를 수 있습니다.

## 보안·접근성

- 세션은 `HttpOnly` 쿠키, CSRF 토큰은 `api.ts` 메모리에만. 상태 변경 요청에 `X-CSRF-Token`, `403 CSRF_INVALID`면 한 번 재시도.
- 대기열 토큰·선점 정보는 `sessionStorage`(`mirinae.booking.v2`)에만, `X-Queue-Token` 헤더로만 보냅니다. `localStorage`에는 최근 검색어(최대 8개)와 확대 안내를 봤는지만 둡니다(개인정보 아님).
- 로그인 후 돌아갈 곳(`next`)은 앱 안의 경로만 허용합니다.
- `dangerouslySetInnerHTML` 없음, 인라인 `style` 속성 없음. 동적인 색(배너 대체 그라데이션, 생성형 포스터)은 SVG 속성으로, 좌석 크기·확대 단계·미리보기 크기는 클래스로 표현해 CSP를 그대로 둡니다.
- 건너뛰기 링크, 화면이 바뀌면 맨 위로 + `h1` 포커스, 문서 제목 갱신, 좌석 키보드 이동(화살표·Home/End·스페이스, roving tabindex), 남은 시간 낭독(1분·10초), 배너 슬라이드 역할·일시정지 단추, 대화상자는 `<dialog>`(포커스 가두기, Esc).

| nginx 보안 헤더 | 값 |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'` |
| `X-Content-Type-Options` / `Referrer-Policy` / `X-Frame-Options` | `nosniff` / `strict-origin-when-cross-origin` / `DENY` |
| `Permissions-Policy` | 카메라·마이크·위치·결제·USB 끔 |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | `same-origin` |

캐시: `/assets/*`(해시 붙은 JS·CSS·글꼴) 1년 immutable, `/posters/` `/banners/` `/illust/` 하루 + 재검증, `index.html` no-cache, 그 밖의 루트 파일 1시간.

## 폴더 구조

```
src/
├─ main.tsx              진입점(글꼴·스타일 불러오기)
├─ App.tsx               라우팅, 옛 주소 넘김, 화면 종류별 틀, 화면 전환 시 포커스
├─ shell.tsx             머리글(PC 3단·모바일), 하단 탭, 푸터, 예매 단계 머리글, 문서 제목
├─ api.ts                API 호출 + 계약 v3·v4 자료형, CSRF, 401 처리, v3 응답 보정
├─ data.ts               조회 훅(짧은 메모리 캐시), 랭킹 v3 대체, 미디어 쿼리
├─ auth.tsx              로그인 상태, 로그인 필요 화면, 돌아갈 경로 검사
├─ booking.ts            예매 진행 상태(sessionStorage)
├─ format.ts             날짜·기간·오픈 일시·D-day·금액 표기
├─ recent.ts / ics.ts    최근 검색어 / 티켓 오픈 캘린더 파일
├─ content.ts            이용안내·FAQ·정책 문구(정적)
├─ styles.css            토큰·기본·공통 틀·부품
├─ pages.css             화면별 배치
├─ components/
│  ├─ cards.tsx          포스터 카드, 격자, 가로 카드 줄, 섹션 제목 줄
│  ├─ HeroBanner.tsx     메인 배너 슬라이드(대체 표시 포함)
│  ├─ SeatMap.tsx        좌석 배치도(확대·축소·두 손가락, 말풍선, 키보드), 범례, 배치 미리보기
│  ├─ Calendar.tsx       관람일 달력
│  ├─ SearchBox.tsx      검색창 + 최근 검색어·많이 찾는 공연
│  ├─ overlay.tsx        대화상자, 하단 판, 토스트
│  ├─ bits.tsx           알림 상자, 머리표, 빈 상태·안내 그림, 시간 훅, 폴링 반복기
│  ├─ Icon.tsx / Logo.tsx  선 아이콘 / 글자 로고(별)
│  └─ Poster.tsx / PosterArt.tsx  생성형 포스터 / 포스터 자리
└─ pages/                화면(메인·장르·랭킹·오픈·검색·상세·대기·좌석·확인·완료·로그인·마이·공지·이용안내·정책·없는 페이지)
mock/server.ts           개발 전용 모의 API(계약 v4)
nginx/                   nginx.conf, security-headers.conf
public/licenses/         Pretendard OFL 1.1 라이선스 전문
```

## 의존성

런타임: `react`, `react-dom`, `react-router`, `pretendard`(SIL OFL 1.1). 개발: `vite`, `@vitejs/plugin-react`, `typescript`, 타입 정의. UI 키트 없음.
