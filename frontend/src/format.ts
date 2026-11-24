// 시각은 서버가 UTC ISO 문자열로 주고, 화면은 한국 시간으로 보여 준다.
// 표기 규칙: docs/next/benchmark/02-design-basis.md 1.3 (가격 154,000원, 기간 2026.12.03 ~ 12.21, 오픈 11.28(금) 20:00)
import type { Genre, PaymentMethod, SaleStatus } from './api';

const TZ = 'Asia/Seoul';

const fmtDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});
const fmtHm = new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function dateParts(iso: string | number) {
  const p = fmtDate.formatToParts(new Date(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === type)?.value ?? '';
  return { year: Number(pick('year')), month: Number(pick('month')), day: Number(pick('day')), weekday: pick('weekday') };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 한국 시간 날짜 키 "2026-11-21" */
export function dayKey(iso: string | number) {
  const d = dateParts(iso);
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** 19:30 */
export function hm(iso: string) {
  return fmtHm.format(new Date(iso));
}

/** 2026.11.20 */
export function dotDate(iso: string) {
  const d = dateParts(iso);
  return `${d.year}.${pad(d.month)}.${pad(d.day)}`;
}

/** 12.03(수) */
export function shortDate(iso: string) {
  const d = dateParts(iso);
  return `${pad(d.month)}.${pad(d.day)}(${d.weekday})`;
}

/** 12.03(수) 19:30 */
export function shortDateTime(iso: string) {
  return `${shortDate(iso)} ${hm(iso)}`;
}

/** 2026.12.03(수) 19:30 */
export function fullDateTime(iso: string) {
  const d = dateParts(iso);
  return `${d.year}.${pad(d.month)}.${pad(d.day)}(${d.weekday}) ${hm(iso)}`;
}

/** 12월 3일 (수) */
export function koreanDay(iso: string) {
  const d = dateParts(iso);
  return `${d.month}월 ${d.day}일 (${d.weekday})`;
}

/** 공연 기간. 2026.12.03 ~ 12.21, 해가 바뀌면 2026.12.28 ~ 2027.01.04, 같은 날이면 하나만 */
export function periodLabel(first: string, last: string) {
  const a = dateParts(first);
  const b = dateParts(last);
  const left = `${a.year}.${pad(a.month)}.${pad(a.day)}`;
  if (dayKey(first) === dayKey(last)) return left;
  return `${left} ~ ${a.year === b.year ? '' : `${b.year}.`}${pad(b.month)}.${pad(b.day)}`;
}

/** 짧은 기간(모바일 배너): 12.02 ~ 12.05 */
export function shortPeriod(first: string, last: string) {
  const a = dateParts(first);
  const b = dateParts(last);
  const left = `${pad(a.month)}.${pad(a.day)}`;
  if (dayKey(first) === dayKey(last)) return left;
  return `${left} ~ ${pad(b.month)}.${pad(b.day)}`;
}

/** 오늘(한국 시간)부터 남은 날 수. 0이면 오늘, 음수면 지난 날 */
export function daysUntil(iso: string, now = Date.now()) {
  const [y1, m1, d1] = dayKey(now).split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = dayKey(iso).split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** 오픈 일시: 오늘 14:00 / 내일 11:00 / 11.28(금) 20:00 */
export function openLabel(iso: string, now = Date.now()) {
  const n = daysUntil(iso, now);
  if (n === 0) return `오늘 ${hm(iso)}`;
  if (n === 1) return `내일 ${hm(iso)}`;
  return shortDateTime(iso);
}

/** 오픈까지 남은 날 표시: D-3, D-1, 오늘 오픈. 4일 이상이면 null(머리표는 '오픈 예정') */
export function dDayLabel(iso: string, now = Date.now()): string | null {
  const n = daysUntil(iso, now);
  if (n <= 0) return '오늘 오픈';
  if (n <= 3) return `D-${n}`;
  return null;
}

/** 큰 D-n 표시(강조 카드): D-12, D-DAY */
export function dDayShort(iso: string, now = Date.now()) {
  const n = daysUntil(iso, now);
  return n <= 0 ? 'D-DAY' : `D-${n}`;
}

/** 남은 시간: 2일 03:12:45 / 03:12:45 */
export function longCountdown(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const t = `${pad(h)}:${pad(m)}:${pad(r)}`;
  return d > 0 ? `${d}일 ${t}` : t;
}

export function won(n: number) {
  return `${n.toLocaleString('ko-KR')}원`;
}

/** 예매번호를 4자씩 끊어 읽기 쉽게(복사 값은 원본 그대로) */
export function groupCode(code: string) {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/** mm:ss */
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** 화면 낭독용: 4분 12초 */
export function spokenDuration(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}분 ${s % 60}초` : `${s}초`;
}

export const STATUS_LABEL: Record<SaleStatus, string> = {
  UPCOMING: '오픈 예정',
  ON_SALE: '판매 중',
  SOLD_OUT: '매진',
  CLOSED: '판매 종료',
};

export const GENRE_LABEL: Record<Genre, string> = {
  CONCERT: '콘서트',
  MUSICAL: '뮤지컬',
  PLAY: '연극',
  CLASSIC: '클래식',
};

export const GENRES: Genre[] = ['CONCERT', 'MUSICAL', 'PLAY', 'CLASSIC'];

/** 주소용 장르 이름: /genre/musical */
export const GENRE_SLUG: Record<Genre, string> = {
  CONCERT: 'concert',
  MUSICAL: 'musical',
  PLAY: 'play',
  CLASSIC: 'classic',
};

export function genreFromSlug(slug: string | null | undefined): Genre | null {
  if (!slug) return null;
  const v = slug.toLowerCase();
  return GENRES.find((g) => GENRE_SLUG[g] === v || g === slug.toUpperCase()) ?? null;
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CARD: '신용·체크카드',
  EASY_PAY: '간편결제',
  BANK_TRANSFER: '계좌이체',
};

export function seatLabel(s: { row: string; number: number }) {
  return `${s.row}열 ${s.number}번`;
}

/** 등급 이름: 계약의 Grade.name이 있으면 그것, 없으면 코드 + 석 */
export function gradeName(code: string, grades?: { code: string; name: string }[]) {
  return grades?.find((g) => g.code === code)?.name ?? `${code}석`;
}

/** 줄바꿈이 있는 글의 첫 줄 */
export function firstLine(text: string) {
  return text.split('\n')[0]?.trim() ?? '';
}
