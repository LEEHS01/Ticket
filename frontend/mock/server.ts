// 개발 전용 모의 API (계약 v3 + v4). `npm run dev:mock`일 때만 Vite 개발 서버에 붙는다.
// vite.config.ts에서 mock 모드일 때만 동적 import되므로 브라우저 번들(dist)에는 들어가지 않는다.
// 공연 18개는 백엔드 시드(backend/.../migrate/Seeder.java)와 같은 이름·공연장·배치·등급이다(포스터 파일 이름 = 공연 id).
// 한 줄 소개·지역·배너·공지 문구는 v4 시드 요건(docs/next/API-v4.md 3장)에 맞춰 새로 쓴 것이다.
//
// 상태를 화면에서 확인하는 방법
//   대기열       : 모든 회차가 대기(WAITING)로 시작해 몇 번 폴링하면 입장. 〈달빛 세탁소〉 첫 회차는 대기가 길고,
//                  앞사람이 없어진 뒤에도 position 0인 WAITING으로 몇 번 더 기다린다.
//   SEAT_TAKEN   : POST /api/__mock/steal { seatIds } 로 좌석을 다른 사람이 선점한 것처럼 만든다.
//   선점 만료    : 좌석 화면 주소에 ?shorthold=1 → 선점 시간이 20초
//   입장 만료    : 대기 화면 주소에 ?shortadmit=1 → 좌석 선택 시간이 40초
//   계정(v3)     : 시연 계정 test@example.com / test1234 (모의 전용). 5번 틀리면 15분 잠금(ACCOUNT_LOCKED)
//   예매 확정    : 계정 이메일이 ratelimit@test.kr → 429, offline@test.kr → 연결 끊김, expired@test.kr → HOLD_EXPIRED,
//                  fail@test.kr → 500. 같은 회차 4석 초과 → BOOKING_LIMIT_EXCEEDED
//   세션 만료    : POST /api/__mock/expire-session → 모든 세션이 비로그인으로(다음 요청이 401 UNAUTHENTICATED)
//   CSRF 교체    : POST /api/__mock/rotate-csrf → 다음 변경 요청이 403 CSRF_INVALID → 프론트가 토큰을 다시 받아 재시도
//   임시 저장소 장애: POST /api/__mock/redis?down=1 → 예매 진행 요청(대기열·좌석·선점·확정)이 503. ?down=0으로 복구
//   v3 백엔드 흉내 : POST /api/__mock/v3?on=1 → v4 엔드포인트 404, v4 필드 없음. ?on=0으로 복구
//   목록         : 검색어 ratelimit → 429, 화면 주소 ?fail=1 → 500
//   다른 관객    : 좌석을 조회할 때마다 가끔 빈 좌석 하나가 다른 사람에게 선점·판매된다.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';

type Genre = 'CONCERT' | 'MUSICAL' | 'PLAY' | 'CLASSIC';
type SaleStatus = 'UPCOMING' | 'ON_SALE' | 'SOLD_OUT' | 'CLOSED';
type PaymentMethod = 'CARD' | 'EASY_PAY' | 'BANK_TRANSFER';
type Grade = { code: string; name: string; price: number };

type MSeat = { id: number; row: string; number: number; grade: string; sold: boolean; soldAt: number };
type MPerf = { id: number; showId: number; startsAt: string; rows: string[]; seatsPerRow: number; aisleAfter: number[]; seats: MSeat[]; busy?: boolean };
type MShow = {
  id: number; title: string; genre: Genre; venue: string; region: string; saleOpensAt: string; createdAt: string; tagline: string;
  ageRating: string; runningMinutes: number; cast: string[]; description: string; notices: string[];
  grades: Grade[]; poster: { seed: number; hue: number }; perfIds: number[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 오늘(한국 시간) 기준 n일 뒤 hh:mm KST를 UTC ISO로 */
function kst(days: number, hh: number, mm = 0): string {
  const now = new Date(Date.now() + 9 * HOUR);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hh - 9, mm)).toISOString();
}

// 결정적 난수(시드 데이터가 재시작해도 같도록)
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTICES = [
  '1인 1회 최대 4매까지 예매할 수 있습니다.',
  '좌석 선택 후 제한 시간 안에 예매를 완료하지 않으면 선택이 자동으로 해제됩니다.',
  '공연 시작 이후에는 예매를 취소할 수 없습니다.',
  '공연 시작 후에는 입장이 제한될 수 있습니다.',
];

// 백엔드 VenueLayout과 같은 배치(행 수 × 가장 긴 행 기준 격자, 실제 좌석이 없는 칸은 만들지 않음)
type Layout = 'SMALL' | 'MEDIUM' | 'FAN' | 'CUT_CORNERS';
const LAYOUTS: Record<Layout, { rows: number; perRow: number; aisle: number[]; exists: (r: number, c: number) => boolean }> = {
  SMALL: { rows: 8, perRow: 12, aisle: [6], exists: () => true },
  MEDIUM: { rows: 12, perRow: 18, aisle: [4, 14], exists: () => true },
  FAN: {
    rows: 10, perRow: 16, aisle: [5, 11],
    exists: (r, c) => {
      const width = Math.min(16, 8 + 2 * Math.floor(r / 2));
      const offset = (16 - width) / 2;
      return c > offset && c <= offset + width;
    },
  },
  CUT_CORNERS: {
    rows: 11, perRow: 16, aisle: [4, 12],
    exists: (r, c) => (r < 2 ? c > 2 && c <= 14 : r === 10 ? c > 1 && c < 16 : true),
  },
};

type SGrade = [code: string, name: string, price: number, rows: number];
type Seed = {
  title: string; genre: Genre; venue: string; open: [number, number, number?]; age: string; mins: number; cast: string[]; desc: string;
  layout: Layout; grades: SGrade[]; perfs: [day: number, hh: number, mm: number, sold: number][]; hue: number;
  tagline: string; createdDaysAgo: number; busyFirst?: boolean;
};

const REGION: Record<string, string> = {
  '누리 아트홀': '서울', '별무리 라이브홀': '서울', '물결 야외극장': '경기', '온새미로 극장': '서울', '다온 아트센터 대극장': '부산',
  '별빛 씨어터': '경기', '소금꽃 소극장': '서울', '나래 소극장': '서울', '모퉁이 극장': '대구', '하늘결 체임버홀': '서울', '미리내 콘서트홀': '경기',
};

