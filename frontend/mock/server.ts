// 개발 전용 모의 API (계약 v2). `npm run dev:mock`일 때만 Vite 개발 서버에 붙는다.
// vite.config.ts에서 mock 모드일 때만 동적 import되므로 브라우저 번들(dist)에는 들어가지 않는다.
// 공연명·출연진·장소는 전부 지어낸 것이다.
//
// 상태를 화면에서 확인하는 방법
//   대기열       : 모든 회차가 대기(WAITING)로 시작해 몇 번 폴링하면 입장. 〈파도 위의 정원〉 첫 회차는 대기가 길고,
//                  앞사람이 없어진 뒤에도 position 0인 WAITING으로 몇 번 더 기다린다.
//   SEAT_TAKEN   : POST /api/__mock/steal { seatIds } 로 좌석을 다른 사람이 선점한 것처럼 만든다.
//   선점 만료    : 좌석 화면 주소에 ?shorthold=1 → 선점 시간이 20초
//   계정(v3)     : 시연 계정 test@example.com / test1234 (모의 전용). 5번 틀리면 15분 잠금(ACCOUNT_LOCKED)
//   예매 확정    : 계정 이메일이 ratelimit@test.kr → 429, offline@test.kr → 연결 끊김, expired@test.kr → HOLD_EXPIRED,
//                  fail@test.kr → 500. 같은 회차 4석 초과 → BOOKING_LIMIT_EXCEEDED
//   세션 만료    : POST /api/__mock/expire-session → 모든 세션이 비로그인으로(다음 요청이 401 UNAUTHENTICATED)
//   CSRF 교체    : POST /api/__mock/rotate-csrf → 다음 변경 요청이 403 CSRF_INVALID → 프론트가 토큰을 다시 받아 재시도
//   목록         : 검색어 ratelimit → 429, 화면 주소 ?fail=1 → 500
//   다른 관객    : 좌석을 조회할 때마다 가끔 빈 좌석 하나가 다른 사람에게 선점·판매된다.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';

type Genre = 'CONCERT' | 'MUSICAL' | 'PLAY' | 'CLASSIC';
type SaleStatus = 'UPCOMING' | 'ON_SALE' | 'SOLD_OUT' | 'CLOSED';
type Grade = { code: string; name: string; price: number };

type MSeat = { id: number; row: string; number: number; grade: string; sold: boolean };
type MPerf = { id: number; showId: number; startsAt: string; rows: string[]; seatsPerRow: number; aisleAfter: number[]; seats: MSeat[]; busy?: boolean };
type MShow = {
  id: number; title: string; genre: Genre; venue: string; saleOpensAt: string;
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
  '공연 시작 후에는 입장이 제한될 수 있습니다.',
  '예매 취소는 공연 시작 전까지 가능합니다.',
  '좌석은 선택 후 5분 동안만 임시로 확보됩니다.',
];

type Seed = {
  title: string; genre: Genre; venue: string; open: [number, number]; perfs: [number, number, number?][];
  grades: Grade[]; rows: number; perRow: number; aisle: number[]; soldRatio: number; age: string; mins: number;
  cast: string[]; desc: string; hue: number; busyFirst?: boolean; soldOutFirst?: boolean;
  /** 배치 모양: fan=앞줄이 짧은 부채꼴, corner=뒤쪽 모서리가 빠지고 기둥 자리가 빈 소극장 */
  shape?: 'fan' | 'corner';
};

const R = (p: number): Grade => ({ code: 'R', name: 'R석', price: p });
const S = (p: number): Grade => ({ code: 'S', name: 'S석', price: p });
const A = (p: number): Grade => ({ code: 'A', name: 'A석', price: p });
const VIP = (p: number): Grade => ({ code: 'VIP', name: 'VIP석', price: p });

