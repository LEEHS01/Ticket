import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { api, type Reservation, type ShowDetail } from '../api';
import { useResource } from '../data';
import { fullDateTime, gradeName, groupCode, PAYMENT_LABEL, seatLabel, won } from '../format';
import { useBookingChrome, usePageTitle } from '../shell';
import { copyText } from '../components/bits';
import { Icon } from '../components/Icon';
import { PosterArt } from '../components/PosterArt';

function readReservation(state: unknown): Reservation | null {
  if (typeof state !== 'object' || state === null || !('reservation' in state)) return null;
  const r = (state as { reservation: unknown }).reservation;
  return typeof r === 'object' && r !== null && typeof (r as Reservation).code === 'string' ? (r as Reservation) : null;
}

/**
 * 예매 완료(03 문서 4.10). 예매 결과는 라우터 history state로만 넘겨받는다(URL·저장소에 남기지 않음).
 * 새로 고치거나 주소로 바로 들어오면 내용이 없으므로 내 예매로 보낸다.
 */
export function CompletePage() {
  const location = useLocation();
  const r = readReservation(location.state);
  usePageTitle('예매 완료');
  useBookingChrome('complete', '예매 완료', null);
  if (!r) return <Navigate to="/my/reservations" replace />;
  return <Done r={r} />;
}

function Done({ r }: { r: Reservation }) {
  const [show] = useResource<ShowDetail>(`show:${r.show.id}`, (signal) => api.getShow(r.show.id, signal));
  const s = show.kind === 'ready' ? show.data : null;
  const [copied, setCopied] = useState<'idle' | 'done' | 'fail'>('idle');

  return (
    <div className="page page--complete">
      <div className="wrap done">
        <span className="done__check" aria-hidden="true"><Icon name="check" size={32} /></span>
        <h1 className="done__title" tabIndex={-1}>예매가 완료되었어요</h1>
        <p className="done__sub">예매 내역은 내 예매에서 언제든 볼 수 있어요</p>

        <article className="tcard" aria-label="예매 내역">
          <div className="tcard__code">
            <span className="tcard__code-label" id={`code-${r.code}`}>예매번호</span>
            <span className="tcard__code-value" aria-labelledby={`code-${r.code}`}>
              <span aria-hidden="true">{groupCode(r.code)}</span>
              <span className="sr-only">{r.code.split('').join(' ')}</span>
            </span>
            {navigator.clipboard && (
              <button
                type="button"
                className="text-btn text-btn--brand"
                onClick={() => void copyText(r.code).then((ok) => setCopied(ok ? 'done' : 'fail'))}
              >
                <Icon name="copy" size={16} />
                {copied === 'done' ? '복사했어요' : '복사'}
              </button>
            )}
            <span className="sr-only" role="status">
              {copied === 'done' ? '예매번호를 복사했어요.' : copied === 'fail' ? '복사하지 못했어요. 번호를 직접 적어 두세요.' : ''}
            </span>
          </div>
          <div className="tcard__body">
            <div className="tcard__show">
              <span className="thumb thumb--72" aria-hidden="true">
                {s && <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} />}
              </span>
              <div>
                <p className="tcard__title">{r.show.title}</p>
                <p className="tcard__meta">{fullDateTime(r.performance.startsAt)}</p>
                <p className="tcard__meta">{r.show.venue}</p>
              </div>
            </div>
            <dl className="tcard__rows">
              <div>
                <dt>좌석</dt>
                <dd>{r.seats.map((x) => `${seatLabel(x)} ${gradeName(x.grade, s?.grades)}`).join(', ')}</dd>
              </div>
              <div>
                <dt>결제</dt>
                <dd>{won(r.totalPrice)} · {PAYMENT_LABEL[r.paymentMethod]}(모의)</dd>
              </div>
              <div>
                <dt>예매자</dt>
                <dd>{r.name} · {r.emailMasked}</dd>
              </div>
            </dl>
          </div>
        </article>

        <div className="done__actions">
          <Link className="btn btn--primary btn--m" to="/my/reservations">내 예매 보기</Link>
          <Link className="btn btn--line btn--m" to="/">다른 공연 보기</Link>
        </div>
      </div>
    </div>
  );
}