const SEEDS: Seed[] = [
  // CONCERT
  { title: '새벽빛 밴드 단독 콘서트 〈푸른 주파수〉', genre: 'CONCERT', venue: '누리 아트홀', open: [-10, 20], age: '8세 이상', mins: 150, cast: ['새벽빛 밴드'],
    desc: '데뷔 5주년을 맞은 새벽빛 밴드의 단독 공연.\n새 앨범 수록곡과 대표곡을 밴드 편곡으로 들려줍니다.', layout: 'FAN',
    grades: [['VIP', 'VIP석', 154000, 2], ['R', 'R석', 132000, 4], ['S', 'S석', 99000, 0]], perfs: [[3, 19, 30, 1.0], [4, 18, 0, 0.6], [5, 17, 0, 0.35]], hue: 210,
    tagline: '다섯 해를 함께 달려온 새벽의 소리', createdDaysAgo: 24 },
  { title: '한여름 시티팝 나이트', genre: 'CONCERT', venue: '별무리 라이브홀', open: [-5, 14], age: '만 7세 이상', mins: 120, cast: ['솔바람 트리오', '모래시계 세션'],
    desc: '도시의 밤을 닮은 시티팝 무대.\n두 팀이 번갈아 무대에 오르고 마지막 곡은 함께 부릅니다.', layout: 'SMALL',
    grades: [['R', 'R석', 110000, 3], ['S', 'S석', 88000, 0]], perfs: [[9, 19, 0, 0.2], [10, 19, 0, 0.1]], hue: 30,
    tagline: '네온 불빛 아래 두 팀의 릴레이 무대', createdDaysAgo: 3 },
  { title: '물결 인디 페스티벌 2026', genre: 'CONCERT', venue: '물결 야외극장', open: [-40, 12], age: '전체 관람가', mins: 240, cast: ['달무리 밴드', '종이비행기', '늦은 오후'],
    desc: '강가 야외무대에서 열리는 이틀간의 인디 음악 축제.', layout: 'MEDIUM',
    grades: [['R', 'R석', 99000, 5], ['S', 'S석', 77000, 0]], perfs: [[-3, 15, 0, 0.7], [-2, 15, 0, 0.5]], hue: 140,
    tagline: '강바람과 함께한 이틀의 축제', createdDaysAgo: 50 },
  // MUSICAL
  { title: '뮤지컬 〈시간을 접는 소녀〉', genre: 'MUSICAL', venue: '온새미로 극장', open: [-14, 14], age: '8세 이상', mins: 160, cast: ['한소담', '도경민', '서하린', '류시온'],
    desc: '접힌 종이 한 장으로 하루를 되돌리는 소녀의 이야기.\n2막 구성, 인터미션 20분.', layout: 'MEDIUM',
    grades: [['VIP', 'VIP석', 160000, 3], ['R', 'R석', 140000, 4], ['S', 'S석', 110000, 0]], perfs: [[6, 19, 30, 0.45], [7, 14, 0, 0.55], [7, 19, 0, 0.3], [8, 15, 0, 0.25]], hue: 300,
    tagline: '종이 한 장으로 되돌리는 하루', createdDaysAgo: 30 },
  { title: '뮤지컬 〈등대지기의 노래〉', genre: 'MUSICAL', venue: '다온 아트센터 대극장', open: [-7, 14], age: '만 7세 이상', mins: 150, cast: ['윤재하', '백소담', '권도율'],
    desc: '외딴섬 등대를 지키는 사람들의 사계절을 노래로 엮은 창작 뮤지컬.', layout: 'CUT_CORNERS',
    grades: [['VIP', 'VIP석', 150000, 2], ['R', 'R석', 130000, 4], ['S', 'S석', 90000, 0]], perfs: [[12, 19, 30, 0.15], [13, 14, 0, 0.1], [13, 19, 0, 0.05]], hue: 190,
    tagline: '외딴섬 불빛이 들려주는 사계절', createdDaysAgo: 5 },
  { title: '뮤지컬 〈구름 정거장〉', genre: 'MUSICAL', venue: '별빛 씨어터', open: [2, 14], age: '전체 관람가', mins: 100, cast: ['나은솔', '차민결'],
    desc: '구름 위 작은 정거장에서 길 잃은 기차를 기다리는 가족 뮤지컬.', layout: 'FAN',
    grades: [['VIP', 'VIP석', 120000, 2], ['R', 'R석', 100000, 3], ['S', 'S석', 70000, 0]], perfs: [[20, 19, 30, 0], [21, 14, 0, 0]], hue: 260,
    tagline: '구름 위 정거장에서 기다리는 작은 기차', createdDaysAgo: 2 },
  // PLAY
  { title: '연극 〈마지막 편지는 목요일에〉', genre: 'PLAY', venue: '소금꽃 소극장', open: [-12, 14], age: '13세 이상', mins: 100, cast: ['임하늘', '정새온'],
    desc: '매주 목요일 도착하는 편지와, 그 편지를 기다리는 두 사람의 이야기.', layout: 'SMALL',
    grades: [['R', 'R석', 55000, 3], ['S', 'S석', 45000, 0]], perfs: [[2, 20, 0, 1.0]], hue: 15,
    tagline: '목요일마다 도착하는 편지 한 통', createdDaysAgo: 20 },
  { title: '연극 〈옥탑방 천문대〉', genre: 'PLAY', venue: '나래 소극장', open: [-6, 14], age: '13세 이상', mins: 110, cast: ['조윤새', '남궁현', '오세린'],
    desc: '옥탑방에 망원경을 들여놓은 세 친구의 좌충우돌 코미디.', layout: 'SMALL',
    grades: [['R', 'R석', 50000, 4], ['S', 'S석', 40000, 0]], perfs: [[4, 20, 0, 0.4], [5, 16, 0, 0.2], [5, 19, 30, 0.3]], hue: 50,
    tagline: '옥상 망원경으로 본 세 친구의 밤', createdDaysAgo: 12 },
  { title: '연극 〈두 번째 이사〉', genre: 'PLAY', venue: '모퉁이 극장', open: [12, 14], age: '15세 이상', mins: 95, cast: ['배다온', '모하담'],
    desc: '같은 집으로 두 번 이사 온 사람과, 그 집에 남아 있던 기억들.', layout: 'CUT_CORNERS',
    grades: [['R', 'R석', 60000, 3], ['S', 'S석', 45000, 0]], perfs: [[30, 19, 30, 0]], hue: 95,
    tagline: '같은 집, 두 번의 이사, 남겨진 기억', createdDaysAgo: 1 },
  // CLASSIC
  { title: '가을 실내악의 밤', genre: 'CLASSIC', venue: '하늘결 체임버홀', open: [-8, 10], age: '8세 이상', mins: 110, cast: ['하늘결 현악 사중주'],
    desc: '현악 사중주로 듣는 가을 밤의 실내악 프로그램.', layout: 'FAN',
    grades: [['R', 'R석', 80000, 3], ['S', 'S석', 60000, 4], ['A', 'A석', 40000, 0]], perfs: [[10, 19, 30, 0.3]], hue: 25,
    tagline: '현악 넷이 그리는 가을밤 풍경', createdDaysAgo: 14 },
  { title: '미리내 청년 오케스트라 정기 연주회', genre: 'CLASSIC', venue: '미리내 콘서트홀', open: [6, 10], age: '8세 이상', mins: 120, cast: ['미리내 청년 오케스트라', '지휘 한소율'],
    desc: '청년 연주자 80명이 들려주는 교향곡의 밤.', layout: 'MEDIUM',
    grades: [['R', 'R석', 70000, 4], ['S', 'S석', 50000, 4], ['A', 'A석', 30000, 0]], perfs: [[25, 19, 30, 0], [26, 17, 0, 0]], hue: 220,
    tagline: '청년 연주자 80명의 교향곡', createdDaysAgo: 4 },
  { title: '피아노 리사이틀 〈물의 기억〉', genre: 'CLASSIC', venue: '하늘결 체임버홀', open: [-3, 10], age: '8세 이상', mins: 90, cast: ['피아니스트 서윤슬'],
    desc: '물을 주제로 고른 소품들로 꾸민 피아노 독주회.', layout: 'FAN',
    grades: [['R', 'R석', 70000, 4], ['S', 'S석', 50000, 0]], perfs: [[15, 19, 30, 0.12]], hue: 175,
    tagline: '잔잔한 물결을 닮은 피아노 소품들', createdDaysAgo: 9 },
  // 추가 공연(13~18)
  { title: '노을빛 재즈 쿼텟 〈밤 열한 시〉', genre: 'CONCERT', venue: '별무리 라이브홀', open: [-6, 14], age: '8세 이상', mins: 110, cast: ['노을빛 재즈 쿼텟'],
    desc: '늦은 밤에 어울리는 곡들로 꾸민 재즈 쿼텟의 라이브. 스탠더드와 자작곡을 번갈아 연주합니다.', layout: 'SMALL',
    grades: [['R', 'R석', 77000, 3], ['S', 'S석', 55000, 0]], perfs: [[1, 20, 0, 0.45], [2, 20, 0, 0.3]], hue: 245,
    tagline: '하루의 끝에 듣는 네 대의 악기', createdDaysAgo: 16 },
  { title: '겨울맞이 포크 콘서트 〈첫눈 오는 날〉', genre: 'CONCERT', venue: '누리 아트홀', open: [-9, 10], age: '8세 이상', mins: 120, cast: ['한낮의 기타', '은하수 듀오'],
    desc: '통기타와 목소리만으로 채우는 겨울맞이 포크 무대.', layout: 'FAN',
    grades: [['VIP', 'VIP석', 99000, 2], ['R', 'R석', 88000, 4], ['S', 'S석', 66000, 0]], perfs: [[11, 18, 0, 0.25], [12, 19, 30, 0.15]], hue: 200,
    tagline: '통기타 두 대로 맞는 첫눈', createdDaysAgo: 18 },
  { title: '뮤지컬 〈달빛 세탁소〉', genre: 'MUSICAL', venue: '온새미로 극장', open: [-8, 14], age: '8세 이상', mins: 155, cast: ['강이든', '문가람', '설나래'],
    desc: '밤에만 문을 여는 세탁소에 저마다의 사연이 담긴 빨래가 모여드는 창작 뮤지컬.\n2막 구성, 인터미션 15분.', layout: 'MEDIUM',
    grades: [['VIP', 'VIP석', 150000, 3], ['R', 'R석', 130000, 4], ['S', 'S석', 99000, 0]], perfs: [[8, 19, 30, 0.5], [9, 14, 0, 0.65], [9, 19, 0, 0.4], [10, 15, 0, 0.2]], hue: 330,
    tagline: '밤에만 문을 여는 세탁소 이야기', createdDaysAgo: 22, busyFirst: true },
  { title: '연극 〈버스는 여덟 시에 떠난다〉', genre: 'PLAY', venue: '모퉁이 극장', open: [-5, 14], age: '13세 이상', mins: 100, cast: ['진서우', '하도윤', '민채아'],
    desc: '막차를 기다리는 시골 정류장에서 처음 만난 세 사람의 하룻밤.', layout: 'CUT_CORNERS',
    grades: [['R', 'R석', 55000, 4], ['S', 'S석', 44000, 0]], perfs: [[0, 20, 0, 0.7], [1, 20, 0, 0.35], [2, 16, 0, 0.1]], hue: 70,
    tagline: '막차를 기다리던 세 사람의 하룻밤', createdDaysAgo: 11 },
  { title: '첼로와 피아노의 밤 〈긴 겨울의 노래〉', genre: 'CLASSIC', venue: '하늘결 체임버홀', open: [-4, 10], age: '8세 이상', mins: 100, cast: ['첼리스트 하온결', '피아니스트 길한별'],
    desc: '첼로와 피아노로 듣는 겨울의 소나타와 소품.', layout: 'FAN',
    grades: [['R', 'R석', 70000, 3], ['S', 'S석', 50000, 4], ['A', 'A석', 30000, 0]], perfs: [[11, 17, 0, 0.15]], hue: 160,
    tagline: '첼로와 피아노가 건네는 겨울 인사', createdDaysAgo: 8 },
  { title: '뮤지컬 〈고양이 우체부〉', genre: 'MUSICAL', venue: '별빛 씨어터', open: [-7, 14], age: '36개월 이상', mins: 80, cast: ['봉하람', '채도담'],
    desc: '편지를 배달하는 고양이와 동네 아이들의 모험을 그린 가족 뮤지컬.', layout: 'FAN',
    grades: [['VIP', 'VIP석', 80000, 2], ['R', 'R석', 66000, 3], ['S', 'S석', 44000, 0]], perfs: [[5, 14, 0, 0.55], [6, 11, 0, 0.3], [6, 14, 0, 0.6]], hue: 110,
    tagline: '고양이가 배달하는 동네 편지', createdDaysAgo: 10 },
];

