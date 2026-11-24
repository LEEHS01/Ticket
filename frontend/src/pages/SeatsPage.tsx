import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { api, toApiError, type ApiError, type Seat, type SeatMap as SeatMapData } from '../api';
import { clearBooking, getBooking, setHold, setShowId, type HeldSeat } from '../booking';
import { useIsMobile } from '../data';
import { clock, seatLabel, shortDateTime, spokenDuration, won } from '../format';
import { useBookingChrome, usePageTitle } from '../shell';
import { Notice, readNotice, retryDelayMs, retryWaitSec, Spinner, useCountdown, usePoller, useSecondsUntil, type NoticeData } from '../components/bits';
import { Icon } from '../components/Icon';
import { Dialog, useToast } from '../components/overlay';
import { SeatLegend, SeatMap } from '../components/SeatMap';

/** 좌석 상태 갱신 간격(계약: 3~5초). 탭이 숨겨지면 멈추고, 다시 보이면 즉시 갱신 */
const SEAT_POLL_MS = 4000;
const MAX_SEATS = 4;
const PINCH_HINT_KEY = 'mirinae.hint.pinch';

export function SeatsPage() {
  const { performanceId: pid } = useParams();
  const perfId = Number(pid);
  // 진입 시 한 번만 읽는다(렌더 중 sessionStorage 상태 변화에 흔들리지 않게)
  const [session] = useState(() => getBooking(perfId));
  usePageTitle('좌석 선택');
  // 토큰 없이 바로 들어오면 대기열부터(서버도 막지만 화면에서도 순서를 지킨다)
  if (!session) return <Navigate to={`/book/${perfId}/queue`} replace />;
  return <SeatsInner key={perfId} perfId={perfId} admittedUntil={session.admittedUntil} />;
}