const SEEDS: Seed[] = [
  { title: '파도 위의 정원', genre: 'MUSICAL', venue: '한빛아트홀 대극장', open: [-14, 14], perfs: [[3, 19, 30], [4, 14], [4, 19, 30], [10, 19, 30]],
    grades: [VIP(150000), R(130000), S(99000)], rows: 12, perRow: 18, aisle: [4, 14], soldRatio: 0.55, age: '8세 이상', mins: 160,
    cast: ['윤서하', '도경민', '채이랑', '백무진'], hue: 196, busyFirst: true, shape: 'fan',
    desc: '바닷가 마을의 버려진 정원을 되살리려는 세 사람의 여름.\n파도 소리로 시작해 합창으로 끝나는 2막 뮤지컬입니다.' },
  { title: '밤의 라디오 공개방송', genre: 'CONCERT', venue: '서울 문화창고 홀', open: [-6, 20], perfs: [[2, 20], [9, 20]],
    grades: [R(88000), S(66000)], rows: 10, perRow: 16, aisle: [8], soldRatio: 0.7, age: '만 7세 이상', mins: 120,
    cast: ['소란한 오후', '정해담'], hue: 268, shape: 'corner',
    desc: '심야 라디오 사연을 노래로 풀어내는 공개방송 형식의 콘서트.\n관객 사연을 현장에서 받습니다.' },
  { title: '골목의 끝, 세탁소', genre: 'PLAY', venue: '대학로 나무의자 극장', open: [-20, 14], perfs: [[1, 15], [1, 19], [6, 19]],
    grades: [R(50000), S(40000)], rows: 8, perRow: 12, aisle: [6], soldRatio: 0.82, age: '13세 이상', mins: 100,
    cast: ['한도윤', '오세린', '김마루'], hue: 32, soldOutFirst: true, shape: 'corner',
    desc: '30년 된 동네 세탁소에 맡겨진, 주인이 찾아가지 않는 옷들의 사연.\n소극장 연극.' },
  { title: '겨울 현악 사중주의 밤', genre: 'CLASSIC', venue: '예음 체임버홀', open: [-10, 10], perfs: [[5, 19, 30], [12, 17]],
    grades: [R(70000), S(50000), A(30000)], rows: 10, perRow: 14, aisle: [7], soldRatio: 0.35, age: '초등학생 이상', mins: 90,
    cast: ['루미에르 콰르텟'], hue: 220,
    desc: '겨울을 주제로 고른 네 곡의 현악 사중주.\n공연 전 20분 해설이 있습니다.' },
  { title: '네온 사막', genre: 'CONCERT', venue: '잠실 스카이돔', open: [-3, 12], perfs: [[16, 18], [17, 18]],
    grades: [VIP(165000), R(143000), S(121000)], rows: 12, perRow: 18, aisle: [5, 13], soldRatio: 0.45, age: '만 9세 이상', mins: 150,
    cast: ['밴드 모래시계'], hue: 312, shape: 'fan',
    desc: '전국 투어의 서울 마지막 공연. 신보 수록곡 전곡을 처음으로 라이브로 들려줍니다.' },
  { title: '구두장이와 일곱 번째 밤', genre: 'MUSICAL', venue: '청파 씨어터', open: [3, 14], perfs: [[20, 19, 30], [21, 14], [21, 18]],
    grades: [R(110000), S(88000), A(66000)], rows: 11, perRow: 16, aisle: [4, 12], soldRatio: 0, age: '8세 이상', mins: 140,
    cast: ['문하진', '이로운', '서주아'], hue: 14,
    desc: '밤마다 구두를 하나씩 완성해야 저주가 풀리는 구두장이 이야기.\n가족 관객을 위한 판타지 뮤지컬.' },
  { title: '편지들, 낭독극', genre: 'PLAY', venue: '성수 빈 창고 스튜디오', open: [9, 20], perfs: [[24, 16], [25, 16]],
    grades: [R(35000), S(25000)], rows: 8, perRow: 12, aisle: [6], soldRatio: 0, age: '12세 이상', mins: 80,
    cast: ['정나래', '유한결'], hue: 48,
    desc: '1950년대 피난지에서 오간 편지 마흔 통을 두 배우가 읽습니다.' },
  { title: '피아노와 첫눈', genre: 'CLASSIC', venue: '한빛아트홀 소극장', open: [1, 12], perfs: [[14, 19, 30]],
    grades: [R(60000), S(40000)], rows: 9, perRow: 14, aisle: [7], soldRatio: 0, age: '초등학생 이상', mins: 85,
    cast: ['피아니스트 강여울'], hue: 205,
    desc: '첫눈을 기다리는 마음으로 고른 소품 열두 곡. 앙코르는 관객 신청곡입니다.' },
  { title: '오래된 극장의 유령들', genre: 'PLAY', venue: '혜화 별빛소극장', open: [-30, 14], perfs: [[-2, 19, 30], [-1, 15]],
    grades: [R(45000), S(35000)], rows: 8, perRow: 12, aisle: [6], soldRatio: 0.9, age: '15세 이상', mins: 110,
    cast: ['차운', '민서윤', '고하람'], hue: 0,
    desc: '문 닫는 극장의 마지막 밤, 무대 뒤에 남아 있던 이들이 모습을 드러냅니다.' },
  { title: '여름 끝의 브라스밴드', genre: 'CONCERT', venue: '마포 둥지홀', open: [-8, 12], perfs: [[7, 18], [8, 17]],
    grades: [R(55000), S(44000)], rows: 9, perRow: 14, aisle: [7], soldRatio: 0.25, age: '전체 관람가', mins: 100,
    cast: ['동네 브라스 앙상블 열한 명'], hue: 140,
    desc: '트럼펫, 트롬본, 튜바가 함께하는 신나는 두 시간.' },
  { title: '달의 뒷면 오케스트라', genre: 'CLASSIC', venue: '예음 콘서트홀', open: [-12, 10], perfs: [[11, 19, 30], [18, 19, 30]],
    grades: [R(90000), S(70000), A(40000)], rows: 12, perRow: 16, aisle: [4, 12], soldRatio: 0.5, age: '초등학생 이상', mins: 120,
    cast: ['한강 청년 오케스트라', '지휘 서도담'], hue: 248,
    desc: '달을 주제로 한 관현악 작품 세 편. 2부에는 위촉 신작 초연이 있습니다.' },
  // id 12~18: 포스터 이미지(public/posters/12~18) 확인용. 실제 백엔드 시드의 공연 이름과 맞춘다.
  { title: '피아노 리사이틀 〈물의 기억〉', genre: 'CLASSIC', venue: '하늘결 체임버홀', open: [-9, 12], perfs: [[9, 19, 30]],
    grades: [R(70000), S(50000)], rows: 9, perRow: 14, aisle: [7], soldRatio: 0.3, age: '8세 이상', mins: 90,
    cast: ['피아니스트 서윤슬'], hue: 176,
    desc: '물을 주제로 고른 피아노 독주곡.' },
  { title: '노을빛 재즈 쿼텟 〈밤 열한 시〉', genre: 'CONCERT', venue: '을지로 지하 라운지홀', open: [-5, 12], perfs: [[6, 23], [13, 23]],
    grades: [R(66000), S(48000)], rows: 8, perRow: 12, aisle: [6], soldRatio: 0.4, age: '만 15세 이상', mins: 100,
    cast: ['노을빛 재즈 쿼텟'], hue: 24, shape: 'corner',
    desc: '밤 열한 시에 시작하는 심야 재즈 공연. 스탠더드와 자작곡을 섞어 들려줍니다.' },
  { title: '겨울맞이 포크 콘서트 〈첫눈 오는 날〉', genre: 'CONCERT', venue: '마포 둥지홀', open: [4, 12], perfs: [[22, 18], [23, 17]],
    grades: [R(55000), S(44000)], rows: 9, perRow: 14, aisle: [7], soldRatio: 0, age: '전체 관람가', mins: 110,
    cast: ['한겨울', '솔바람 트리오'], hue: 210,
    desc: '기타 두 대와 하모니카로 여는 겨울 포크 콘서트.' },
  { title: '뮤지컬 〈달빛 세탁소〉', genre: 'MUSICAL', venue: '청파 씨어터', open: [-11, 14], perfs: [[8, 19, 30], [9, 14], [15, 19, 30]],
    grades: [VIP(140000), R(120000), S(90000)], rows: 11, perRow: 16, aisle: [4, 12], soldRatio: 0.5, age: '8세 이상', mins: 150,
    cast: ['문하진', '최누리', '이도건'], hue: 236, shape: 'fan',
    desc: '보름달이 뜨는 밤에만 문을 여는 세탁소에서 잃어버린 기억을 빨아 드립니다.' },
  { title: '연극 〈버스는 여덟 시에 떠난다〉', genre: 'PLAY', venue: '대학로 나무의자 극장', open: [-15, 14], perfs: [[3, 20], [4, 20], [10, 20]],
    grades: [R(45000), S(35000)], rows: 8, perRow: 12, aisle: [6], soldRatio: 0.85, age: '13세 이상', mins: 95,
    cast: ['한도윤', '정소이'], hue: 40, shape: 'corner',
    desc: '시골 종점 정류장, 마지막 버스를 기다리는 두 사람의 한 시간.' },
  { title: '첼로와 피아노의 밤 〈긴 겨울의 노래〉', genre: 'CLASSIC', venue: '예음 체임버홀', open: [6, 10], perfs: [[26, 19, 30]],
    grades: [R(65000), S(45000), A(30000)], rows: 10, perRow: 14, aisle: [7], soldRatio: 0, age: '초등학생 이상', mins: 100,
    cast: ['첼리스트 윤가람', '피아니스트 오하늘'], hue: 200,
    desc: '겨울을 노래한 첼로 소나타 세 곡.' },
  { title: '뮤지컬 〈고양이 우체부〉', genre: 'MUSICAL', venue: '한빛아트홀 소극장', open: [-7, 14], perfs: [[12, 14], [12, 17], [19, 14]],
    grades: [R(77000), S(55000)], rows: 9, perRow: 14, aisle: [7], soldRatio: 0.3, age: '전체 관람가', mins: 90,
    cast: ['채이랑', '백무진'], hue: 330,
    desc: '마을의 편지를 나르는 고양이 우체부의 하루. 가족 뮤지컬.' },
];

