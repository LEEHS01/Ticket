import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { api, toApiError, type ApiError, type Reservation, type ShowSummary } from '../api';
import { useAuth } from '../auth';
import { invalidate, useShowList } from '../data';
import { dotDate, fullDateTime, gradeName, groupCode, PAYMENT_LABEL, seatLabel, shortDateTime, won } from '../format';
import { usePageTitle } from '../shell';
import { Badge, EmptyState, LoadError, Notice, Spinner, useCountdown } from '../components/bits';
import { Icon, type IconName } from '../components/Icon';
import { Dialog, useToast } from '../components/overlay';
import { PosterArt } from '../components/PosterArt';

/** 마이 영역 틀: PC는 왼쪽 메뉴 200 + 내용 960, 모바일은 내용만 */
function MyLayout({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  return (
    <div className="page page--my">
      <div className="wrap my">
        <nav className="my__nav" aria-label="마이 메뉴">
          <p className="my__nav-title">마이</p>
          <ul>
            <li><NavLink to="/my/reservations" className="my__link">예매 내역</NavLink></li>
            <li><NavLink to="/my" end className="my__link">회원 정보</NavLink></li>
            <li><button type="button" className="my__link" onClick={() => void logout()}>로그아웃</button></li>
          </ul>
        </nav>
        <div className="my__body">{children}</div>
      </div>
    </div>
  );
}

// ─────────────────────────── 회원 정보(/my) ───────────────────────────
export function AccountPage() {
  usePageTitle('마이');
  const { user, logout } = useAuth();
  const menu: { to: string; label: string; icon: IconName }[] = [
    { to: '/my/reservations', label: '예매 내역', icon: 'ticket' },
    { to: '/notices', label: '공지사항', icon: 'megaphone' },
    { to: '/help', label: '이용안내·자주 묻는 질문', icon: 'help' },
  ];
  return (
    <MyLayout>
      <h1 className="my__title" tabIndex={-1}>회원 정보</h1>
      {user && (
        <dl className="account">
          <div><dt>이름</dt><dd>{user.name}</dd></div>
          <div><dt>이메일</dt><dd>{user.email}</dd></div>
        </dl>
      )}
      <p className="account__note">이름과 이메일은 바꿀 수 없어요. 실습 서비스라 회원 정보 수정 기능은 두지 않았어요.</p>
      <ul className="mmenu" aria-label="바로 가기">
        {menu.map((m) => (
          <li key={m.to}>
            <Link to={m.to} className="mmenu__item">
              <Icon name={m.icon} size={22} />
              <span>{m.label}</span>
              <Icon name="right" size={18} className="mmenu__go" />
            </Link>
          </li>
        ))}
        <li>
          <button type="button" className="mmenu__item" onClick={() => void logout()}>
            <Icon name="logout" size={22} />
            <span>로그아웃</span>
          </button>
        </li>
      </ul>
    </MyLayout>
  );
}

// ─────────────────────────── 내 예매(/my/reservations) ───────────────────────────
type Load = { kind: 'loading' } | { kind: 'error'; error: ApiError } | { kind: 'ready'; list: Reservation[] };
type Filter = 'all' | 'upcoming' | 'past' | 'cancelled';

const isCancelled = (r: Reservation) => r.status === 'CANCELLED';
const isStarted = (r: Reservation, now: number) => Date.parse(r.performance.startsAt) <= now;

export function MyReservationsPage() {
  usePageTitle('내 예매');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [shows] = useShowList();
  const posterOf = useMemo(() => new Map((shows.kind === 'ready' ? shows.data : []).map((s) => [s.id, s])), [shows]);

  useEffect(() => {
    const ac = new AbortController();
    setLoad({ kind: 'loading' });
    api.myReservations(ac.signal).then(
      (list) => setLoad({ kind: 'ready', list }),
      (err) => {
        if (!ac.signal.aborted) setLoad({ kind: 'error', error: toApiError(err) });
      },
    );
    return () => ac.abort();
  }, [attempt]);

  const replace = (r: Reservation) =>
    setLoad((l) => (l.kind === 'ready' ? { kind: 'ready', list: l.list.map((x) => (x.code === r.code ? r : x)) } : l));

  const now = Date.now();
  const list = load.kind === 'ready' ? load.list : [];
  const groups: Record<Filter, Reservation[]> = {
    all: list,
    upcoming: list.filter((r) => !isCancelled(r) && !isStarted(r, now)),
    past: list.filter((r) => !isCancelled(r) && isStarted(r, now)),
    cancelled: list.filter(isCancelled),
  };
  const TABS: { key: Filter; label: string }[] = [
    { key: 'all', label: '전체' },
    { key: 'upcoming', label: '관람 예정' },
    { key: 'past', label: '지난 공연' },
    { key: 'cancelled', label: '취소' },
  ];
  const shown = groups[filter];

  return (
    <MyLayout>
      <h1 className="my__title" tabIndex={-1}>내 예매</h1>
      <div className="tabs my__tabs" role="group" aria-label="예매 상태">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`tab${filter === t.key ? ' is-active' : ''}`} aria-pressed={filter === t.key} onClick={() => setFilter(t.key)}>
            {t.label}
            {load.kind === 'ready' && <span className="tab__n">{groups[t.key].length}</span>}
          </button>
        ))}
      </div>

      {load.kind === 'loading' && (
        <div className="resv-list" aria-busy="true">
          <span className="sr-only" role="status">예매 내역을 불러오는 중</span>
          <span className="skel skel--block resv-skel" aria-hidden="true" />
          <span className="skel skel--block resv-skel" aria-hidden="true" />
        </div>
      )}
      {load.kind === 'error' && load.error.code !== 'UNAUTHENTICATED' && (
        <div className="resv-list">
          <LoadError error={load.error} onRetry={() => setAttempt((n) => n + 1)} title="예매 내역을 불러오지 못했어요" />
        </div>
      )}
      {load.kind === 'ready' &&
        (list.length === 0 ? (
          <EmptyState title="아직 예매한 공연이 없어요" icon="ticket" actions={<Link className="btn btn--primary btn--m" to="/">공연 둘러보기</Link>}>
            <p>예매한 공연은 여기에서 확인하고 취소할 수 있어요.</p>
          </EmptyState>
        ) : shown.length === 0 ? (
          <p className="sec-empty resv-none">이 상태의 예매가 없어요.</p>
        ) : (
          <ul className="resv-list">
            {shown.map((r, i) => (
              <li key={r.code}>
                <ResvCard r={r} show={posterOf.get(r.show.id) ?? null} onChange={replace} eager={i < 3} />
              </li>
            ))}
          </ul>
        ))}
    </MyLayout>
  );
}

