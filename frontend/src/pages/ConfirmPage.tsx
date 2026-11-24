import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { api, toApiError, type ApiError, type PaymentMethod, type ShowDetail } from '../api';
import { useAuth } from '../auth';
import { clearBooking, getBooking, setHold, type BookingSession } from '../booking';
import { invalidate, useResource } from '../data';
import { clock, fullDateTime, PAYMENT_LABEL, seatLabel, spokenDuration, won } from '../format';
import { useBookingChrome, usePageTitle } from '../shell';
import { Badge, Notice, retryWaitSec, Spinner, useCountdown, useSecondsUntil } from '../components/bits';
import { Icon } from '../components/Icon';
import { Dialog } from '../components/overlay';
import { PosterArt } from '../components/PosterArt';
import { uuidv4 } from '../uuid';

export function ConfirmPage() {
  const { performanceId: pid } = useParams();
  const perfId = Number(pid);
  usePageTitle('예매 확인·결제');
  // sessionStorage는 처음 한 번만 읽는다(확정 직후 clearBooking 뒤 다시 렌더될 때 예외가 나지 않게)
  const [s] = useState(() => getBooking(perfId));
  if (!s) return <Navigate to={`/book/${perfId}/queue`} replace />;
  if (!s.hold || Date.parse(s.hold.expiresAt) <= Date.now()) {
    return (
      <Navigate
        to={`/book/${perfId}/seats`}
        replace
        state={s.hold ? { notice: { tone: 'warn', title: '좌석 확보 시간이 지났어요', message: '좌석을 다시 골라 주세요.' } } : undefined}
      />
    );
  }
  return <ConfirmView perfId={perfId} session={s} hold={s.hold} />;
}

const METHODS: PaymentMethod[] = ['CARD', 'EASY_PAY', 'BANK_TRANSFER'];

/** 이메일 가리기(화면 표시용): ab***@example.com */
function maskEmail(email: string) {
  const [l = '', d = ''] = email.split('@');
  return `${l.slice(0, Math.min(2, l.length))}***@${d}`;
}

/**
 * 예매 확인·결제(03 문서 4.9, 5.1).
 * 예매 정보 → 예매자(계정) → 티켓 수령(모바일 티켓) → 모의 결제 수단(입력칸 없음) → 동의 → 결제하고 예매 완료.
 * 실제 결제는 없다. 고른 수단 이름만 예매에 기록된다(계약 v4 paymentMethod).
 */
