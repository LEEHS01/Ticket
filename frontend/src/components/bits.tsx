import { useEffect, useRef, useState, type ReactNode } from 'react';
import illusts from 'virtual:illust-images';
import type { ApiError, SaleStatus, ShowSummary } from '../api';
import { dDayLabel } from '../format';
import { Icon, type IconName } from './Icon';

// ── 페이지 안 알림 상자(오류·경고·안내) ──
type NoticeTone = 'error' | 'warn' | 'info';

export type NoticeData = { tone: NoticeTone; title: string; message?: string };

const NOTICE_ICON: Record<NoticeTone, IconName> = { error: 'alert', warn: 'alert', info: 'info' };

export function Notice({
  tone,
  title,
  children,
  actions,
  requestId,
  className,
}: {
  tone: NoticeTone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  requestId?: string | null;
  className?: string;
}) {
  return (
    <div className={`alert alert--${tone}${className ? ` ${className}` : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={NOTICE_ICON[tone]} size={20} className="alert__icon" />
      <div className="alert__main">
        <p className="alert__title">{title}</p>
        {children && <div className="alert__body">{children}</div>}
        {requestId && <p className="alert__rid">요청 번호 {requestId}</p>}
        {actions && <div className="alert__actions">{actions}</div>}
      </div>
    </div>
  );
}

/** 페이지 이동 시 navigation state로 넘겨받은 안내를 보여 준다 */
export function readNotice(state: unknown): NoticeData | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null;
  const n = (state as { notice: unknown }).notice as Partial<NoticeData> | null;
  return n && typeof n.title === 'string' && (n.tone === 'error' || n.tone === 'warn' || n.tone === 'info')
    ? { tone: n.tone, title: n.title, message: typeof n.message === 'string' ? n.message : undefined }
    : null;
}

/** 불러오기 실패: 알림 상자 + 다시 불러오기(요청 제한이면 남은 초) */
export function LoadError({ error, onRetry, title }: { error: ApiError; onRetry: () => void; title: string }) {
  const wait = useCountdown(retryWaitSec(error), error);
  return (
    <Notice
      tone={error.code === 'RATE_LIMITED' ? 'warn' : 'error'}
      title={title}
      requestId={error.supportId}
      actions={
        <button type="button" className="btn btn--line btn--s" onClick={onRetry} disabled={wait > 0}>
          {wait > 0 ? `${wait}초 뒤에 다시 불러오기` : '다시 불러오기'}
        </button>
      }
    >
      <p>{error.message}</p>
    </Notice>
  );
}

// ── 머리표(배지) ──
export type BadgeKind = 'upcoming' | 'dday' | 'hot' | 'soldout' | 'closed' | 'rank' | 'genre' | 'mock' | 'notice' | 'done' | 'cancel' | 'past';

export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  return <span className={`badge badge--${kind}`}>{children}</span>;
}

/** 매진 임박: 판매 중이고 잔여 < 15% */
export function isAlmostSoldOut(s: Pick<ShowSummary, 'status' | 'remainingSeats' | 'totalSeats'>) {
  return s.status === 'ON_SALE' && s.totalSeats > 0 && s.remainingSeats / s.totalSeats < 0.15;
}

/** 공연 상태 머리표(03 문서 3.6). 최대 2개 */
export function statusBadges(s: Pick<ShowSummary, 'status' | 'saleOpensAt' | 'remainingSeats' | 'totalSeats'>): { kind: BadgeKind; label: string }[] {
  const out: { kind: BadgeKind; label: string }[] = [];
  if (s.status === 'UPCOMING') {
    const d = dDayLabel(s.saleOpensAt);
    out.push(d ? { kind: 'dday', label: d } : { kind: 'upcoming', label: '오픈 예정' });
  }
  if (isAlmostSoldOut(s)) out.push({ kind: 'hot', label: '매진 임박' });
  if (s.status === 'SOLD_OUT') out.push({ kind: 'soldout', label: '매진' });
  if (s.status === 'CLOSED') out.push({ kind: 'closed', label: '판매 종료' });
  return out.slice(0, 2);
}

export function StatusBadges({ show }: { show: Pick<ShowSummary, 'status' | 'saleOpensAt' | 'remainingSeats' | 'totalSeats'> }) {
  const bs = statusBadges(show);
  if (bs.length === 0) return null;
  return (
    <span className="badges">
      {bs.map((b) => <Badge key={b.label} kind={b.kind}>{b.label}</Badge>)}
    </span>
  );
}

export const dimmed = (status: SaleStatus) => status === 'SOLD_OUT' || status === 'CLOSED';

// ── 빈 상태·안내 그림 ──
const HAS_ILLUST = new Set(illusts);

/** 안내 그림(04 문서 B). 파일이 없으면 아이콘 원(지름 64, 03 문서 3.7) */
export function Illust({ name, icon, size = 160 }: { name: 'illust-queue' | 'illust-empty' | 'illust-404'; icon: IconName; size?: 160 | 200 }) {
  const [failed, setFailed] = useState(false);
  if (HAS_ILLUST.has(name) && !failed) {
    return (
      <img
        className={`illust illust--${size}`}
        src={`/illust/${name}.webp`}
        width={size}
        height={size}
        alt=""
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="icon-circle" aria-hidden="true">
      <Icon name={icon} size={28} />
    </span>
  );
}

export function EmptyState({
  title,
  children,
  actions,
  illust,
  icon = 'empty',
  headingLevel = 'p',
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  illust?: 'illust-queue' | 'illust-empty' | 'illust-404';
  icon?: IconName;
  headingLevel?: 'p' | 'h1' | 'h2';
}) {
  const H = headingLevel;
  return (
    <div className="empty">
      {illust ? <Illust name={illust} icon={icon} /> : <span className="icon-circle" aria-hidden="true"><Icon name={icon} size={28} /></span>}
      <H className="empty__title" tabIndex={H === 'h1' ? -1 : undefined}>{title}</H>
      {children && <div className="empty__body">{children}</div>}
      {actions && <div className="empty__actions">{actions}</div>}
    </div>
  );
}

/** 진행 중 표시(16px 회전). 버튼 글자 앞에 둔다 */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

// ── 시간 훅 ──
/** Retry-After 초를 받아 남은 초를 센다. token(오류 객체)이 바뀌면 다시 센다. */
export function useCountdown(seconds: number | null, token: unknown): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!seconds || seconds <= 0) {
      setLeft(0);
      return;
    }
    const until = Date.now() + seconds * 1000;
    setLeft(seconds);
    const t = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) window.clearInterval(t);
    }, 250);
    return () => window.clearInterval(t);
  }, [seconds, token]);
  return left;
}

/** 특정 시각까지 남은 초(0.5초마다 갱신). iso가 없으면 null */
export function useSecondsUntil(iso: string | null): number | null {
  const [left, setLeft] = useState<number | null>(() => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000)) : null));
  useEffect(() => {
    if (!iso) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 500);
    return () => window.clearInterval(t);
  }, [iso]);
  return left;
}

/** 서버 일시 장애·연결 끊김 때 다시 시도 간격: 5초 → 10초 → 20초 → 30초(최대) */
export function backoffMs(failures: number) {
  return Math.min(30_000, 5_000 * 2 ** Math.max(0, failures - 1));
}

/**
 * 폴링의 다음 시도 간격. 서버가 Retry-After를 주면(429, 503 SERVICE_UNAVAILABLE) 그 간격을 따르고(1~60초),
 * 없으면 실패 횟수에 따라 늘린다.
 */
export function retryDelayMs(e: ApiError, failures: number) {
  if (e.retryAfterSec !== null) return Math.min(60, Math.max(1, e.retryAfterSec)) * 1000;
  return backoffMs(failures);
}

/** 다시 시도 단추를 잠가 둘 초: 요청 제한(429)이나 Retry-After가 붙은 서버 일시 장애(503) */
export function retryWaitSec(e: ApiError | null | undefined): number | null {
  if (!e) return null;
  if (e.code === 'RATE_LIMITED') return e.retryAfterSec ?? 10;
  if (e.isServerTrouble && e.retryAfterSec !== null) return Math.min(60, e.retryAfterSec);
  return null;
}

/**
 * 폴링 반복기.
 * - task가 끝나면 task가 돌려준 지연(ms) 뒤에 다시 실행한다(서버의 pollAfterSeconds, Retry-After, 장애 시 backoff 반영).
 * - 탭이 숨겨지면 hiddenDelayMs로 늦추고, null이면 멈췄다가 다시 보일 때 즉시 실행한다.
 * - 컴포넌트가 사라지면(화면 이탈) 진행 중 요청을 abort하고 예약을 지운다.
 */
export function usePoller(
  task: (signal: AbortSignal) => Promise<number | null>,
  opts: { enabled: boolean; hiddenDelayMs: number | null; /** 바꾸면 기다리지 않고 바로 다시 실행('지금 다시 시도') */ restartKey?: number },
) {
  const taskRef = useRef(task);
  taskRef.current = task;
  const { enabled, hiddenDelayMs, restartKey = 0 } = opts;

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    let timer: number | undefined;
    let running = false;
    let paused = false;
    let lastDelay = 0;

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      if (document.hidden) {
        if (hiddenDelayMs === null) {
          paused = true;
          return;
        }
        delay = Math.max(delay, hiddenDelayMs);
      }
      timer = window.setTimeout(run, delay);
    };

    const run = async () => {
      if (ac.signal.aborted || running) return;
      running = true;
      paused = false;
      let next: number | null = null;
      try {
        next = await taskRef.current(ac.signal);
      } finally {
        running = false;
      }
      if (ac.signal.aborted || next === null) return; // null = 폴링 종료
      lastDelay = next;
      schedule(next);
    };

    const onVisibility = () => {
      if (document.hidden) {
        // 이미 예약된 짧은 주기를 숨김 주기로 바꾼다
        if (!running) schedule(lastDelay);
      } else if (paused || !running) {
        window.clearTimeout(timer);
        void run();
      }
    };

    void run();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      ac.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, hiddenDelayMs, restartKey]);
}

/** 링크 복사(클립보드 API가 있는 보안 컨텍스트에서만) */
export function copyText(text: string): Promise<boolean> {
  if (!navigator.clipboard) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}