function ResvCard({ r, show, onChange, eager }: { r: Reservation; show: ShowSummary | null; onChange: (r: Reservation) => void; eager: boolean }) {
  const cancelled = isCancelled(r);
  const started = isStarted(r, Date.now());
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const first = r.seats[0];
  const seatText = first ? `${gradeName(first.grade)} ${seatLabel(first)}${r.seats.length > 1 ? ` 외 ${r.seats.length - 1}매` : ''}` : '';
  const detailId = `resv-d-${r.code}`;

  return (
    <article className={`resv${cancelled ? ' is-cancelled' : ''}`} aria-labelledby={`resv-${r.code}`}>
      <header className="resv__head">
        <p className="resv__when">
          {dotDate(r.createdAt)} 예매 · 예매번호 <span className="tnum">{groupCode(r.code)}</span>
        </p>
        {cancelled ? <Badge kind="cancel">취소됨</Badge> : started ? <Badge kind="past">관람 완료</Badge> : <Badge kind="done">예매 완료</Badge>}
      </header>
      <div className="resv__body">
        <span className="thumb thumb--72" aria-hidden="true">
          {show && <PosterArt showId={show.id} poster={show.poster} title={show.title} genre={show.genre} eager={eager} />}
        </span>
        <div className="resv__info">
          <h2 id={`resv-${r.code}`} className="resv__title"><Link to={`/shows/${r.show.id}`}>{r.show.title}</Link></h2>
          <p className="resv__meta">{shortDateTime(r.performance.startsAt)} · {r.show.venue}</p>
          <p className="resv__seat">
            {seatText} · <strong className="tnum">{won(r.totalPrice)}</strong>
          </p>
        </div>
      </div>
      {open && (
        <dl className="resv__detail" id={detailId}>
          <div>
            <dt>좌석</dt>
            <dd>
              <ul>
                {r.seats.map((s) => (
                  <li key={`${s.row}-${s.number}`}>{seatLabel(s)} · {gradeName(s.grade)} {won(s.price)}</li>
                ))}
              </ul>
            </dd>
          </div>
          <div><dt>결제 수단</dt><dd>{PAYMENT_LABEL[r.paymentMethod]}(모의)</dd></div>
          <div><dt>예매 시각</dt><dd>{fullDateTime(r.createdAt)}</dd></div>
          <div><dt>예매자</dt><dd>{r.name} · {r.emailMasked}</dd></div>
          {cancelled && r.cancelledAt && <div><dt>취소 시각</dt><dd>{fullDateTime(r.cancelledAt)}</dd></div>}
        </dl>
      )}
      <footer className="resv__foot">
        <p className="resv__deadline">
          {cancelled
            ? r.cancelledAt ? `${shortDateTime(r.cancelledAt)}에 취소했어요` : '취소한 예매예요'
            : started ? '관람한 공연이에요' : `${shortDateTime(r.performance.startsAt)}까지 취소할 수 있어요`}
        </p>
        <div className="resv__actions">
          <button type="button" className="btn btn--line btn--s" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((v) => !v)}>
            예매 상세
            <Icon name={open ? 'up' : 'down'} size={14} />
          </button>
          {!cancelled && !started && (
            <button type="button" className="text-btn text-btn--danger" onClick={() => setAsking(true)}>예매 취소</button>
          )}
        </div>
      </footer>
      {asking && <CancelDialog r={r} seatText={seatText} onClose={() => setAsking(false)} onCancelled={onChange} />}
    </article>
  );
}

