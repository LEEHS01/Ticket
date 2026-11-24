# API 계약 v4 (v3에서 추가·변경되는 것만)

기준 문서는 `docs/ARCHITECTURE.md` 4장(v3)이다. 이 문서에 없는 것은 v3 그대로다.
새 화면 설계(`docs/next/benchmark/03-screen-spec.md` 6장)가 요구한 데이터 중 이번에 넣는 것만 정했다.
바꿔야 할 것이 있으면 임의로 바꾸지 말고 조율 세션에 알린다.

## 0. 결정 (조율 세션, 2026-11-24)

03 문서 8장의 "결정이 필요한 항목"은 모두 기본값으로 간다. 사용자가 바꾸면 여기를 고친다.

| 항목 | 결정 |
|---|---|
| 모의 결제 수단 | 넣는다. 예매 확인 화면 안의 섹션, 입력칸 없음. 서버는 고른 수단 이름만 기록한다 |
| 브랜드 색 | 청록 `#0A7C78` |
| 배너 데이터 | API(`GET /api/banners`), DB에 둔다 |
| 공지사항 | 넣는다. 시드로 만든다 |
| 모바일 하단 탭 | 홈·랭킹·티켓 오픈·내 예매·마이 |
| 출연진 표시 | 이니셜 원(사진 없음) |
| 글꼴 | Pretendard |
| 회원가입 동의 | 프론트에서만 확인(API 변경 없음) |

03 문서 6장의 "있으면 좋음" 중 넣는 것: 4(한 줄 소개), 5(공연장 지역), 6(좌석 배치 미리보기), 7(랭킹, 순위 변동은 제외), 11(등록 시각).
넣지 않는 것: 8(회차별 출연진), 9(예매 마감 시각), 10(대기 예상 시간), 12(구역 이름), 13(찜). UI는 이 요소들을 숨기거나 03 문서의 "없을 때" 방식으로 처리한다.

## 1. 자료형

```ts
// 추가
type Banner = {
  id: number;
  showId: number;
  eyebrow: string;            // 장르 등 짧은 말. 12자 이내
  title: string;              // 28자 이내
  subtitle: string;           // 40자 이내
  imageUrl: string;           // 프론트 정적 파일 경로. 예: "/banners/banner-15.webp" (2400×800)
  mobileImageUrl: string | null;
};

type NoticeCategory = "TICKET_OPEN" | "SERVICE";
type NoticeSummary = {
  id: number;
  category: NoticeCategory;
  title: string;
  pinned: boolean;
  publishedAt: string;
  ticketOpenAt: string | null;   // TICKET_OPEN일 때 오픈 일시
  showId: number | null;         // 관련 공연
};
type Notice = NoticeSummary & { body: string };   // 일반 텍스트(줄바꿈 포함). HTML 아님

type PaymentMethod = "CARD" | "EASY_PAY" | "BANK_TRANSFER";

type RankingItem = { rank: number; show: ShowSummary; share: number };   // share: 예매 점유율(%), 소수 첫째 자리

type SeatLayout = {              // 좌석 상태가 없는 배치 정보(미리보기용)
  performance: { id: number; showId: number; showTitle: string; venue: string; startsAt: string };
  grades: Grade[];
  rows: string[];
  seatsPerRow: number;
  aisleAfter: number[];
  seats: { row: string; number: number; grade: string }[];
};

// 변경: 필드 추가
type ShowSummary = /* v3 */ & {
  tagline: string;               // 한 줄 소개. 30자 이내
  region: string;                // 공연장 지역. 예: "서울", "경기", "부산" (가상 공연장에 맞춘 값)
  createdAt: string;             // 공연 등록 시각
};
type ShowDetail = /* v3 */ & {
  venueInfo: { name: string; region: string; seatCount: number };   // seatCount: 회차 하나의 좌석 수
};
type Reservation = /* v3 */ & { paymentMethod: PaymentMethod };
```

- `Banner.imageUrl`의 그림 파일은 프론트(`frontend/public/banners/`)에 있다. 백엔드는 경로 문자열만 준다. 외부 주소는 쓰지 않는다.
- 기존 예매(v3에서 만든 것)의 `paymentMethod`는 `CARD`로 본다.

## 2. 엔드포인트

**추가 (모두 토큰·로그인 불필요, GET)**

