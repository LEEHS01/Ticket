// 예매 진행 상태(대기열 토큰, 선점)를 새로고침에 견디도록 sessionStorage에 둔다.
// - localStorage는 쓰지 않는다(탭을 닫으면 사라져야 함, 계약 3.4).
// - 토큰·holdId는 URL에 넣지 않고 헤더/body로만 보낸다.
// - 이름·이메일은 저장하지 않는다.
import type { Hold, PerformanceInfo } from './api';

/** 선점한 좌석의 표시용 요약(개인정보 아님) */
export type HeldSeat = { id: number; row: string; number: number; grade: string; gradeName: string; price: number };
export type PerfMeta = Omit<PerformanceInfo, 'id'>;

export type BookingSession = {
  performanceId: number;
  showId: number | null;
  queueToken: string;
  /** 대기열 입장 유효 시각(좌석 선택 남은 시간). 모르면 null */
  admittedUntil: string | null;
  hold: Hold | null;
  heldSeats: HeldSeat[];
  meta: PerfMeta | null;
};

const KEY = 'mirinae.booking.v2';

function read(): BookingSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<BookingSession>;
    if (typeof v.performanceId !== 'number' || typeof v.queueToken !== 'string') return null;
    return {
      performanceId: v.performanceId,
      showId: v.showId ?? null,
      queueToken: v.queueToken,
      admittedUntil: typeof v.admittedUntil === 'string' ? v.admittedUntil : null,
      hold: v.hold ?? null,
      heldSeats: Array.isArray(v.heldSeats) ? v.heldSeats : [],
      meta: v.meta ?? null,
    };
  } catch {
    return null;
  }
}

function write(s: BookingSession | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등): 메모리 흐름만으로 진행
  }
}

/** 이 회차의 진행 상태. 다른 회차 것이면 null */
export function getBooking(performanceId: number): BookingSession | null {
  const s = read();
  return s && s.performanceId === performanceId ? s : null;
}

export function anyBooking(): BookingSession | null {
  return read();
}

export function startBooking(performanceId: number, showId: number | null, queueToken: string, admittedUntil: string | null = null) {
  write({ performanceId, showId, queueToken, admittedUntil, hold: null, heldSeats: [], meta: null });
}

export function setAdmitted(performanceId: number, admittedUntil: string | null) {
  const s = getBooking(performanceId);
  if (s && admittedUntil && s.admittedUntil !== admittedUntil) write({ ...s, admittedUntil });
}

export function setHold(performanceId: number, hold: Hold | null, heldSeats: HeldSeat[] = [], meta?: PerfMeta) {
  const s = getBooking(performanceId);
  if (s) write({ ...s, hold, heldSeats: hold ? heldSeats : [], meta: meta ?? s.meta });
}

export function setShowId(performanceId: number, showId: number) {
  const s = getBooking(performanceId);
  if (s && s.showId !== showId) write({ ...s, showId });
}

export function clearBooking() {
  write(null);
}