function ConfirmView({ perfId, session, hold }: { perfId: number; session: BookingSession; hold: NonNullable<BookingSession['hold']> }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const left = useSecondsUntil(hold.expiresAt) ?? 0;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const [agree, setAgree] = useState({ cancel: false, share: false });
  const [policy, setPolicy] = useState(false);
  const [expired, setExpired] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const finished = useRef(false); // 화면을 떠나는 중이면 더는 상태를 바꾸지 않는다
  const wait = useCountdown(retryWaitSec(error), error);
  useBookingChrome('confirm', '예매 확인·결제', hold.expiresAt, '좌석 확보 남은 시간');

  // 포스터용 공연 정보(실패해도 예매에는 영향 없음)
  const [show] = useResource<ShowDetail>(session.showId ? `show:${session.showId}` : null, (signal) => api.getShow(session.showId!, signal));
  const s = show.kind === 'ready' ? show.data : null;

  const backToSeats = (title: string, message: string) => {
    finished.current = true;
    navigate(`/book/${perfId}/seats`, { replace: true, state: { notice: { tone: 'warn', title, message } } });
  };

  useEffect(() => {
    if (left > 0 || inFlight.current || finished.current) return;
    setHold(perfId, null);
    setExpired(true);
  }, [left, perfId]);

  const allAgreed = agree.cancel && agree.share;

  async function confirm() {
    if (inFlight.current || wait > 0 || !allAgreed) return;
    // 같은 선점(holdId)을 다시 확정하는 것은 같은 제출의 재시도 → 같은 멱등키
    if (!keyRef.current) keyRef.current = uuidv4();
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const reservation = await api.createReservation(hold.holdId, session.queueToken, keyRef.current, method);
      finished.current = true;
      clearBooking();
      invalidate('show'); // 잔여석이 바뀌었다
      invalidate('rank');
      navigate('/complete', { replace: true, state: { reservation } });
      return;
    } catch (err) {
      const e = toApiError(err);
      if (!e.isRetryable) keyRef.current = null;
      switch (e.code) {
        case 'UNAUTHENTICATED':
          finished.current = true; // 로그인 화면으로 보내는 일은 AuthProvider가 한다
          return;
        case 'HOLD_EXPIRED':
          setHold(perfId, null);
          backToSeats('좌석 확보가 풀렸어요', e.message);
          return;
        case 'SEAT_TAKEN':
          setHold(perfId, null);
          backToSeats('이미 판매된 좌석이 있어요', e.message);
          return;
        case 'QUEUE_TOKEN_INVALID':
          finished.current = true;
          clearBooking();
          navigate(`/book/${perfId}/queue`, {
            replace: true,
            state: { showId: session.showId, notice: { tone: 'warn', title: '입장 시간이 지나 대기열에 다시 들어왔어요', message: '순서가 되면 좌석을 다시 고를 수 있어요.' } },
          });
          return;
        case 'QUEUE_NOT_ADMITTED':
          finished.current = true;
          navigate(`/book/${perfId}/queue`, { replace: true });
          return;
        default:
          setError(e);
      }
    } finally {
      inFlight.current = false;
      if (!finished.current) setPending(false);
    }
  }

  const urgent = left < 60;
  const meta = session.meta;
  const retrying = !!error?.isRetryable && keyRef.current !== null;
  const cta = pending ? (
    <><Spinner /> 예매하는 중…</>
  ) : wait > 0 ? (
    `${wait}초 뒤에 다시 시도`
  ) : retrying ? (
    '다시 시도'
  ) : (
    '결제하고 예매 완료'
  );
  const ctaDisabled = pending || wait > 0 || !allAgreed;

  return (
    <div className="page page--confirm">
      <div className="wrap confirm">
        <h1 className="sr-only" tabIndex={-1}>예매 확인·결제</h1>
        <p className="sr-only" aria-live="assertive">
          {left === 60 ? '좌석 확보 시간이 1분 남았어요.' : left === 10 ? '10초 남았어요.' : ''}
        </p>
        <div className="confirm__main">
          <section className="csec" aria-labelledby="c1">
            <h2 id="c1" className="csec__title">① 예매 정보</h2>
            <div className="cbox">
              <div className="cbox__show">
                <span className="thumb thumb--72" aria-hidden="true">
                  {s && <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} eager />}
                </span>
                <div>
                  <p className="cbox__title">{meta?.showTitle ?? s?.title}</p>
                  {meta && <p className="cbox__meta">{fullDateTime(meta.startsAt)} · {meta.venue}</p>}
                </div>
              </div>
              <dl className="cbox__seats">
                <dt>좌석</dt>
                <dd>
                  <ul>
                    {session.heldSeats.map((st) => (
                      <li key={st.id}>
                        <span className="cbox__pos">{seatLabel(st)}</span>
                        <span className="cbox__grade">{st.gradeName}</span>
                        <span className="cbox__price">{won(st.price)}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </dl>
              <Link className="text-btn cbox__again" to={`/book/${perfId}/seats`}>좌석 다시 고르기</Link>
            </div>
          </section>

          <section className="csec" aria-labelledby="c2">
            <div className="csec__head">
              <h2 id="c2" className="csec__title">② 예매자 정보</h2>
              <span className="csec__aside">계정 정보로 예매돼요</span>
            </div>
            {user && (
              <dl className="buyer">
                <div><dt>이름</dt><dd>{user.name}</dd></div>
                <div><dt>이메일</dt><dd>{maskEmail(user.email)}</dd></div>
              </dl>
            )}
          </section>

          <section className="csec" aria-labelledby="c3">
            <h2 id="c3" className="csec__title">③ 티켓 수령</h2>
            <label className="rcard rcard--wide">
              <input type="radio" className="radio-dot" name="delivery" checked readOnly />
              <span className="rcard__name">모바일 티켓</span>
              <span className="rcard__aux">내 예매에서 확인</span>
            </label>
          </section>

          <section className="csec" aria-labelledby="c4">
            <div className="csec__head">
              <h2 id="c4" className="csec__title">④ 결제 수단</h2>
              <Badge kind="mock">실습용 모의 결제</Badge>
            </div>
            <fieldset className="paygrid">
              <legend className="sr-only">결제 수단</legend>
              {METHODS.map((m) => (
                <label key={m} className="rcard">
                  <input type="radio" className="radio-dot" name="pay" value={m} checked={method === m} onChange={() => setMethod(m)} />
                  <span className="rcard__name">{PAYMENT_LABEL[m]}</span>
                </label>
              ))}
            </fieldset>
            <p className="csec__note">카드 번호 같은 결제 정보는 받지 않아요. 고른 수단은 예매 내역에만 기록돼요.</p>
          </section>

          <section className="csec" aria-labelledby="c5">
            <h2 id="c5" className="csec__title">⑤ 동의</h2>
            <div className="agree">
              <label className="check check--all">
                <input
                  type="checkbox"
                  checked={allAgreed}
                  onChange={(e) => setAgree({ cancel: e.target.checked, share: e.target.checked })}
                />
                <span className="check__text">전체 동의</span>
              </label>
              <div className="agree__items">
                <div className="agree__row">
                  <label className="check">
                    <input type="checkbox" checked={agree.cancel} onChange={(e) => setAgree((a) => ({ ...a, cancel: e.target.checked }))} />
                    <span className="check__text"><span className="check__req">(필수)</span>취소 마감 시각과 취소 규정을 확인했어요</span>
                  </label>
                  <button type="button" className="text-btn" onClick={() => setPolicy(true)}>
                    보기 <Icon name="right" size={14} />
                  </button>
                </div>
                <label className="check">
                  <input type="checkbox" checked={agree.share} onChange={(e) => setAgree((a) => ({ ...a, share: e.target.checked }))} />
                  <span className="check__text"><span className="check__req">(필수)</span>예매자 정보(이름)가 공연 주최 측에 전달되는 데 동의해요(실습 문구)</span>
                </label>
              </div>
            </div>
          </section>

          {error && <div className="confirm__error"><ConfirmError error={error} showId={session.showId} /></div>}
        </div>

        <aside className="paybox" aria-labelledby="paybox-h">
          <h2 id="paybox-h" className="sr-only">결제 금액</h2>
          <p className={`paybox__timer${urgent ? ' is-urgent' : ''}`}>
            <span>좌석 확보 남은 시간</span>
            <span className="paybox__clock" role="timer" aria-label={`좌석 확보 남은 시간 ${spokenDuration(left)}`}>
              <span aria-hidden="true">{clock(left)}</span>
            </span>
          </p>
          <hr className="paybox__line" />
          <dl className="paybox__rows">
            <div><dt>티켓 금액</dt><dd>{won(hold.totalPrice)}</dd></div>
            <div><dt>예매 수수료</dt><dd>0원</dd></div>
          </dl>
          <hr className="paybox__line" />
          <p className="paybox__total">
            <span>총 결제 금액</span>
            <strong>{won(hold.totalPrice)}</strong>
          </p>
          <button type="button" className="btn btn--primary btn--l btn--block paybox__cta" onClick={() => void confirm()} disabled={ctaDisabled}>
            {cta}
          </button>
          {!allAgreed && <p className="paybox__hint">필수 동의를 모두 체크하면 누를 수 있어요</p>}
          <p className="paybox__note">실제 결제는 일어나지 않아요</p>
        </aside>
      </div>

      {/* 모바일 하단 고정 막대 76 */}
      <div className="paybar">
        <p className="paybar__total">
          <span className="sr-only">총 결제 금액 </span>총 <strong className="tnum">{won(hold.totalPrice)}</strong>
        </p>
        <button type="button" className="btn btn--primary btn--l paybar__cta" onClick={() => void confirm()} disabled={ctaDisabled}>
          {cta}
        </button>
      </div>

      <Dialog
        open={policy}
        onClose={() => setPolicy(false)}
        title="취소 규정"
        actions={<button type="button" className="btn btn--primary btn--m" onClick={() => setPolicy(false)}>확인</button>}
      >
        <table className="ctable ctable--dialog">
          <caption className="sr-only">취소 규정</caption>
          <thead><tr><th scope="col">취소 가능 시점</th><th scope="col">수수료</th></tr></thead>
          <tbody>
            <tr><td>예매 후 ~ 회차 시작 전</td><td>없음</td></tr>
            <tr><td>회차 시작 이후</td><td>취소할 수 없음</td></tr>
          </tbody>
        </table>
        <p>취소는 내 예매에서 할 수 있어요. 실습 서비스라 실제 환불은 일어나지 않아요.</p>
      </Dialog>

      <Dialog
        open={expired}
        onClose={() => undefined}
        backdropClose={false}
        title="좌석 확보 시간이 지났어요"
        actions={
          <button
            type="button"
            className="btn btn--primary btn--m"
            onClick={() => backToSeats('좌석 확보 시간이 지났어요', '좌석이 다시 풀렸어요. 남아 있는 좌석에서 다시 골라 주세요.')}
          >
            좌석 다시 고르기
          </button>
        }
      >
        <p>고른 좌석이 다시 풀렸어요. 남아 있는 좌석에서 다시 골라 주세요.</p>
      </Dialog>
    </div>
  );
}

function ConfirmError({ error, showId }: { error: ApiError; showId: number | null }) {
  switch (error.code) {
    case 'NETWORK_ERROR':
      return (
        <Notice tone="error" title="예매 결과를 확인하지 못했어요">
          <p>{error.message}</p>
          <p>다시 시도해도 같은 예매로 처리되어 두 번 예매되지 않아요.</p>
        </Notice>
      );
    case 'RATE_LIMITED':
      return <Notice tone="warn" title="요청이 잠시 막혔어요"><p>{error.message}</p></Notice>;
    case 'BOOKING_LIMIT_EXCEEDED':
      return (
        <Notice tone="warn" title="이 회차는 한 계정에 4석까지 예매할 수 있어요" actions={<Link className="btn btn--line btn--s" to="/my/reservations">내 예매 보기</Link>}>
          <p>{error.message}</p>
          <p>이미 예매한 좌석과 합쳐 4석을 넘지 않도록 좌석을 줄여 다시 골라 주세요.</p>
        </Notice>
      );
    case 'NOT_ON_SALE':
      return (
        <Notice tone="warn" title="지금은 예매할 수 없는 회차예요" actions={showId ? <Link className="btn btn--line btn--s" to={`/shows/${showId}`}>다른 회차 보기</Link> : undefined}>
          <p>{error.message}</p>
        </Notice>
      );
    default:
      return (
        <Notice tone="error" title={error.isServerTrouble ? '잠시 후 다시 시도해 주세요' : '예매하지 못했어요'} requestId={error.supportId}>
          <p>{error.message}</p>
          {error.isRetryable && <p>결제하고 예매 완료 단추로 다시 시도할 수 있어요. 같은 예매로 처리되어 두 번 예매되지 않아요.</p>}
        </Notice>
      );
  }
}