| 메서드·경로 | 요청 | 성공 | 실패 |
|---|---|---|---|
| `GET /api/banners` | — | `200 { banners: Banner[] }` 노출 기간 안의 것만, 정해 둔 순서대로, 최대 6개 | — |
| `GET /api/notices` | query: `category?`(NoticeCategory), `page?`(1부터, 기본 1), `size?`(기본 20, 최대 50) | `200 { notices: NoticeSummary[], page, totalPages, totalCount }` 고정 공지 먼저, 그다음 최신순 | `400 VALIDATION_ERROR` |
| `GET /api/notices/:id` | — | `200 Notice` | `404 NOTICE_NOT_FOUND` |
| `GET /api/rankings` | query: `genre?`(Genre), `period?`(`DAILY` \| `WEEKLY` \| `ALL`, 기본 `WEEKLY`) | `200 { rankedAt: string, period, items: RankingItem[] }` 최대 20개. 해당 기간 판매가 0인 공연은 제외 | `400 VALIDATION_ERROR` |
| `GET /api/performances/:id/layout` | — | `200 SeatLayout` | `404 PERFORMANCE_NOT_FOUND` |

- 랭킹의 판매량은 기간 안에 확정된 예매의 좌석 수(취소 제외)다. `DAILY`는 최근 24시간, `WEEKLY`는 최근 7일, `ALL`은 전체. `share`는 같은 조건(장르·기간)의 전체 판매 좌석 수에 대한 비율이다.
- `GET /api/performances/:id/layout`은 좌석 상태를 주지 않으므로 대기열 토큰이 필요 없다. 판매·선점 여부가 새어 나가면 안 된다.
- v3의 `ShowSummary.rank`와 `GET /api/shows?sort=ranking`은 그대로 둔다(전체 기간 기준).
- 랭킹의 `rank`는 1부터 빈틈없이 매긴다. 판매량이 같으면 공연 id가 작은 쪽이 앞이고, 동률도 서로 다른 번호를 받는다. `share`는 소수 첫째 자리로 반올림하므로 합이 정확히 100.0이 아닐 수 있다. `items[].show.rank`는 전체 기간 순위라 랭킹의 `rank`와 다를 수 있다.
- 공지 목록은 `page`가 마지막 쪽을 넘으면 오류가 아니라 빈 `notices`와 실제 `totalPages`를 준다. `page`·`size`가 0 이하이거나 숫자가 아니면 `400 VALIDATION_ERROR`.
- 게시 시각(`publishedAt`)이 아직 오지 않은 공지는 목록에 없고 상세도 `404 NOTICE_NOT_FOUND`다.
- 빈 결과의 형태: 배너 `{ banners: [] }`, 공지 `{ notices: [], page: 1, totalPages: 0, totalCount: 0 }`, 랭킹 `{ rankedAt, period, items: [] }`.
- 새 조회 엔드포인트는 정의되지 않은 쿼리 파라미터를 받으면 `400 VALIDATION_ERROR`를 준다.
- `SeatLayout.seats[]`에는 좌석 id가 없다. 좌석 선택은 입장한 뒤 `GET /api/performances/:id/seats`로 한다.

**변경**

| 메서드·경로 | 바뀌는 점 |
|---|---|
| `POST /api/reservations` | body에 `paymentMethod?: PaymentMethod` 추가(없으면 `CARD`). 정의되지 않은 값은 `400 VALIDATION_ERROR`. 응답 `Reservation`에 `paymentMethod` 포함 |
| `GET /api/me/reservations`, `POST /api/me/reservations/:code/cancel` | 응답 `Reservation`에 `paymentMethod` 포함 |
| `GET /api/shows`, `GET /api/shows/:id` | 응답에 `tagline`, `region`, `createdAt`(, 상세는 `venueInfo`) 포함. `GET /api/shows`에 query `region?` 추가(정확히 일치) |

## 3. 시드

- 배너 6개: 공연 15, 4, 1, 6, 8, 12 순서(04 문서의 배너 그림과 같은 공연). `imageUrl`은 `/banners/banner-{showId}.webp`, `mobileImageUrl`은 `null`.
- 공지: 오픈 예정 공연마다 `TICKET_OPEN` 1건(공연과 연결, 오픈 일시 포함), `SERVICE` 3건(그중 1건 고정). 재실행해도 중복되지 않게 한다.
- 공연 18개 모두에 `tagline`과 `region`을 넣는다. 지역은 가상 공연장별로 고정하고 3~4개 지역이 섞이게 한다.
- 문구는 모두 새로 쓴다. 다른 서비스의 문구를 가져오지 않는다.

## 4. 캐시와 응답 헤더

- 새 GET 엔드포인트의 응답 헤더는 v3와 같다(`Cache-Control: no-store`). 나중에 CDN을 앞에 둘 때 조정한다.