const shows: MShow[] = [];
const perfs = new Map<number, MPerf>();
let seatSeq = 1;
let perfSeq = 101;

SEEDS.forEach((s, i) => {
  const showId = i + 1;
  const rand = rng(showId * 7919);
  const L = LAYOUTS[s.layout];
  const rowNames = Array.from({ length: L.rows }, (_, k) => String.fromCharCode(65 + k));
  const saleOpensAt = kst(s.open[0], s.open[1], s.open[2] ?? 0);
  const opened = Date.parse(saleOpensAt);
  const perfIds: number[] = [];
  // 행 → 등급: 앞에서부터 rows만큼, 0이면 나머지
  const gradeOfRow = (r: number) => {
    let acc = 0;
    for (const [code, , , rows] of s.grades) {
      if (rows === 0) return code;
      acc += rows;
      if (r < acc) return code;
    }
    return s.grades.at(-1)![0];
  };
  s.perfs.forEach(([d, hh, mm, ratio]) => {
    const id = perfSeq++;
    const seats: MSeat[] = [];
    rowNames.forEach((row, ri) => {
      for (let n = 1; n <= L.perRow; n++) {
        if (!L.exists(ri, n)) continue;
        const sold = ratio >= 1 || rand() < ratio;
        // 판매 시각: 오픈 이후 지금까지 고르게(랭킹 기간 계산용)
        const soldAt = sold ? opened + rand() * Math.max(HOUR, Date.now() - opened) : 0;
        seats.push({ id: seatSeq++, row, number: n, grade: gradeOfRow(ri), sold, soldAt });
      }
    });
    perfs.set(id, { id, showId, startsAt: kst(d, hh, mm), rows: rowNames, seatsPerRow: L.perRow, aisleAfter: L.aisle, seats, busy: s.busyFirst && perfIds.length === 0 });
    perfIds.push(id);
  });
  shows.push({
    id: showId, title: s.title, genre: s.genre, venue: s.venue, region: REGION[s.venue] ?? '서울', saleOpensAt,
    createdAt: new Date(Date.now() - s.createdDaysAgo * DAY).toISOString(), tagline: s.tagline,
    ageRating: s.age, runningMinutes: s.mins, cast: s.cast, description: s.desc, notices: NOTICES,
    grades: s.grades.map(([code, name, price]) => ({ code, name, price })), poster: { seed: 1000 + showId * 37, hue: s.hue }, perfIds,
  });
});

// ── v4: 배너·공지 시드 ──
const BANNERS = [
  { showId: 15, eyebrow: '뮤지컬', title: '달빛 세탁소', subtitle: '보름달 뜨는 밤, 잃어버린 마음을 빨아 드려요' },
  { showId: 4, eyebrow: '뮤지컬', title: '시간을 접는 소녀', subtitle: '접힌 종이 한 장이 하루를 되돌린다면' },
  { showId: 1, eyebrow: '콘서트', title: '새벽빛 밴드 〈푸른 주파수〉', subtitle: '데뷔 5주년, 새 앨범을 처음 무대에서' },
  { showId: 6, eyebrow: '가족 뮤지컬 · 오픈 예정', title: '구름 정거장', subtitle: '구름 위 작은 기차를 함께 기다려요' },
  { showId: 8, eyebrow: '연극', title: '옥탑방 천문대', subtitle: '망원경 하나로 시작된 세 친구의 밤' },
  { showId: 12, eyebrow: '클래식', title: '피아노 리사이틀 〈물의 기억〉', subtitle: '물결을 닮은 소품으로 꾸민 독주회' },
].map((b, i) => ({ id: i + 1, ...b, imageUrl: `/banners/banner-${b.showId}.webp`, mobileImageUrl: null }));

