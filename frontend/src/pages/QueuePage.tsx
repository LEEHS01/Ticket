import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, toApiError, type ApiError, type QueueState, type ShowDetail } from '../api';
import { anyBooking, clearBooking, getBooking, setAdmitted, startBooking } from '../booking';
import { shortDateTime } from '../format';
import { useBookingChrome, usePageTitle } from '../shell';
import { Illust, retryDelayMs, retryWaitSec, Notice, readNotice, Spinner, useCountdown, usePoller } from '../components/bits';
import { PosterArt } from '../components/PosterArt';

/** 숨겨진 탭의 대기 상태 확인 간격. 서버는 30초 동안 폴링이 없으면 대기열에서 뺀다(계약 3.2.1). */
const HIDDEN_POLL_MS = 10_000;

type Phase =
  | { kind: 'entering' }
  | { kind: 'waiting'; position: number; first: number }
  | { kind: 'enterError'; error: ApiError }
  | { kind: 'expired' };

/** 대기(03 문서 4.7): 가운데 상자 480. 들어가는 중 · 대기 · 곧 입장 · 만료 · 오류 */
export function QueuePage() {
  const { performanceId: pid } = useParams();
  const perfId = Number(pid);
  const navigate = useNavigate();
  const location = useLocation();
  const stateShowId = (location.state as { showId?: unknown } | null)?.showId;
  const notice = readNotice(location.state);
  const [phase, setPhase] = useState<Phase>({ kind: 'entering' });
  const [trouble, setTrouble] = useState<ApiError | null>(null);
  const failures = useRef(0);
  const [kick, setKick] = useState(0);
  const [show, setShow] = useState<ShowDetail | null>(null);
  const [enterAttempt, setEnterAttempt] = useState(0);
  const enterRef = useRef<Promise<QueueState> | null>(null);
  const [storedShowId] = useState(() => getBooking(perfId)?.showId ?? null);
  const showId = typeof stateShowId === 'number' ? stateShowId : storedShowId;
  usePageTitle('입장 대기');
  useBookingChrome('queue', '입장 대기', null);

  const goSeats = () => navigate(`/book/${perfId}/seats`, { replace: true });

  // 1) 대기열 진입(이 회차 토큰이 없을 때만). StrictMode의 이중 실행에도 POST가 한 번만 나가도록 ref에 보관.
  useEffect(() => {
    if (!Number.isInteger(perfId)) return;
    const existing = getBooking(perfId);
    if (existing) {
      setPhase((p) => (p.kind === 'entering' ? { kind: 'waiting', position: -1, first: -1 } : p));
      return;
    }
    // 다른 회차의 진행 중인 예매가 있으면 그 자리는 반납
    const other = anyBooking();
    if (other) {
      void api.leaveQueue(other.queueToken).catch(() => undefined);
      clearBooking();
    }
    let alive = true;
    if (!enterRef.current) enterRef.current = api.enterQueue(perfId);
    enterRef.current.then(
      (q) => {
        if (!alive) return;
        if (q.queueToken) startBooking(perfId, showId, q.queueToken, q.admittedUntil);
        if (q.status === 'ADMITTED') goSeats();
        else setPhase({ kind: 'waiting', position: q.position, first: q.position });
      },
      (err) => {
        if (!alive) return;
        enterRef.current = null;
        const e = toApiError(err);
        if (e.code === 'UNAUTHENTICATED') return;
        setPhase({ kind: 'enterError', error: e });
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfId, enterAttempt]);

  // 공연 정보(제목·포스터) — 있으면 보여 주고, 실패해도 대기에는 영향 없음
  useEffect(() => {
    if (!showId) return;
    const ac = new AbortController();
    api.getShow(showId, ac.signal).then(setShow, () => undefined);
    return () => ac.abort();
  }, [showId]);

  // 2) 대기 상태 폴링: 서버가 알려준 pollAfterSeconds 간격, 숨김 탭은 10초, 429면 Retry-After,
  //    서버 일시 장애(5xx)·연결 끊김이면 화면을 버리지 않고 간격을 늘려 계속 확인한다.
  usePoller(
    async (signal) => {
      const s = getBooking(perfId);
      if (!s) return null;
      try {
        const q = await api.queueStatus(s.queueToken, signal);
        failures.current = 0;
        setTrouble(null);
        if (q.status === 'ADMITTED') {
          setAdmitted(perfId, q.admittedUntil);
          goSeats();
          return null;
        }
        setPhase((p) => ({
          kind: 'waiting',
          position: q.position,
          first: p.kind === 'waiting' && p.first > 0 ? Math.max(p.first, q.position) : q.position,
        }));
        return Math.min(30, Math.max(1, q.pollAfterSeconds)) * 1000;
      } catch (err) {
        if (signal.aborted) return null;
        const e = toApiError(err);
        if (e.code === 'UNAUTHENTICATED') return null; // 로그인 화면 이동은 AuthProvider가
        if (e.code === 'QUEUE_TOKEN_INVALID') {
          clearBooking();
          setPhase({ kind: 'expired' });
          return null;
        }
        if (e.code === 'RATE_LIMITED') return Math.max(1, e.retryAfterSec ?? 5) * 1000;
        failures.current += 1;
        setTrouble(e);
        return retryDelayMs(e, failures.current);
      }
    },
    { enabled: phase.kind === 'waiting', hiddenDelayMs: HIDDEN_POLL_MS, restartKey: kick },
  );

  async function leave() {
    const s = getBooking(perfId);
    if (s) await api.leaveQueue(s.queueToken).catch(() => undefined);
    clearBooking();
    navigate(showId ? `/shows/${showId}` : '/', { replace: true });
  }

  const retryEnter = () => {
    setPhase({ kind: 'entering' });
    setEnterAttempt((n) => n + 1);
  };
  const perf = show?.performances.find((p) => p.id === perfId);
  const back = showId ? `/shows/${showId}` : '/';

  return (
    <div className="page page--queue">
      <div className="wrap">
        <div className="qbox">
          {show ? (
            <div className="qbox__show">
              <span className="thumb thumb--72" aria-hidden="true">
                <PosterArt showId={show.id} poster={show.poster} title={show.title} genre={show.genre} eager />
              </span>
              <div className="qbox__what">
                <p className="qbox__title">{show.title}</p>
                <p className="qbox__meta">{perf ? `${shortDateTime(perf.startsAt)} · ` : ''}{show.venue}</p>
              </div>
            </div>
          ) : (
            <div className="qbox__show" aria-hidden="true">
              <span className="skel thumb thumb--72" />
              <div className="qbox__what"><span className="skel skel--line14" /><span className="skel skel--line12" /></div>
            </div>
          )}
          <hr className="qbox__line" />

          {notice && <Notice tone={notice.tone} title={notice.title} className="qbox__notice">{notice.message && <p>{notice.message}</p>}</Notice>}

          {phase.kind === 'entering' && (
            <div className="qbox__state">
              <Illust name="illust-queue" icon="hourglass" />
              <h1 className="qbox__h" tabIndex={-1}>대기열에 들어가는 중</h1>
              <p className="qbox__wait" role="status"><Spinner /> 잠시만 기다려 주세요</p>
            </div>
          )}

          {phase.kind === 'waiting' && (
            <div className="qbox__state">
              <Illust name="illust-queue" icon="hourglass" />
              {phase.position === 0 ? (
                // 앞에 기다리는 사람은 없지만 입장 인원이 꽉 차 자리가 나기를 기다리는 상태
                <>
                  <h1 className="qbox__h" tabIndex={-1}>곧 입장해요</h1>
                  <p className="qbox__soon" aria-live="polite">좌석 화면에 있는 관객 중 한 명이 나가면 바로 들어가요</p>
                  <span className="qbar"><span className="qbar__fill qbar__fill--full" /></span>
                </>
              ) : (
                <>
                  <h1 className="qbox__h" tabIndex={-1}>입장 순서를 기다리고 있어요</h1>
                  {phase.position > 0 ? (
                    <>
                      <p className="qbox__pos" aria-live="polite">
                        <span className="qbox__label">내 앞에</span>
                        <span className="qbox__n">{phase.position.toLocaleString('ko-KR')}</span>
                        <span className="qbox__label">명</span>
                      </p>
                      <progress
                        className="qbar"
                        max={Math.max(1, phase.first)}
                        value={Math.max(0, phase.first - phase.position)}
                        aria-label="대기 진행"
                      />
                    </>
                  ) : (
                    <p className="qbox__wait" role="status"><Spinner /> 순서를 확인하는 중</p>
                  )}
                </>
              )}
              {trouble && (
                <Notice
                  tone="warn"
                  title="잠시 후 다시 시도할게요"
                  className="qbox__notice"
                  actions={<button type="button" className="btn btn--line btn--s" onClick={() => setKick((n) => n + 1)}>지금 다시 시도</button>}
                >
                  <p>{trouble.message}</p>
                  <p>순서는 그대로예요. 화면을 닫지 말고 기다려 주세요.</p>
                </Notice>
              )}
              <ul className="qbox__tips">
                <li>이 화면을 닫거나 30초 넘게 연결이 끊기면 순서를 잃어요</li>
                <li>새로 고쳐도 순서는 그대로예요</li>
                <li>차례가 되면 좌석 선택 화면으로 자동으로 넘어가요</li>
              </ul>
              <button type="button" className="btn btn--line btn--m qbox__leave" onClick={() => void leave()}>대기 그만두기</button>
            </div>
          )}

          {phase.kind === 'expired' && (
            <div className="qbox__state">
              <Illust name="illust-queue" icon="clock" />
              <h1 className="qbox__h" tabIndex={-1}>대기 시간이 지났어요</h1>
              <p className="qbox__soon">순서 확인이 한동안 끊겨 대기열에서 빠졌어요. 다시 줄을 서면 맨 뒤에서 시작해요.</p>
              <div className="qbox__actions">
                <button type="button" className="btn btn--primary btn--m" onClick={retryEnter}>다시 줄 서기</button>
                <Link className="btn btn--line btn--m" to={back}>공연 정보로</Link>
              </div>
            </div>
          )}

          {phase.kind === 'enterError' && <EnterError error={phase.error} back={back} onRetry={retryEnter} />}
        </div>
      </div>
    </div>
  );
}

function EnterError({ error, back, onRetry }: { error: ApiError; back: string; onRetry: () => void }) {
  const wait = useCountdown(retryWaitSec(error), error);
  const titles: Record<string, string> = {
    NOT_ON_SALE: '지금은 예매할 수 없는 회차예요',
    SOLD_OUT: '매진된 회차예요',
    PERFORMANCE_NOT_FOUND: '회차를 찾을 수 없어요',
    RATE_LIMITED: '요청이 잠시 막혔어요',
  };
  const retryable = error.isRetryable;
  const title = titles[error.code] ?? (error.isServerTrouble ? '잠시 후 다시 시도해 주세요' : '대기열에 들어가지 못했어요');
  return (
    <div className="qbox__state">
      <h1 className="qbox__h" tabIndex={-1}>{title}</h1>
      <Notice tone={retryable ? 'error' : 'warn'} title={error.message} requestId={error.supportId} className="qbox__notice">
        {error.code === 'SOLD_OUT' && <p>다른 날짜나 회차를 골라 보세요.</p>}
      </Notice>
      <div className="qbox__actions">
        {retryable && (
          <button type="button" className="btn btn--primary btn--m" onClick={onRetry} disabled={wait > 0}>
            {wait > 0 ? `${wait}초 뒤에 다시 시도` : '다시 시도'}
          </button>
        )}
        <Link className="btn btn--line btn--m" to={back}>공연 정보로</Link>
      </div>
    </div>
  );
}