const shows: MShow[] = [];
const perfs = new Map<number, MPerf>();
let seatSeq = 1;
let perfSeq = 101;

SEEDS.forEach((s, i) => {
  const showId = i + 1;
  const rand = rng(showId * 7919);
  const rowNames = Array.from({ length: s.rows }, (_, k) => String.fromCharCode(65 + k));
  const perfIds: number[] = [];
  s.perfs.forEach(([d, hh, mm], pi) => {
    const id = perfSeq++;
    const seats: MSeat[] = [];
    rowNames.forEach((row, ri) => {
      // 앞쪽 행이 높은 등급
      const gi = Math.min(s.grades.length - 1, Math.floor((ri / s.rows) * s.grades.length));
      for (let n = 1; n <= s.perRow; n++) {
        // number는 격자 열 위치. 자리가 없는 칸은 좌석을 만들지 않는다(번호를 당기지 않음)
        if (s.shape === 'fan' && ri < 3 && (n <= (3 - ri) * 2 || n > s.perRow - (3 - ri) * 2)) continue;
        if (s.shape === 'corner' && ri >= s.rows - 2 && (n <= 2 || n > s.perRow - 2)) continue;
        if (s.shape === 'corner' && ri === 4 && (n === 3 || n === 4)) continue; // 기둥
        const soldOut = s.soldOutFirst && pi === 0;
        seats.push({ id: seatSeq++, row, number: n, grade: s.grades[gi]!.code, sold: soldOut || rand() < s.soldRatio });
      }
    });
    perfs.set(id, { id, showId, startsAt: kst(d, hh, mm ?? 0), rows: rowNames, seatsPerRow: s.perRow, aisleAfter: s.aisle, seats, busy: s.busyFirst && pi === 0 });
    perfIds.push(id);
  });
  shows.push({
    id: showId, title: s.title, genre: s.genre, venue: s.venue, saleOpensAt: kst(s.open[0], s.open[1]),
    ageRating: s.age, runningMinutes: s.mins, cast: s.cast, description: s.desc, notices: NOTICES,
    grades: s.grades, poster: { seed: 1000 + showId * 37, hue: s.hue }, perfIds,
  });
});