type MNotice = { id: number; category: 'TICKET_OPEN' | 'SERVICE'; title: string; pinned: boolean; publishedAt: string; ticketOpenAt: string | null; showId: number | null; body: string };
const noticeList: MNotice[] = [];
(() => {
  let id = 1;
  noticeList.push({
    id: id++, category: 'SERVICE', pinned: true, title: '미리내 마당은 실습용 가상 예매 서비스예요', publishedAt: new Date(Date.now() - 30 * DAY).toISOString(),
    ticketOpenAt: null, showId: null,
    body: '미리내 마당은 클라우드 인프라 실습을 위해 만든 가상 공연 예매 서비스예요.\n\n공연·출연진·공연장·포스터는 모두 지어낸 것이고, 결제 단계는 모의 결제라 실제 돈이 오가지 않아요.\n예매와 취소는 실제 서비스처럼 동작하니 자유롭게 써 보세요.',
  });
  noticeList.push({
    id: id++, category: 'SERVICE', pinned: false, title: '연말 고객센터 운영 시간 안내', publishedAt: new Date(Date.now() - 4 * DAY).toISOString(), ticketOpenAt: null, showId: null,
    body: '연말 기간에도 고객센터는 평일 10:00–18:00에 운영해요.\n실습 서비스라 전화·채팅 상담은 하지 않고, 이용안내와 자주 묻는 질문에서 대부분의 답을 찾을 수 있어요.',
  });
  noticeList.push({
    id: id++, category: 'SERVICE', pinned: false, title: '좌석 선택 화면이 새로워졌어요', publishedAt: new Date(Date.now() - 1 * DAY).toISOString(), ticketOpenAt: null, showId: null,
    body: '좌석 배치도를 크게·작게 볼 수 있고, 모바일에서는 두 손가락으로 확대할 수 있어요.\n좌석에 마우스를 올리면 열·번호와 가격이 바로 보여요.',
  });
  for (const s of shows) {
    if (Date.parse(s.saleOpensAt) <= Date.now()) continue;
    noticeList.push({
      id: id++, category: 'TICKET_OPEN', pinned: false, title: `${s.title} 티켓 오픈 안내`, publishedAt: s.createdAt, ticketOpenAt: s.saleOpensAt, showId: s.id,
      body: `${s.title}의 티켓 오픈 일정을 알려 드려요.\n\n공연장: ${s.venue}\n관람 등급: ${s.ageRating}\n\n오픈 시각이 지나면 공연 상세 화면에서 바로 예매할 수 있어요. 한 계정은 회차마다 4석까지 예매할 수 있어요.`,
    });
  }
})();
const sortedNotices = () =>
  [...noticeList].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishedAt.localeCompare(a.publishedAt));
const noticeSummary = ({ body: _b, ...rest }: MNotice) => (void _b, rest);

// ── 선점·대기열 상태 ──
type QEntry = { userId: number; perfId: number; status: 'WAITING' | 'ADMITTED'; position: number; admittedUntil: number | null; lastPoll: number; zeroPolls: number; admitMs: number };
const queue = new Map<string, QEntry>();
type MHold = { holdId: string; token: string; perfId: number; seatIds: number[]; expiresAt: number };
const holds = new Map<string, MHold>();
const seatHold = new Map<number, { holdId: string | null; until: number }>(); // holdId null = 다른 관객
const idem = new Map<string, { status: number; body: unknown }>();

type MRes = { code: string; userId: number; perfId: number; seatIds: number[]; name: string; email: string; status: 'CONFIRMED' | 'CANCELLED'; createdAt: string; cancelledAt: string | null; paymentMethod: PaymentMethod };
const reservations = new Map<string, MRes>();

// 모의 전용 스위치
let redisDown = false;
let v3Mode = false;

// ── 계정·세션 (v3) ──
// 개발용 시연 계정: test@example.com / test1234 (모의 서버 전용. 프로덕션 번들에는 들어가지 않는다)
type MUser = { id: number; email: string; name: string; password: string; fails: number; lockedUntil: number };
const users = new Map<string, MUser>();
let userSeq = 1;
users.set('test@example.com', { id: userSeq++, email: 'test@example.com', name: '김하늘', password: 'test1234', fails: 0, lockedUntil: 0 });
type MSess = { userId: number | null; csrf: string };
const sessions = new Map<string, MSess>();
const newCsrf = () => randomBytes(24).toString('base64url');
const userById = (id: number | null) => [...users.values()].find((u) => u.id === id);

const now = () => Date.now();
const show = (id: number) => shows.find((s) => s.id === id);

function heldBy(seatId: number): { holdId: string | null } | null {
  const h = seatHold.get(seatId);
  if (!h) return null;
  if (h.until <= now()) {
    seatHold.delete(seatId);
    return null;
  }
  return { holdId: h.holdId };
}

function perfStatus(p: MPerf): SaleStatus {
  const s = show(p.showId)!;
  if (now() < Date.parse(s.saleOpensAt)) return 'UPCOMING';
  if (now() >= Date.parse(p.startsAt)) return 'CLOSED';
  if (p.seats.every((x) => x.sold)) return 'SOLD_OUT';
  return 'ON_SALE';
}

function showStatus(s: MShow): SaleStatus {
  const ps = s.perfIds.map((id) => perfStatus(perfs.get(id)!));
  if (ps.every((x) => x === 'CLOSED')) return 'CLOSED';
  if (ps.includes('UPCOMING')) return 'UPCOMING';
  const open = ps.filter((x) => x !== 'CLOSED');
  if (open.every((x) => x === 'SOLD_OUT')) return 'SOLD_OUT';
  return 'ON_SALE';
}

function soldCount(s: MShow, since = 0) {
  return s.perfIds.reduce((n, id) => n + perfs.get(id)!.seats.filter((x) => x.sold && x.soldAt >= since).length, 0);
}

function summary(s: MShow, rank: number | null) {
  const ps = s.perfIds.map((id) => perfs.get(id)!);
  const sellable = ps.filter((p) => perfStatus(p) === 'ON_SALE');
  return {
    id: s.id, title: s.title, genre: s.genre, venue: s.venue,
    firstStartsAt: ps[0]!.startsAt, lastStartsAt: ps.at(-1)!.startsAt, saleOpensAt: s.saleOpensAt,
    minPrice: Math.min(...s.grades.map((g) => g.price)), maxPrice: Math.max(...s.grades.map((g) => g.price)),
    status: showStatus(s),
    remainingSeats: sellable.reduce((n, p) => n + p.seats.filter((x) => !x.sold).length, 0),
    totalSeats: ps.reduce((n, p) => n + p.seats.length, 0),
    rank, poster: s.poster,
    ...(v3Mode ? {} : { tagline: s.tagline, region: s.region, createdAt: s.createdAt }),
  };
}

function ranks(): Map<number, number | null> {
  const sorted = [...shows].sort((a, b) => soldCount(b) - soldCount(a));
  const m = new Map<number, number | null>();
  sorted.forEach((s, i) => m.set(s.id, soldCount(s) > 0 ? i + 1 : null));
  return m;
}

