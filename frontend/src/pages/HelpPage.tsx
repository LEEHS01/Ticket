import { useId, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { ACCOUNT_GUIDE, BOOKING_STEPS, CANCEL_GUIDE, FAQ, QUEUE_GUIDE } from '../content';
import { usePageTitle } from '../shell';
import { Icon } from '../components/Icon';

const TABS = [
  { key: 'booking', label: '예매 방법' },
  { key: 'cancel', label: '취소·환불' },
  { key: 'queue', label: '대기열·좌석' },
  { key: 'account', label: '계정' },
  { key: 'faq', label: '자주 묻는 질문' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** 이용안내·자주 묻는 질문(03 문서 4.14). /help/faq는 질문 탭으로 연다. 내용은 정적 데이터 */
export function HelpPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromParam = TABS.find((t) => t.key === params.get('tab'))?.key;
  const tab: TabKey = pathname === '/help/faq' ? 'faq' : (fromParam ?? 'booking');
  usePageTitle(tab === 'faq' ? '자주 묻는 질문' : '이용안내');

  const go = (k: TabKey) => navigate(k === 'faq' ? '/help/faq' : k === 'booking' ? '/help' : `/help?tab=${k}`, { replace: true });

  return (
    <div className="page page--help">
      <div className="wrap">
        <div className="pagehead">
          <h1 className="pagehead__title" tabIndex={-1}>이용안내</h1>
        </div>
        <div className="cs-box">
          <Icon name="help" size={22} />
          <p>운영 시간 평일 10:00–18:00 · 실습 서비스라 전화·채팅 상담은 하지 않아요</p>
        </div>
        <div className="tabs help__tabs" role="tablist" aria-label="이용안내">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`help-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls="help-panel"
              tabIndex={tab === t.key ? 0 : -1}
              className="tab"
              onClick={() => go(t.key)}
              onKeyDown={(e) => {
                const i = TABS.findIndex((x) => x.key === tab);
                const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const next = TABS[(i + d + TABS.length) % TABS.length]!;
                go(next.key);
                requestAnimationFrame(() => document.getElementById(`help-tab-${next.key}`)?.focus());
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="help__panel" role="tabpanel" id="help-panel" aria-labelledby={`help-tab-${tab}`}>
          {tab === 'booking' && (
            <ol className="hsteps">
              {BOOKING_STEPS.map((s, i) => (
                <li key={s.title} className="hsteps__item">
                  <span className="hsteps__no" aria-hidden="true">{i + 1}</span>
                  <div>
                    <h2 className="hsteps__title">{s.title}</h2>
                    <p className="hsteps__text">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {tab === 'cancel' && (
            <>
              <h2 className="sr-only">취소·환불</h2>
              <ul className="bullets help__bullets">{CANCEL_GUIDE.map((t) => <li key={t}>{t}</li>)}</ul>
              <table className="ctable">
                <caption className="sr-only">취소 수수료</caption>
                <thead><tr><th scope="col">취소 가능 시점</th><th scope="col">수수료</th></tr></thead>
                <tbody>
                  <tr><td>예매 후 ~ 회차 시작 전</td><td>없음</td></tr>
                  <tr><td>회차 시작 이후</td><td>취소할 수 없음</td></tr>
                </tbody>
              </table>
              <p className="help__more"><Link to="/my/reservations" className="text-btn text-btn--brand">내 예매로 가기 <Icon name="right" size={14} /></Link></p>
            </>
          )}
          {tab === 'queue' && (
            <>
              <h2 className="sr-only">대기열·좌석</h2>
              <ul className="bullets help__bullets">{QUEUE_GUIDE.map((t) => <li key={t}>{t}</li>)}</ul>
            </>
          )}
          {tab === 'account' && (
            <>
              <h2 className="sr-only">계정</h2>
              <ul className="bullets help__bullets">{ACCOUNT_GUIDE.map((t) => <li key={t}>{t}</li>)}</ul>
            </>
          )}
          {tab === 'faq' && <Faq />}
        </div>
      </div>
    </div>
  );
}

function Faq() {
  const id = useId();
  const [q, setQ] = useState('');
  const term = q.trim();
  const items = term ? FAQ.filter((f) => f.q.includes(term) || f.a.includes(term)) : FAQ;
  return (
    <>
      <h2 className="sr-only">자주 묻는 질문</h2>
      <div className="faq__search">
        <label htmlFor={`${id}-q`} className="sr-only">질문 찾기</label>
        <Icon name="search" size={20} className="faq__icon" />
        <input
          id={`${id}-q`}
          className="input faq__input"
          type="search"
          placeholder="궁금한 내용을 찾아보세요"
          value={q}
          maxLength={40}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <p className="sr-only" aria-live="polite">{term ? `${items.length}개 찾음` : ''}</p>
      {items.length === 0 ? (
        <p className="sec-empty">‘{term}’에 맞는 질문이 없어요. 다른 낱말로 찾아보세요.</p>
      ) : (
        <ul className="faq">
          {items.map((f) => (
            <li key={f.q}>
              <details className="faq__item">
                <summary className="faq__q">
                  <span className="faq__mark" aria-hidden="true">Q</span>
                  <span className="faq__qtext">{f.q}</span>
                  <Icon name="down" size={20} className="faq__chev" />
                </summary>
                <p className="faq__a">{f.a}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