// ── 선점·대기열 상태 ──
type QEntry = { userId: number; perfId: number; status: 'WAITING' | 'ADMITTED'; position: number; admittedUntil: number | null; lastPoll: number; zeroPolls: number };
const queue = new Map<string, QEntry>();
type MHold = { holdId: string; token: string; perfId: number; seatIds: number[]; expiresAt: number };
const holds = new Map<string, MHold>();
const seatHold = new Map<number, { holdId: string | null; until: number }>(); // holdId null = 다른 관객
const idem = new Map<string, { status: number; body: unknown }>();

type MRes = { code: string; userId: number; perfId: number; seatIds: number[]; name: string; email: string; status: 'CONFIRMED' | 'CANCELLED'; createdAt: string; cancelledAt: string | null };
const reservations = new Map<string, MRes>();

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

function soldCount(s: MShow) {
  return s.perfIds.reduce((n, id) => n + perfs.get(id)!.seats.filter((x) => x.sold).length, 0);
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
  };
}

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () => Array.from(randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join('');

// 조회용 예매 두 건(이메일 test@example.com)
(() => {
  const p1 = perfs.get(shows[0]!.perfIds[1]!)!;
  const s1 = p1.seats.filter((x) => x.sold).slice(0, 2);
  reservations.set('AP7K2M9QXD4R', { code: 'AP7K2M9QXD4R', userId: 1, perfId: p1.id, seatIds: s1.map((x) => x.id), name: '김하늘', email: 'test@example.com', status: 'CONFIRMED', createdAt: new Date(now() - 2 * DAY).toISOString(), cancelledAt: null });
  const p2 = perfs.get(shows[8]!.perfIds[0]!)!;
  const s2 = p2.seats.filter((x) => x.sold).slice(0, 1);
  reservations.set('HWQ4N8RTZC2K', { code: 'HWQ4N8RTZC2K', userId: 1, perfId: p2.id, seatIds: s2.map((x) => x.id), name: '박서준', email: 'test@example.com', status: 'CONFIRMED', createdAt: new Date(now() - 9 * DAY).toISOString(), cancelledAt: null });
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
  if (Math.random() < 0.5) pick.sold = true;
  else seatHold.set(pick.id, { holdId: null, until: now() + 25_000 });
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

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://mock');
  const path = url.pathname;
  const referer = req.headers.referer ?? '';
  await sleep(200 + Math.random() * 350);
  let sess = sessionOf(req, res);

  // 모의 전용 조작: 세션 만료, CSRF 토큰 교체
  if (req.method === 'POST' && path === '/__mock/expire-session') {
    for (const x of sessions.values()) x.userId = null;
    return send(res, 204);
  }
  if (req.method === 'POST' && path === '/__mock/rotate-csrf') {
    for (const x of sessions.values()) x.csrf = newCsrf();
    return send(res, 204);
  }

  // CSRF: GET·HEAD 외 모든 요청
  if (req.method !== 'GET' && req.method !== 'HEAD' && !path.startsWith('/__mock/') && req.headers['x-csrf-token'] !== sess.s.csrf) {
    return send(res, 403, fail('CSRF_INVALID', '보안 확인에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'));
  }
  const me = userById(sess.s.userId);
  const requireLogin = (): MUser | null => {
    if (me) return me;
    send(res, 401, fail('UNAUTHENTICATED', '로그인이 필요합니다. 다시 로그인해 주세요.'));
    return null;
  };

  // 인증
  if (req.method === 'GET' && path === '/auth/me') return send(res, 200, authState(sess.s));
  if (req.method === 'POST' && path === '/auth/signup') {
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
  if (req.method === 'POST' && path === '/auth/login') {
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
  if (req.method === 'POST' && path === '/auth/logout') {
    sessions.delete(sess.sid);
    res.setHeader('Set-Cookie', 'mock_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return send(res, 204);
  }

  // 내 예매
  if (req.method === 'GET' && path === '/me/reservations') {
    const u = requireLogin();
    if (!u) return;
    const list = [...reservations.values()].filter((r) => r.userId === u.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return send(res, 200, { reservations: list.map(resJson) });
  }
  const cm = /^\/me\/reservations\/([A-Z0-9]+)\/cancel$/.exec(path);
  if (req.method === 'POST' && cm) {
    const u = requireLogin();
    if (!u) return;
    const r = reservations.get(cm[1]!);
    if (!r || r.userId !== u.id) return send(res, 404, fail('RESERVATION_NOT_FOUND', '예매를 찾을 수 없습니다.'));
    if (r.status === 'CANCELLED') return send(res, 409, fail('ALREADY_CANCELLED', '이미 취소된 예매입니다.'));
    const p = perfs.get(r.perfId)!;
    if (now() >= Date.parse(p.startsAt)) return send(res, 409, fail('PERFORMANCE_CLOSED', '이미 시작했거나 끝난 회차는 취소할 수 없습니다.'));
    r.status = 'CANCELLED';
    r.cancelledAt = new Date().toISOString();
    r.seatIds.forEach((id) => (p.seats.find((x) => x.id === id)!.sold = false));
    return send(res, 200, resJson(r));
  }

  // 목록
  if (req.method === 'GET' && path === '/shows') {
    if (referer.includes('fail=1')) return send(res, 500, fail('INTERNAL_ERROR', '일시적인 문제로 공연 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
    const q = url.searchParams.get('q')?.trim() ?? '';
    if (q === 'ratelimit') return send(res, 429, fail('RATE_LIMITED', '요청이 너무 많습니다. 10초 뒤에 다시 시도해 주세요.'), { 'Retry-After': '10' });
    if (q.length > 40) return send(res, 400, fail('VALIDATION_ERROR', '검색어는 40자까지 입력할 수 있습니다.'));
    const genre = url.searchParams.get('genre');
    const status = url.searchParams.get('status');
    const sort = url.searchParams.get('sort') ?? 'date';
    const rk = ranks();
    let list = shows.map((s) => summary(s, rk.get(s.id) ?? null));
    if (genre) list = list.filter((s) => s.genre === genre);
    if (status) list = list.filter((s) => s.status === status);
    if (q) list = list.filter((s) => s.title.includes(q) || s.venue.includes(q));
    if (sort === 'ranking') list = list.filter((s) => s.rank !== null).sort((a, b) => a.rank! - b.rank!);
    else if (sort === 'opening') list.sort((a, b) => a.saleOpensAt.localeCompare(b.saleOpensAt));
    else list.sort((a, b) => a.firstStartsAt.localeCompare(b.firstStartsAt));
    return send(res, 200, { shows: list });
  }

  let m = /^\/shows\/(\d+)$/.exec(path);
  if (req.method === 'GET' && m) {
    const s = show(Number(m[1]));
    if (!s) return send(res, 404, fail('SHOW_NOT_FOUND', '공연을 찾을 수 없습니다.'));
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
    });
  }

  // 대기열
  if (req.method === 'POST' && path === '/queue/enter') {
    const u = requireLogin();
    if (!u) return;
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const p = typeof body.performanceId === 'number' ? perfs.get(body.performanceId) : undefined;
    if (!p) return send(res, 404, fail('PERFORMANCE_NOT_FOUND', '회차를 찾을 수 없습니다.'));
    const st = perfStatus(p);
    if (st === 'UPCOMING' || st === 'CLOSED') return send(res, 409, fail('NOT_ON_SALE', st === 'UPCOMING' ? '아직 예매가 열리지 않은 회차입니다.' : '이미 시작했거나 끝난 회차입니다.'));
    if (st === 'SOLD_OUT') return send(res, 409, fail('SOLD_OUT', '이 회차는 매진되었습니다.'));
    const token = randomBytes(24).toString('base64url');
    const q: QEntry = { userId: u.id, perfId: p.id, status: 'WAITING', position: p.busy ? 37 : 5, admittedUntil: null, lastPoll: now(), zeroPolls: 0 };
    queue.set(token, q);
    return send(res, 200, queueJson(q, token));
  }

  if (req.method === 'GET' && path === '/queue/status') {
    if (!requireLogin()) return;
    const token = req.headers['x-queue-token'];
    const q = typeof token === 'string' ? advance(token) : null;
    if (!q) return send(res, 401, fail('QUEUE_TOKEN_INVALID', '대기열 정보가 만료되었습니다. 대기열에 다시 들어가 주세요.'));
    q.lastPoll = now();
    if (q.status === 'WAITING') {
      q.position = Math.max(0, q.position - (3 + Math.floor(Math.random() * 6)));
      // 붐비는 회차: 앞사람이 없어도 입장 자리가 날 때까지 position 0으로 몇 번 더 기다린다
      if (q.position === 0 && perfs.get(q.perfId)?.busy && q.zeroPolls++ < 3) return send(res, 200, queueJson(q));
      if (q.position === 0) {
        q.status = 'ADMITTED';
        q.admittedUntil = now() + 600_000;
      }
    }
    return send(res, 200, queueJson(q));
  }

  if (req.method === 'DELETE' && path === '/queue') {
    const token = req.headers['x-queue-token'];
    if (typeof token === 'string') {
      for (const h of [...holds.values()]) if (h.token === token) releaseHold(h);
      queue.delete(token);
    }
    return send(res, 204);
  }

  // 모의 전용: 좌석을 다른 사람이 선점한 것처럼
  if (req.method === 'POST' && path === '/__mock/steal') {
    const body = await readJson(req);
    const ids = Array.isArray(body.seatIds) ? (body.seatIds as number[]) : [];
    for (const id of ids) seatHold.set(id, { holdId: null, until: now() + 120_000 });
    return send(res, 204);
  }

  // 좌석
  m = /^\/performances\/(\d+)\/seats$/.exec(path);
  if (req.method === 'GET' && m) {
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
  if (req.method === 'POST' && m) {
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
  if (req.method === 'DELETE' && m) {
    const h = holds.get(m[1]!);
    if (!h || h.token !== req.headers['x-queue-token']) return send(res, 404, fail('HOLD_NOT_FOUND', '선점 정보를 찾을 수 없습니다.'));
    releaseHold(h);
    return send(res, 204);
  }

  // 예매
  if (req.method === 'POST' && path === '/reservations') {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[0-9a-f-]{36}$/i.test(key)) return send(res, 400, fail('VALIDATION_ERROR', 'Idempotency-Key 헤더가 필요합니다.'));
    const cached = idem.get(key);
    if (cached) return send(res, cached.status, cached.body);
    const u = requireLogin();
    if (!u) return;
    const body = await readJson(req);
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
        seats.forEach((x) => (x.sold = true));
        releaseHold(h);
        queue.delete(token); // 입장 권한 반납
        const r: MRes = { code: newCode(), userId: u.id, perfId: p.id, seatIds: h.seatIds, name: u.name, email: u.email, status: 'CONFIRMED', createdAt: new Date().toISOString(), cancelledAt: null };
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
    name: 'ticketing-mock-api-v2',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info('  [mock] /api 요청을 계약 v2 모의 응답으로 처리합니다.');
      server.middlewares.use('/api', (req, res) => {
        handle(req, res).catch(() => send(res, 500, fail('INTERNAL_ERROR', '모의 서버 오류')));
      });
    },
  };
}