/** 좌석 선택(03 문서 4.8). PC: 배치도 836 + 선택 상자 340. 모바일: 등급 칩 줄 + 배치도 + 하단 고정 판 */
function SeatsInner({ perfId, admittedUntil }: { perfId: number; admittedUntil: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const mobile = useIsMobile();
  const [map, setMap] = useState<SeatMapData | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [stale, setStale] = useState(false);
  const failures = useRef(0);
  const [kick, setKick] = useState(0);
  const [notice, setNotice] = useState<NoticeData | null>(() => readNotice(location.state));
  const [pending, setPending] = useState(false);
  const [holdError, setHoldError] = useState<ApiError | null>(null);
  const holdWait = useCountdown(retryWaitSec(holdError), holdError);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const inFlight = useRef(false);
  const initialized = useRef(false);
  const left = useSecondsUntil(admittedUntil);
  const [timeUp, setTimeUp] = useState(false);
  useBookingChrome('seats', '좌석 선택', admittedUntil, '좌석 선택 남은 시간');

  const token = () => getBooking(perfId)?.queueToken ?? '';

  /** 토큰 문제는 대기열로 돌려보낸다 */
  const handleTokenError = useCallback(
    (e: ApiError): boolean => {
      if (e.code === 'QUEUE_TOKEN_INVALID') {
        const showId = getBooking(perfId)?.showId ?? null;
        clearBooking();
        navigate(`/book/${perfId}/queue`, {
          replace: true,
          state: { showId, notice: { tone: 'warn', title: '입장 시간이 지나 대기열에 다시 들어왔어요', message: '순서가 되면 좌석 화면으로 다시 넘어가요.' } },
        });
        return true;
      }
      if (e.code === 'QUEUE_NOT_ADMITTED') {
        navigate(`/book/${perfId}/queue`, { replace: true });
        return true;
      }
      return false;
    },
    [navigate, perfId],
  );

  /** 새 배치도 반영: 내가 고른 좌석이 남에게 넘어갔으면 선택에서 빼고 알린다 */
  const apply = useCallback(
    (m: SeatMapData) => {
      setMap(m);
      setShowId(perfId, m.performance.showId);
      const byId = new Map(m.seats.map((s) => [s.id, s]));
      if (!initialized.current) {
        initialized.current = true;
        setSelected(new Set(m.seats.filter((s) => s.status === 'MINE').map((s) => s.id)));
        return;
      }
      setSelected((prev) => {
        const lost = [...prev].filter((id) => {
          const st = byId.get(id)?.status;
          return st === 'HELD' || st === 'SOLD' || st === undefined;
        });
        if (lost.length === 0) return prev;
        const names = lost.map((id) => byId.get(id)).filter((s): s is Seat => !!s).map(seatLabel).join(', ');
        setNotice({ tone: 'warn', title: '방금 다른 분이 고른 좌석이 있어요', message: `${names} 좌석을 선택에서 뺐어요. 다시 골라 주세요.` });
        const next = new Set(prev);
        lost.forEach((id) => next.delete(id));
        return next;
      });
    },
    [perfId],
  );

  usePoller(
    async (signal) => {
      try {
        const m = await api.getSeats(perfId, token(), signal);
        failures.current = 0;
        setLoadError(null);
        setStale(false);
        apply(m);
        return SEAT_POLL_MS;
      } catch (err) {
        if (signal.aborted) return null;
        const e = toApiError(err);
        if (e.code === 'UNAUTHENTICATED') return null; // 로그인 화면 이동은 AuthProvider가
        if (handleTokenError(e)) return null;
        if (e.code === 'RATE_LIMITED') return Math.max(1, e.retryAfterSec ?? 5) * 1000;
        setLoadError(e);
        if (e.code === 'PERFORMANCE_NOT_FOUND') return null;
        // 서버 일시 장애(5xx)·연결 끊김: 화면을 버리지 않고 간격을 늘려 계속
        failures.current += 1;
        setStale(true);
        return retryDelayMs(e, failures.current);
      }
    },
    { enabled: !timeUp, hiddenDelayMs: null, restartKey: kick },
  );

  // 좌석 선택 남은 시간이 끝나면 대화상자
  useEffect(() => {
    if (left === 0 && !inFlight.current) setTimeUp(true);
  }, [left]);

  // 모바일 첫 진입: 확대 안내 한 번
  useEffect(() => {
    if (!mobile || !map) return;
    try {
      if (localStorage.getItem(PINCH_HINT_KEY)) return;
      localStorage.setItem(PINCH_HINT_KEY, '1');
    } catch {
      return;
    }
    toast('두 손가락으로 확대할 수 있어요');
  }, [mobile, map, toast]);

  function toggle(seat: Seat) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(seat.id)) next.delete(seat.id);
      else if (next.size >= MAX_SEATS) {
        toast(`한 번에 ${MAX_SEATS}석까지 고를 수 있어요`);
        return prev;
      } else next.add(seat.id);
      return next;
    });
  }

  async function hold() {
    if (!map || inFlight.current || selected.size === 0 || holdWait > 0) return;
    inFlight.current = true;
    setPending(true);
    setHoldError(null);
    setNotice(null);
    const ids = [...selected];
    try {
      const h = await api.holdSeats(perfId, ids, token());
      const gradeOf = new Map(map.grades.map((g) => [g.code, g]));
      const held: HeldSeat[] = h.seatIds.map((id) => {
        const s = map.seats.find((x) => x.id === id)!;
        const g = gradeOf.get(s.grade);
        return { id, row: s.row, number: s.number, grade: s.grade, gradeName: g?.name ?? s.grade, price: g?.price ?? 0 };
      });
      held.sort((a, b) => a.row.localeCompare(b.row) || a.number - b.number);
      const { id: _omit, ...meta } = map.performance;
      void _omit;
      setHold(perfId, h, held, meta);
      navigate(`/book/${perfId}/confirm`);
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'UNAUTHENTICATED') return;
      if (handleTokenError(e)) return;
      if (e.code === 'SEAT_TAKEN') {
        const taken = e.takenSeatIds;
        const names = taken.map((id) => map.seats.find((s) => s.id === id)).filter((s): s is Seat => !!s).map(seatLabel);
        setSelected((prev) => new Set([...prev].filter((id) => !taken.includes(id))));
        setNotice({
          tone: 'warn',
          title: '방금 다른 분이 고른 좌석이 있어요. 다시 골라 주세요',
          message: names.length ? `${names.join(', ')} 좌석을 선택에서 뺐어요. 나머지 좌석은 고른 채로 두었어요.` : e.message,
        });
        api.getSeats(perfId, token()).then(apply, () => undefined);
      } else {
        setHoldError(e);
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function leaveToShow() {
    const s = getBooking(perfId);
    if (s) await api.leaveQueue(s.queueToken).catch(() => undefined);
    clearBooking();
    navigate(map ? `/shows/${map.performance.showId}` : s?.showId ? `/shows/${s.showId}` : '/', { replace: true });
  }

  const gradeOf = useMemo(() => new Map((map?.grades ?? []).map((g) => [g.code, g])), [map]);
  const remaining = useMemo(() => {
    const r = new Map<string, number>();
    for (const s of map?.seats ?? []) if (s.status === 'AVAILABLE') r.set(s.grade, (r.get(s.grade) ?? 0) + 1);
    return r;
  }, [map]);

  const timeUpDialog = (
    <Dialog
      open={timeUp}
      onClose={() => undefined}
      backdropClose={false}
      title="좌석 선택 시간이 지났어요"
      actions={<button type="button" className="btn btn--primary btn--m" onClick={() => void leaveToShow()}>공연 정보로</button>}
    >
      <p>입장 시간이 끝나 고르던 좌석이 풀렸어요. 다시 예매하려면 공연 정보에서 회차를 골라 주세요.</p>
    </Dialog>
  );

  if (!map) {
    if (loadError && !stale) {
      return (
        <div className="page page--seats">
          <div className="wrap">
            <h1 className="sr-only" tabIndex={-1}>좌석 선택</h1>
            <Notice tone="error" title="좌석 정보를 불러오지 못했어요" requestId={loadError.supportId} actions={<Link className="btn btn--line btn--s" to="/">홈으로</Link>}>
              <p>{loadError.message}</p>
            </Notice>
          </div>
        </div>
      );
    }
    return (
      <div className="page page--seats" aria-busy="true">
        <div className="wrap">
          <h1 className="sr-only" tabIndex={-1}>좌석 선택</h1>
          <p className="sr-only" role="status">좌석 배치도를 불러오는 중</p>
          {loadError && (
            <Notice tone="warn" title="잠시 후 다시 시도할게요" actions={<button type="button" className="btn btn--line btn--s" onClick={() => setKick((n) => n + 1)}>지금 다시 시도</button>}>
              <p>{loadError.message}</p>
            </Notice>
          )}
          <div className="seats">
            <span className="skel seats__mapskel" aria-hidden="true" />
            <span className="skel skel--block selbox selbox--skel" aria-hidden="true" />
          </div>
        </div>
        {timeUpDialog}
      </div>
    );
  }

  const picked = map.seats.filter((s) => selected.has(s.id)).sort((a, b) => a.row.localeCompare(b.row) || a.number - b.number);
  const total = picked.reduce((n, s) => n + (gradeOf.get(s.grade)?.price ?? 0), 0);
  const urgent = left !== null && left < 60;

  const alerts = (
    <>
      {notice && <Notice tone={notice.tone} title={notice.title}>{notice.message && <p>{notice.message}</p>}</Notice>}
      {stale && loadError && (
        <Notice
          tone="warn"
          title="좌석 상태를 새로 받지 못하고 있어요"
          actions={<button type="button" className="btn btn--line btn--s" onClick={() => setKick((n) => n + 1)}>지금 다시 시도</button>}
        >
          <p>{loadError.message} 화면의 좌석 상태가 최신이 아닐 수 있어요. 잠시 후 자동으로 다시 시도해요.</p>
        </Notice>
      )}
      {holdError && (
        <Notice
          tone={holdError.code === 'RATE_LIMITED' || holdError.code === 'NOT_ON_SALE' ? 'warn' : 'error'}
          title={holdError.isServerTrouble ? '잠시 후 다시 시도해 주세요' : '좌석을 확보하지 못했어요'}
          requestId={holdError.supportId}
          actions={
            holdError.isRetryable ? (
              <button type="button" className="btn btn--line btn--s" onClick={() => void hold()} disabled={pending || holdWait > 0}>
                {holdWait > 0 ? `${holdWait}초 뒤에 다시 시도` : '다시 시도'}
              </button>
            ) : undefined
          }
        >
          <p>{holdError.message}</p>
        </Notice>
      )}
    </>
  );

  const submitLabel = pending ? (
    <><Spinner /> 좌석 확보하는 중…</>
  ) : picked.length === 0 ? '좌석을 골라 주세요' : '좌석 선택 완료';

  return (
    <div className="page page--seats">
      <h1 className="sr-only" tabIndex={-1}>좌석 선택</h1>
      <p className="sr-only" aria-live="polite">{picked.length}석 선택, 합계 {won(total)}</p>

      {/* 모바일: 등급 범례 칩 줄(누르면 그 등급 좌석 강조) */}
      <div className="gradechips" role="group" aria-label="등급 강조">
        {map.grades.map((g, i) => (
          <button key={g.code} type="button" className="chip gradechip" aria-pressed={highlight === g.code} onClick={() => setHighlight((h) => (h === g.code ? null : g.code))}>
            <span className={`swatch g${i}`} aria-hidden="true" />
            {g.code} {g.price.toLocaleString('ko-KR')}
          </button>
        ))}
      </div>

      <div className="wrap">
        {(notice || stale || holdError) && <div className="seats__alerts">{alerts}</div>}
        <div className="seats">
          <div className="seats__left">
            <div className="seats__map">
              <SeatMap map={map} selected={selected} onToggle={toggle} highlight={highlight} base={mobile ? 22 : 24} />
            </div>
            <div className="seats__legend">
              <SeatLegend grades={map.grades} remaining={remaining} />
            </div>
          </div>

          <aside className="selbox" aria-labelledby="selbox-h">
            <h2 id="selbox-h" className="selbox__show">{map.performance.showTitle}</h2>
            <p className="selbox__meta">{shortDateTime(map.performance.startsAt)} · {map.performance.venue}</p>
            {left !== null && (
              <p className={`selbox__timer${urgent ? ' is-urgent' : ''}`}>
                <span>좌석 선택 남은 시간</span>
                <span className="selbox__clock" role="timer" aria-label={`좌석 선택 남은 시간 ${spokenDuration(left)}`}>
                  <span aria-hidden="true">{clock(left)}</span>
                </span>
              </p>
            )}
            <hr className="selbox__line" />
            <p className="selbox__label">등급</p>
            <ul className="selbox__grades">
              {map.grades.map((g, i) => (
                <li key={g.code}>
                  <span className={`swatch g${i}`} aria-hidden="true" />
                  <span className="selbox__gname">{g.name}</span>
                  <span className="selbox__gprice">{won(g.price)}</span>
                  <span className="selbox__gleft">잔여 {remaining.get(g.code) ?? 0}</span>
                </li>
              ))}
            </ul>
            <hr className="selbox__line" />
            <p className="selbox__label">
              선택한 좌석 <span className="tnum">{picked.length}/{MAX_SEATS}</span>
            </p>
            {picked.length === 0 ? (
              <p className="selbox__empty">배치도에서 좌석을 눌러 고르세요. 최대 {MAX_SEATS}석</p>
            ) : (
              <ul className="selbox__picked">
                {picked.map((s) => (
                  <li key={s.id}>
                    <span>{seatLabel(s)} · {gradeOf.get(s.grade)?.name} {won(gradeOf.get(s.grade)?.price ?? 0)}</span>
                    <button type="button" className="icon-btn selbox__x" onClick={() => toggle(s)} aria-label={`${seatLabel(s)} 빼기`}>
                      <Icon name="close" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <hr className="selbox__line" />
            <p className="selbox__total">
              <span>합계</span>
              <strong className="tnum">{won(total)}</strong>
            </p>
            <button type="button" className="btn btn--primary btn--l btn--block" onClick={() => void hold()} disabled={pending || picked.length === 0}>
              {submitLabel}
            </button>
            <button type="button" className="text-btn selbox__reset" onClick={() => setSelected(new Set())} disabled={picked.length === 0 || pending}>
              다시 선택
            </button>
          </aside>
        </div>
      </div>

      {/* 모바일 하단 고정 판(접힘 112 / 펼침 최대 60vh) */}
      <div className={`seatsheet${expanded ? ' is-open' : ''}`}>
        <button
          type="button"
          className="seatsheet__toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="seatsheet-list"
        >
          <span className="seatsheet__handle" aria-hidden="true" />
          <span className="seatsheet__sum">
            선택 <span className="tnum">{picked.length}</span>석 · <span className="tnum">{won(total)}</span>
          </span>
          <span className="seatsheet__more">
            {expanded ? '접기' : '펼치기'}
            <Icon name={expanded ? 'down' : 'up'} size={16} />
          </span>
        </button>
        {expanded && (
          <div className="seatsheet__list" id="seatsheet-list">
            {picked.length === 0 ? (
              <p className="selbox__empty">배치도에서 좌석을 눌러 고르세요. 최대 {MAX_SEATS}석</p>
            ) : (
              <ul className="selbox__picked">
                {picked.map((s) => (
                  <li key={s.id}>
                    <span>{seatLabel(s)} · {gradeOf.get(s.grade)?.name} {won(gradeOf.get(s.grade)?.price ?? 0)}</span>
                    <button type="button" className="icon-btn selbox__x" onClick={() => toggle(s)} aria-label={`${seatLabel(s)} 빼기`}>
                      <Icon name="close" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button type="button" className="btn btn--primary btn--l btn--block" onClick={() => void hold()} disabled={pending || picked.length === 0}>
          {submitLabel}
        </button>
      </div>
      {timeUpDialog}
    </div>
  );
}