function CancelDialog({ r, seatText, onClose, onCancelled }: { r: Reservation; seatText: string; onClose: () => void; onCancelled: (r: Reservation) => void }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const inFlight = useRef(false);
  const wait = useCountdown(error?.code === 'RATE_LIMITED' ? (error.retryAfterSec ?? 10) : null, error);

  async function cancel() {
    if (inFlight.current || wait > 0) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const done = await api.cancelMyReservation(r.code);
      invalidate('show');
      invalidate('rank');
      onCancelled(done);
      toast('예매를 취소했어요');
      onClose();
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'UNAUTHENTICATED') return;
      setError(e);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => !pending && onClose()}
      backdropClose={false}
      title="예매를 취소할까요?"
      actions={
        <>
          <button type="button" className="btn btn--line btn--m" onClick={onClose} disabled={pending}>닫기</button>
          <button type="button" className="btn btn--danger btn--m" onClick={() => void cancel()} disabled={pending || wait > 0}>
            {pending ? <><Spinner /> 취소하는 중…</> : wait > 0 ? `${wait}초 뒤에 다시 시도` : '예매 취소'}
          </button>
        </>
      }
    >
      <dl className="dsum">
        <div><dt>공연</dt><dd>{r.show.title}</dd></div>
        <div><dt>회차</dt><dd>{shortDateTime(r.performance.startsAt)}</dd></div>
        <div><dt>좌석</dt><dd>{seatText}</dd></div>
        <div><dt>금액</dt><dd>{won(r.totalPrice)}</dd></div>
      </dl>
      <p>취소하면 되돌릴 수 없어요. 좌석은 다른 관객이 예매할 수 있게 돼요.</p>
      {error && (
        <Notice
          tone={error.code === 'ALREADY_CANCELLED' || error.code === 'PERFORMANCE_CLOSED' || error.code === 'RATE_LIMITED' ? 'warn' : 'error'}
          className="dsum__err"
          title={
            error.code === 'ALREADY_CANCELLED'
              ? '이미 취소된 예매예요'
              : error.code === 'PERFORMANCE_CLOSED'
                ? '시작한 회차는 취소할 수 없어요'
                : error.code === 'RESERVATION_NOT_FOUND'
                  ? '예매를 찾을 수 없어요'
                  : error.isServerTrouble
                    ? '잠시 후 다시 시도해 주세요'
                    : '취소하지 못했어요'
          }
          requestId={error.supportId}
        >
          <p>{error.message}</p>
        </Notice>
      )}
    </Dialog>
  );
}