function seatView(p: MPerf, token: string | null) {
  const myHold = [...holds.values()].find((h) => h.token === token && h.perfId === p.id && h.expiresAt > now()) ?? null;
  return p.seats.map((x) => {
    let status: 'AVAILABLE' | 'HELD' | 'SOLD' | 'MINE' = 'AVAILABLE';
    if (x.sold) status = 'SOLD';
    else {
      const h = heldBy(x.id);
      if (h) status = myHold && h.holdId === myHold.holdId ? 'MINE' : 'HELD';
    }
    return { id: x.id, row: x.row, number: x.number, grade: x.grade, status };
  });
}

function holdJson(h: MHold) {
  const p = perfs.get(h.perfId)!;
  const s = show(p.showId)!;
  const total = h.seatIds.reduce((n, id) => {
    const seat = p.seats.find((x) => x.id === id)!;
    return n + s.grades.find((g) => g.code === seat.grade)!.price;
  }, 0);
  return { holdId: h.holdId, seatIds: h.seatIds, totalPrice: total, expiresAt: new Date(h.expiresAt).toISOString() };
}

function releaseHold(h: MHold) {
  for (const id of h.seatIds) if (seatHold.get(id)?.holdId === h.holdId) seatHold.delete(id);
  holds.delete(h.holdId);
}

function mask(email: string) {
  const [l = '', d = ''] = email.split('@');
  return `${l.slice(0, 2)}***@${d}`;
}

function resJson(r: MRes) {
  const p = perfs.get(r.perfId)!;
  const s = show(p.showId)!;
  const seats = r.seatIds.map((id) => {
    const x = p.seats.find((y) => y.id === id)!;
    return { row: x.row, number: x.number, grade: x.grade, price: s.grades.find((g) => g.code === x.grade)!.price };
  });
  return {
    code: r.code, show: { id: s.id, title: s.title, venue: s.venue }, performance: { id: p.id, startsAt: p.startsAt },
    seats, totalPrice: seats.reduce((n, x) => n + x.price, 0), name: r.name, emailMasked: mask(r.email),
    status: r.status, createdAt: r.createdAt, cancelledAt: r.cancelledAt,
    ...(v3Mode ? {} : { paymentMethod: r.paymentMethod }),
  };
}

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () => Array.from(randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join('');

// 조회용 예매 세 건(test@example.com): 관람 예정 2, 취소 1
(() => {
  const p1 = perfs.get(shows[14]!.perfIds[1]!)!; // 달빛 세탁소 2회차
  const s1 = p1.seats.filter((x) => x.sold).slice(0, 2);
  reservations.set('AP7K2M9QXD4R', { code: 'AP7K2M9QXD4R', userId: 1, perfId: p1.id, seatIds: s1.map((x) => x.id), name: '김하늘', email: 'test@example.com', status: 'CONFIRMED', createdAt: new Date(now() - 2 * DAY).toISOString(), cancelledAt: null, paymentMethod: 'EASY_PAY' });
  const p2 = perfs.get(shows[7]!.perfIds[0]!)!; // 옥탑방 천문대
  const s2 = p2.seats.filter((x) => x.sold).slice(0, 1);
  reservations.set('HWQ4N8RTZC2K', { code: 'HWQ4N8RTZC2K', userId: 1, perfId: p2.id, seatIds: s2.map((x) => x.id), name: '김하늘', email: 'test@example.com', status: 'CONFIRMED', createdAt: new Date(now() - 9 * DAY).toISOString(), cancelledAt: null, paymentMethod: 'CARD' });
  const p3 = perfs.get(shows[3]!.perfIds[0]!)!; // 시간을 접는 소녀(취소)
  const s3 = p3.seats.filter((x) => !x.sold).slice(0, 2);
  reservations.set('M7RD2QK9WX3P', { code: 'M7RD2QK9WX3P', userId: 1, perfId: p3.id, seatIds: s3.map((x) => x.id), name: '김하늘', email: 'test@example.com', status: 'CANCELLED', createdAt: new Date(now() - 6 * DAY).toISOString(), cancelledAt: new Date(now() - 5 * DAY).toISOString(), paymentMethod: 'BANK_TRANSFER' });
})();

// ── HTTP ──
function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
const fail = (code: string, message: string, details?: unknown) => ({ error: { code, message, requestId: randomUUID(), ...(details ? { details } : {}) } });

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 16 * 1024) reject(new Error('too large'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 대기열 상태를 요청 시점에 전진시킨다(계약 3.2.1처럼 스케줄러 없이) */
function advance(token: string): QEntry | null {
  const q = queue.get(token);
  if (!q) return null;
  if (q.status === 'WAITING' && now() - q.lastPoll > 30_000) {
    queue.delete(token);
    return null;
  }
  if (q.status === 'ADMITTED' && q.admittedUntil! <= now()) {
    queue.delete(token);
    return null;
  }
  return q;
}

function queueJson(q: QEntry, token?: string) {
  return {
    ...(token ? { queueToken: token } : {}),
    status: q.status,
    position: q.status === 'ADMITTED' ? 0 : q.position,
    admittedUntil: q.admittedUntil ? new Date(q.admittedUntil).toISOString() : null,
    pollAfterSeconds: q.status === 'ADMITTED' ? 30 : 2,
  };
}

/** X-Queue-Token 확인. 실패 시 응답을 보내고 null */
function requireAdmitted(req: IncomingMessage, res: ServerResponse, perfId: number, sessionUserId: number): string | null {
  const token = req.headers['x-queue-token'];
  const q = typeof token === 'string' ? advance(token) : null;
  if (!q || typeof token !== 'string' || q.perfId !== perfId || q.userId !== sessionUserId) {
    send(res, 401, fail('QUEUE_TOKEN_INVALID', '대기열 정보가 만료되었습니다. 대기열에 다시 들어가 주세요.'));
    return null;
  }
  if (q.status !== 'ADMITTED') {
    send(res, 403, fail('QUEUE_NOT_ADMITTED', '아직 입장 순서가 아닙니다. 대기 화면에서 기다려 주세요.'));
    return null;
  }
  return token;
}

/** 다른 관객 흉내: 가끔 빈 좌석 하나를 선점하거나 판매 */
function otherAudience(p: MPerf) {
  if (Math.random() > 0.35) return;
  const free = p.seats.filter((x) => !x.sold && !heldBy(x.id));
  const pick = free[Math.floor(Math.random() * free.length)];
  if (!pick) return;
  if (Math.random() < 0.5) {
    pick.sold = true;
    pick.soldAt = now();
  } else seatHold.set(pick.id, { holdId: null, until: now() + 25_000 });
}

/** 세션 쿠키(HttpOnly). 없으면 익명 세션을 만든다 */
function sessionOf(req: IncomingMessage, res: ServerResponse): { sid: string; s: MSess } {
  const m = /(?:^|;\s*)mock_sid=([\w-]+)/.exec(req.headers.cookie ?? '');
  const found = m ? sessions.get(m[1]!) : undefined;
  if (m && found) return { sid: m[1]!, s: found };
  return newSession(res, null);
}

function newSession(res: ServerResponse, userId: number | null) {
  const sid = randomBytes(24).toString('base64url');
  const s: MSess = { userId, csrf: newCsrf() };
  sessions.set(sid, s);
  res.setHeader('Set-Cookie', `mock_sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);
  return { sid, s };
}

function authState(s: MSess) {
  const u = userById(s.userId);
  return { user: u ? { id: u.id, email: u.email, name: u.name } : null, csrfToken: s.csrf };
}

const flag = (url: URL, body: Record<string, unknown>, key: string) => {
  const q = url.searchParams.get(key);
  if (q !== null) return q === '1' || q === 'true';
  return body[key] === true;
};

/** 예매 진행 요청(대기열·좌석·선점·확정)인가: 임시 저장소 장애 때 503 대상 */
const isBookingPath = (method: string, path: string) =>
  path.startsWith('/queue') || /^\/performances\/\d+\/(seats|holds)$/.test(path) || path.startsWith('/holds/') || (method === 'POST' && path === '/reservations');

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://mock');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const referer = req.headers.referer ?? '';
  await sleep(150 + Math.random() * 300);
  let sess = sessionOf(req, res);

  // 모의 전용 조작
  if (method === 'POST' && path === '/__mock/expire-session') {
    for (const x of sessions.values()) x.userId = null;
    return send(res, 204);
  }
  if (method === 'POST' && path === '/__mock/rotate-csrf') {
    for (const x of sessions.values()) x.csrf = newCsrf();
    return send(res, 204);
  }
  if (method === 'POST' && path === '/__mock/redis') {
    redisDown = flag(url, await readJson(req).catch(() => ({})), 'down');
    return send(res, 200, { redisDown });
  }
  if (method === 'POST' && path === '/__mock/v3') {
    v3Mode = flag(url, await readJson(req).catch(() => ({})), 'on');
    return send(res, 200, { v3Mode });
  }

  // CSRF: GET·HEAD 외 모든 요청
  if (method !== 'GET' && method !== 'HEAD' && !path.startsWith('/__mock/') && req.headers['x-csrf-token'] !== sess.s.csrf) {
    return send(res, 403, fail('CSRF_INVALID', '보안 확인에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'));
  }
  const me = userById(sess.s.userId);
  const requireLogin = (): MUser | null => {
    if (me) return me;
    send(res, 401, fail('UNAUTHENTICATED', '로그인이 필요합니다. 다시 로그인해 주세요.'));
    return null;
  };

  // 임시 저장소(Redis) 장애: 예매 진행만 503, 둘러보기·로그인·내 예매는 그대로
  if (redisDown && isBookingPath(method, path)) {
    return send(res, 503, fail('SERVICE_UNAVAILABLE', '예매 처리 서버에 잠시 문제가 있어요. 잠시 후 다시 시도해 주세요.'));
  }

  // 인증
  if (method === 'GET' && path === '/auth/me') return send(res, 200, authState(sess.s));
  if (method === 'POST' && path === '/auth/signup') {
    const b = await readJson(req);
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!EMAIL_RE.test(email) || !name || name.length > 40) return send(res, 400, fail('VALIDATION_ERROR', '이메일과 이름(1~40자)을 확인해 주세요.'));
    if (password.length < 8 || password.length > 72) return send(res, 400, fail('VALIDATION_ERROR', '비밀번호는 8자 이상 72자 이하로 정해 주세요.'));
    if (users.has(email)) return send(res, 409, fail('EMAIL_TAKEN', '이미 가입된 이메일입니다. 로그인해 주세요.'));
    const u: MUser = { id: userSeq++, email, name, password, fails: 0, lockedUntil: 0 };
    users.set(email, u);
    sessions.delete(sess.sid);
    sess = newSession(res, u.id); // 로그인과 동시에 세션 재발급
    return send(res, 201, authState(sess.s));
  }
  if (method === 'POST' && path === '/auth/login') {
    const b = await readJson(req);
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const u = users.get(email);
    if (u && u.lockedUntil > now()) {
      const sec = Math.ceil((u.lockedUntil - now()) / 1000);
      return send(res, 429, fail('ACCOUNT_LOCKED', '로그인 시도가 여러 번 실패해 잠시 잠겼습니다.'), { 'Retry-After': String(sec) });
    }
    if (!u || u.password !== b.password) {
      if (u && ++u.fails >= 5) {
        u.fails = 0;
        u.lockedUntil = now() + 15 * 60_000;
      }
      return send(res, 401, fail('INVALID_CREDENTIALS', '이메일 또는 비밀번호가 맞지 않습니다.'));
    }
    u.fails = 0;
    sessions.delete(sess.sid);
    sess = newSession(res, u.id);
    return send(res, 200, authState(sess.s));
  }
  if (method === 'POST' && path === '/auth/logout') {
    sessions.delete(sess.sid);
    res.setHeader('Set-Cookie', 'mock_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return send(res, 204);
  }

  // 내 예매
  if (method === 'GET' && path === '/me/reservations') {
    const u = requireLogin();
    if (!u) return;
    const list = [...reservations.values()].filter((r) => r.userId === u.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return send(res, 200, { reservations: list.map(resJson) });
  }
  const cm = /^\/me\/reservations\/([A-Z0-9]+)\/cancel$/.exec(path);
  if (method === 'POST' && cm) {
    const u = requireLogin();
    if (!u) return;
    const r = reservations.get(cm[1]!);
    if (!r || r.userId !== u.id) return send(res, 404, fail('RESERVATION_NOT_FOUND', '예매를 찾을 수 없습니다.'));
    if (r.status === 'CANCELLED') return send(res, 409, fail('ALREADY_CANCELLED', '이미 취소된 예매입니다.'));
    const p = perfs.get(r.perfId)!;
    if (now() >= Date.parse(p.startsAt)) return send(res, 409, fail('PERFORMANCE_CLOSED', '이미 시작했거나 끝난 회차는 취소할 수 없습니다.'));
    r.status = 'CANCELLED';
    r.cancelledAt = new Date().toISOString();
    r.seatIds.forEach((id) => {
      const seat = p.seats.find((x) => x.id === id)!;
      seat.sold = false;
      seat.soldAt = 0;
    });
    return send(res, 200, resJson(r));
  }

  // 목록
  if (method === 'GET' && path === '/shows') {
    if (referer.includes('fail=1')) return send(res, 500, fail('INTERNAL_ERROR', '일시적인 문제로 공연 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
    const q = url.searchParams.get('q')?.trim() ?? '';
    if (q === 'ratelimit') return send(res, 429, fail('RATE_LIMITED', '요청이 너무 많습니다. 10초 뒤에 다시 시도해 주세요.'), { 'Retry-After': '10' });
    if (q.length > 40) return send(res, 400, fail('VALIDATION_ERROR', '검색어는 40자까지 입력할 수 있습니다.'));
    const genre = url.searchParams.get('genre');
    const status = url.searchParams.get('status');
    const region = url.searchParams.get('region');
    const sort = url.searchParams.get('sort') ?? 'date';
    const rk = ranks();
    let list = shows.map((s) => ({ s, sum: summary(s, rk.get(s.id) ?? null) }));
    if (genre) list = list.filter((x) => x.s.genre === genre);
    if (status) list = list.filter((x) => x.sum.status === status);
    if (region && !v3Mode) list = list.filter((x) => x.s.region === region);
    if (q) list = list.filter((x) => x.s.title.includes(q) || x.s.venue.includes(q));
    let out = list.map((x) => x.sum);
    if (sort === 'ranking') out = out.filter((s) => s.rank !== null).sort((a, b) => a.rank! - b.rank!);
    else if (sort === 'opening') out.sort((a, b) => a.saleOpensAt.localeCompare(b.saleOpensAt));
    else out.sort((a, b) => a.firstStartsAt.localeCompare(b.firstStartsAt));
    return send(res, 200, { shows: out });
  }

  let m = /^\/shows\/(\d+)$/.exec(path);
  if (method === 'GET' && m) {
    const s = show(Number(m[1]));
    if (!s) return send(res, 404, fail('SHOW_NOT_FOUND', '공연을 찾을 수 없습니다.'));
    const firstPerf = perfs.get(s.perfIds[0]!)!;
    return send(res, 200, {
      ...summary(s, ranks().get(s.id) ?? null),
      ageRating: s.ageRating, runningMinutes: s.runningMinutes, cast: s.cast, description: s.description,
      notices: s.notices, maxSeatsPerBooking: 4, grades: s.grades,
      performances: s.perfIds.map((id) => {
        const p = perfs.get(id)!;
        return {
          id, startsAt: p.startsAt, status: perfStatus(p),
          remainingByGrade: s.grades.map((g) => {
            const gs = p.seats.filter((x) => x.grade === g.code);
            return { grade: g.code, remaining: gs.filter((x) => !x.sold).length, total: gs.length };
          }),
        };
      }),
      ...(v3Mode ? {} : { venueInfo: { name: s.venue, region: s.region, seatCount: firstPerf.seats.length } }),
    });
  }

  // ── v4 (토큰·로그인 불필요) ──
  const v4 = path === '/banners' || path.startsWith('/notices') || path === '/rankings' || /^\/performances\/\d+\/layout$/.test(path);
  if (v4 && v3Mode) return send(res, 404, fail('NOT_FOUND', '요청한 주소가 없습니다.'));

  if (method === 'GET' && path === '/banners') return send(res, 200, { banners: BANNERS });

  if (method === 'GET' && path === '/notices') {
    const category = url.searchParams.get('category');
    const page = Number(url.searchParams.get('page') ?? '1');
    const size = Number(url.searchParams.get('size') ?? '20');
    if ((category && category !== 'TICKET_OPEN' && category !== 'SERVICE') || !Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 50) {
      return send(res, 400, fail('VALIDATION_ERROR', '조회 조건을 확인해 주세요.'));
    }
    const all = sortedNotices().filter((n) => !category || n.category === category);
    const totalPages = Math.max(1, Math.ceil(all.length / size));
    return send(res, 200, { notices: all.slice((page - 1) * size, page * size).map(noticeSummary), page, totalPages, totalCount: all.length });
  }
  m = /^\/notices\/(\d+)$/.exec(path);
  if (method === 'GET' && m) {
    const n = noticeList.find((x) => x.id === Number(m![1]));
    if (!n) return send(res, 404, fail('NOTICE_NOT_FOUND', '공지를 찾을 수 없습니다.'));
    return send(res, 200, n);
  }

  if (method === 'GET' && path === '/rankings') {
    const genre = url.searchParams.get('genre');
    const period = url.searchParams.get('period') ?? 'WEEKLY';
    if (!['DAILY', 'WEEKLY', 'ALL'].includes(period) || (genre && !['CONCERT', 'MUSICAL', 'PLAY', 'CLASSIC'].includes(genre))) {
      return send(res, 400, fail('VALIDATION_ERROR', '조회 조건을 확인해 주세요.'));
    }
    const since = period === 'DAILY' ? now() - DAY : period === 'WEEKLY' ? now() - 7 * DAY : 0;
    const scoped = shows.filter((s) => !genre || s.genre === genre).map((s) => ({ s, n: soldCount(s, since) })).filter((x) => x.n > 0);
    const total = scoped.reduce((a, x) => a + x.n, 0);
    const rk = ranks();
    const items = scoped
      .sort((a, b) => b.n - a.n)
      .slice(0, 20)
      .map((x, i) => ({ rank: i + 1, show: summary(x.s, rk.get(x.s.id) ?? null), share: Math.round((x.n / total) * 1000) / 10 }));
    const at = new Date(Math.floor(now() / HOUR) * HOUR).toISOString();
    return send(res, 200, { rankedAt: at, period, items });
  }

  m = /^\/performances\/(\d+)\/layout$/.exec(path);
  if (method === 'GET' && m) {
    const p = perfs.get(Number(m[1]));
    if (!p) return send(res, 404, fail('PERFORMANCE_NOT_FOUND', '회차를 찾을 수 없습니다.'));
    const s = show(p.showId)!;
    return send(res, 200, {
      performance: { id: p.id, showId: s.id, showTitle: s.title, venue: s.venue, startsAt: p.startsAt },
      grades: s.grades, rows: p.rows, seatsPerRow: p.seatsPerRow, aisleAfter: p.aisleAfter,
      seats: p.seats.map((x) => ({ row: x.row, number: x.number, grade: x.grade })),
    });
  }

  // 대기열
  if (method === 'POST' && path === '/queue/enter') {
    const u = requireLogin();
    if (!u) return;
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const p = typeof body.performanceId === 'number' ? perfs.get(body.performanceId) : undefined;
    if (!p) return send(res, 404, fail('PERFORMANCE_NOT_FOUND', '회차를 찾을 수 없습니다.'));
    const st = perfStatus(p);
    if (st === 'UPCOMING' || st === 'CLOSED') return send(res, 409, fail('NOT_ON_SALE', st === 'UPCOMING' ? '아직 예매가 열리지 않은 회차입니다.' : '이미 시작했거나 끝난 회차입니다.'));
    if (st === 'SOLD_OUT') return send(res, 409, fail('SOLD_OUT', '이 회차는 매진되었습니다.'));
    const token = randomBytes(24).toString('base64url');
    const admitMs = referer.includes('shortadmit=1') ? 40_000 : 600_000;
    const q: QEntry = { userId: u.id, perfId: p.id, status: 'WAITING', position: p.busy ? 1234 : 5, admittedUntil: null, lastPoll: now(), zeroPolls: 0, admitMs };
    queue.set(token, q);
    return send(res, 200, queueJson(q, token));
  }

  if (method === 'GET' && path === '/queue/status') {
    if (!requireLogin()) return;
    const token = req.headers['x-queue-token'];
    const q = typeof token === 'string' ? advance(token) : null;
    if (!q) return send(res, 401, fail('QUEUE_TOKEN_INVALID', '대기열 정보가 만료되었습니다. 대기열에 다시 들어가 주세요.'));
    q.lastPoll = now();
    if (q.status === 'WAITING') {
      const step = q.position > 100 ? 120 + Math.floor(Math.random() * 180) : 3 + Math.floor(Math.random() * 6);
      q.position = Math.max(0, q.position - step);
      // 붐비는 회차: 앞사람이 없어도 입장 자리가 날 때까지 position 0으로 몇 번 더 기다린다
      if (q.position === 0 && perfs.get(q.perfId)?.busy && q.zeroPolls++ < 3) return send(res, 200, queueJson(q));
      if (q.position === 0) {
        q.status = 'ADMITTED';
        q.admittedUntil = now() + q.admitMs;
      }
    }
    return send(res, 200, queueJson(q));
  }

  if (method === 'DELETE' && path === '/queue') {
    const token = req.headers['x-queue-token'];
    if (typeof token === 'string') {
      for (const h of [...holds.values()]) if (h.token === token) releaseHold(h);
      queue.delete(token);
    }
    return send(res, 204);
  }

  // 모의 전용: 좌석을 다른 사람이 선점한 것처럼
  if (method === 'POST' && path === '/__mock/steal') {
    const body = await readJson(req);
    const ids = Array.isArray(body.seatIds) ? (body.seatIds as number[]) : [];
    for (const id of ids) seatHold.set(id, { holdId: null, until: now() + 120_000 });
    return send(res, 204);
  }

  // 좌석
  m = /^\/performances\/(\d+)\/seats$/.exec(path);
  if (method === 'GET' && m) {
    const p = perfs.get(Number(m[1]));
    if (!p) return send(res, 404, fail('PERFORMANCE_NOT_FOUND', '회차를 찾을 수 없습니다.'));
    const u = requireLogin();
    if (!u) return;
    const token = requireAdmitted(req, res, p.id, u.id);
    if (!token) return;
    otherAudience(p);
    const s = show(p.showId)!;
    const myHold = [...holds.values()].find((h) => h.token === token && h.perfId === p.id && h.expiresAt > now());
    return send(res, 200, {
      performance: { id: p.id, showId: s.id, showTitle: s.title, venue: s.venue, startsAt: p.startsAt },
      grades: s.grades, rows: p.rows, seatsPerRow: p.seatsPerRow, aisleAfter: p.aisleAfter,
      seats: seatView(p, token), myHold: myHold ? holdJson(myHold) : null,
    });
  }

  m = /^\/performances\/(\d+)\/holds$/.exec(path);
  if (method === 'POST' && m) {
    const p = perfs.get(Number(m[1]));
    if (!p) return send(res, 404, fail('PERFORMANCE_NOT_FOUND', '회차를 찾을 수 없습니다.'));
    const u = requireLogin();
    if (!u) return;
    const token = requireAdmitted(req, res, p.id, u.id);
    if (!token) return;
    const body = await readJson(req);
    const ids = body.seatIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length || !ids.every((x) => p.seats.some((s) => s.id === x))) {
      return send(res, 400, fail('VALIDATION_ERROR', '좌석은 1~4석까지, 중복 없이 고를 수 있습니다.'));
    }
    if (perfStatus(p) !== 'ON_SALE') return send(res, 409, fail('NOT_ON_SALE', '지금은 이 회차를 예매할 수 없습니다.'));
    // 토큰당 선점 1건: 이전 선점 해제
    for (const h of [...holds.values()]) if (h.token === token) releaseHold(h);
    const taken = (ids as number[]).filter((id) => p.seats.find((s) => s.id === id)!.sold || heldBy(id));
    if (taken.length) return send(res, 409, fail('SEAT_TAKEN', '다른 관객이 먼저 선택한 좌석이 있습니다. 좌석을 다시 골라 주세요.', { seatIds: taken }));
    const seconds = referer.includes('shorthold=1') ? 20 : 300;
    const h: MHold = { holdId: randomBytes(18).toString('base64url'), token, perfId: p.id, seatIds: ids as number[], expiresAt: now() + seconds * 1000 };
    holds.set(h.holdId, h);
    for (const id of h.seatIds) seatHold.set(id, { holdId: h.holdId, until: h.expiresAt });
    return send(res, 201, holdJson(h));
  }

  m = /^\/holds\/([\w-]+)$/.exec(path);
  if (method === 'DELETE' && m) {
    const h = holds.get(m[1]!);
    if (!h || h.token !== req.headers['x-queue-token']) return send(res, 404, fail('HOLD_NOT_FOUND', '선점 정보를 찾을 수 없습니다.'));
    releaseHold(h);
    return send(res, 204);
  }

  // 예매
  if (method === 'POST' && path === '/reservations') {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[0-9a-f-]{36}$/i.test(key)) return send(res, 400, fail('VALIDATION_ERROR', 'Idempotency-Key 헤더가 필요합니다.'));
    const cached = idem.get(key);
    if (cached) return send(res, cached.status, cached.body);
    const u = requireLogin();
    if (!u) return;
    const body = await readJson(req);
    // 계약: 정의되지 않은 필드 거부(v3 흉내 모드에서는 paymentMethod도 정의 밖)
    const allowed = v3Mode ? ['holdId'] : ['holdId', 'paymentMethod'];
    if (Object.keys(body).some((k) => !allowed.includes(k))) return send(res, 400, fail('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다.'));
    const pm = body.paymentMethod ?? 'CARD';
    if (pm !== 'CARD' && pm !== 'EASY_PAY' && pm !== 'BANK_TRANSFER') return send(res, 400, fail('VALIDATION_ERROR', '결제 수단을 확인해 주세요.'));
    // 오류 상태 확인용: 계정 이메일로 분기
    switch (u.email) {
      case 'ratelimit@test.kr':
        return send(res, 429, fail('RATE_LIMITED', '요청이 너무 많습니다. 15초 뒤에 다시 시도해 주세요.'), { 'Retry-After': '15' });
      case 'offline@test.kr':
        req.socket.destroy();
        return;
      case 'fail@test.kr':
        return send(res, 500, fail('INTERNAL_ERROR', '일시적인 문제로 예매를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
    }
    const h = typeof body.holdId === 'string' ? holds.get(body.holdId) : undefined;
    if (!h) return send(res, 409, fail('HOLD_EXPIRED', '좌석 선점 시간이 지났습니다. 좌석을 다시 골라 주세요.'));
    const token = requireAdmitted(req, res, h.perfId, u.id);
    if (!token) return;
    let result: { status: number; body: unknown };
    const already = [...reservations.values()]
      .filter((r) => r.userId === u.id && r.perfId === h.perfId && r.status === 'CONFIRMED')
      .reduce((n, r) => n + r.seatIds.length, 0);
    if (u.email === 'expired@test.kr' || h.token !== token || h.expiresAt <= now()) {
      releaseHold(h);
      result = { status: 409, body: fail('HOLD_EXPIRED', '좌석 선점 시간이 지났습니다. 좌석을 다시 골라 주세요.') };
    } else if (already + h.seatIds.length > 4) {
      result = { status: 409, body: fail('BOOKING_LIMIT_EXCEEDED', '이 회차에 이미 ' + already + '석을 예매해서 ' + h.seatIds.length + '석을 더 예매할 수 없습니다.') };
    } else {
      const p = perfs.get(h.perfId)!;
      const seats = h.seatIds.map((id) => p.seats.find((x) => x.id === id)!);
      if (seats.some((x) => x.sold)) {
        result = { status: 409, body: fail('SEAT_TAKEN', '이미 판매된 좌석이 있습니다.', { seatIds: seats.filter((x) => x.sold).map((x) => x.id) }) };
      } else {
        seats.forEach((x) => {
          x.sold = true;
          x.soldAt = now();
        });
        releaseHold(h);
        queue.delete(token); // 입장 권한 반납
        const r: MRes = { code: newCode(), userId: u.id, perfId: p.id, seatIds: h.seatIds, name: u.name, email: u.email, status: 'CONFIRMED', createdAt: new Date().toISOString(), cancelledAt: null, paymentMethod: pm };
        reservations.set(r.code, r);
        result = { status: 201, body: resJson(r) };
      }
    }
    idem.set(key, result);
    return send(res, result.status, result.body);
  }

  return send(res, 404, fail('NOT_FOUND', '요청한 주소가 없습니다.'));
}

export function mockApiPlugin(): Plugin {
  return {
    name: 'ticketing-mock-api-v4',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info('  [mock] /api 요청을 계약 v4 모의 응답으로 처리합니다.');
      server.middlewares.use('/api', (req, res) => {
        handle(req, res).catch(() => send(res, 500, fail('INTERNAL_ERROR', '모의 서버 오류')));
      });
    },
  };
}
