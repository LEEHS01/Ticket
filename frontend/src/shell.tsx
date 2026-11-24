import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { api } from './api';
import { loginHref, useAuth } from './auth';
import { anyBooking, clearBooking } from './booking';
import { clock, GENRE_LABEL, GENRE_SLUG, GENRES, spokenDuration } from './format';
import { Icon, type IconName } from './components/Icon';
import { Logo } from './components/Logo';
import { SearchBox } from './components/SearchBox';
import { Dialog, useToast } from './components/overlay';
import { copyText, useSecondsUntil } from './components/bits';

// ─────────────────────────────────────────────
// 화면 제목: 문서 제목(탭 이름)과 모바일 하위 화면 머리글 가운데 제목
// ─────────────────────────────────────────────
type PageMeta = { title: string };
const PageMetaContext = createContext<{ meta: PageMeta; set: (m: PageMeta) => void }>({ meta: { title: '' }, set: () => undefined });

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [meta, set] = useState<PageMeta>({ title: '' });
  useEffect(() => {
    document.title = meta.title ? `${meta.title} | 미리내 마당` : '미리내 마당';
  }, [meta.title]);
  const value = useMemo(() => ({ meta, set }), [meta]);
  return <PageMetaContext.Provider value={value}>{children}</PageMetaContext.Provider>;
}

export function usePageTitle(title: string) {
  const { set } = useContext(PageMetaContext);
  useEffect(() => {
    set({ title });
  }, [title, set]);
}

const usePageMeta = () => useContext(PageMetaContext).meta;

// ─────────────────────────────────────────────
// 예매 단계 머리글에 넘길 정보(대기·좌석·확인·완료 화면이 정한다)
// ─────────────────────────────────────────────
export type BookingStep = 'queue' | 'seats' | 'confirm' | 'complete';
type Chrome = { step: BookingStep; title: string; deadline: string | null; deadlineLabel?: string };
const ChromeContext = createContext<{ chrome: Chrome | null; set: (c: Chrome | null) => void }>({ chrome: null, set: () => undefined });

export function BookingChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, set] = useState<Chrome | null>(null);
  const value = useMemo(() => ({ chrome, set }), [chrome]);
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useBookingChrome(step: BookingStep, title: string, deadline: string | null, deadlineLabel?: string) {
  const { set } = useContext(ChromeContext);
  useEffect(() => {
    set({ step, title, deadline, deadlineLabel });
  }, [set, step, title, deadline, deadlineLabel]);
  useEffect(() => () => set(null), [set]);
}

// ─────────────────────────────────────────────
// 화면 종류: 주소로 정한다
// ─────────────────────────────────────────────
export type Layout = 'home' | 'root' | 'detail' | 'sub' | 'booking' | 'auth';

export function layoutOf(pathname: string): Layout {
  if (/^\/book\/\d+\//.test(pathname) || pathname === '/complete') return 'booking';
  if (pathname === '/login' || pathname === '/signup') return 'auth';
  if (pathname === '/' || pathname.startsWith('/genre/')) return 'home';
  if (/^\/shows\/\d+/.test(pathname)) return 'detail';
  if (pathname === '/ranking' || pathname === '/open' || pathname.startsWith('/my')) return 'root';
  return 'sub';
}

// ─────────────────────────────────────────────
// PC 머리글: 보조 링크 32 + 로고·검색 72 (+ 아래 장르 메뉴 52, 붙음)
// ─────────────────────────────────────────────
function UtilLinks() {
  const { status, user, logout } = useAuth();
  const location = useLocation();
  const here = location.pathname + location.search;
  return (
    <ul className="util" aria-label="계정과 고객센터">
      {status === 'loading' ? null : user ? (
        <>
          <li><span className="util__name">{user.name}님</span></li>
          <li><button type="button" className="util__link" onClick={() => void logout()}>로그아웃</button></li>
        </>
      ) : (
        <>
          <li><Link className="util__link" to={loginHref(here)}>로그인</Link></li>
          <li><Link className="util__link" to="/signup">회원가입</Link></li>
        </>
      )}
      <li><Link className="util__link" to="/my/reservations">내 예매</Link></li>
      <li><Link className="util__link" to="/help">고객센터</Link></li>
    </ul>
  );
}

function HeaderIcons() {
  const { user } = useAuth();
  const location = useLocation();
  return (
    <div className="gh__icons">
      <Link to="/my/reservations" className="gh__icon">
        <Icon name="ticket" size={24} />
        <span>내 예매</span>
      </Link>
      {user ? (
        <Link to="/my" className="gh__icon">
          <Icon name="user" size={24} />
          <span>마이</span>
        </Link>
      ) : (
        <Link to={loginHref(location.pathname + location.search)} className="gh__icon">
          <Icon name="user" size={24} />
          <span>로그인</span>
        </Link>
      )}
    </div>
  );
}

/** 장르 메뉴 줄(PC, 붙음). 붙은 상태에서는 왼쪽에 작은 로고 */
function GenreNav({ stuck }: { stuck: boolean }) {
  return (
    <nav className={`gnav${stuck ? ' is-stuck' : ''}`} aria-label="주 메뉴">
      <div className="wrap gnav__inner">
        <Link to="/" className="gnav__logo" aria-label="미리내 마당 홈" tabIndex={stuck ? 0 : -1}>
          <Logo size="sm" />
        </Link>
        <ul className="gnav__list">
          <li><NavLink to="/" end className="gnav__link">홈</NavLink></li>
          {GENRES.map((g) => (
            <li key={g}>
              <NavLink to={`/genre/${GENRE_SLUG[g]}`} className="gnav__link">{GENRE_LABEL[g]}</NavLink>
            </li>
          ))}
          <li className="gnav__sep" aria-hidden="true" />
          <li><NavLink to="/ranking" className="gnav__link">랭킹</NavLink></li>
          <li><NavLink to="/open" className="gnav__link">티켓 오픈</NavLink></li>
          <li><NavLink to="/notices" className="gnav__link">공지사항</NavLink></li>
        </ul>
      </div>
    </nav>
  );
}

/** 모바일 칩 줄(메인·장르 화면): 전체 콘서트 뮤지컬 연극 클래식 */
function ChipRow() {
  const { pathname } = useLocation();
  return (
    <nav className="mchips" aria-label="장르">
      <ul className="mchips__list">
        <li><Link to="/" className="chip" aria-current={pathname === '/' ? 'page' : undefined}>전체</Link></li>
        {GENRES.map((g) => {
          const to = `/genre/${GENRE_SLUG[g]}`;
          return (
            <li key={g}>
              <Link to={to} className="chip" aria-current={pathname === to ? 'page' : undefined}>{GENRE_LABEL[g]}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 모바일 하위 화면 머리글: ← / 가운데 제목(스크롤 120px 지나면) / 링크 복사 */
function SubHeader({ copyable, alwaysTitle }: { copyable: boolean; alwaysTitle: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { title } = usePageMeta();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 120);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const canBack = (window.history.state as { idx?: number } | null)?.idx;
  return (
    <div className="mh mh--sub">
      <button type="button" className="icon-btn" onClick={() => (canBack ? navigate(-1) : navigate('/'))} aria-label="뒤로">
        <Icon name="back" size={24} />
      </button>
      <p className={`mh__title${alwaysTitle || scrolled ? ' is-shown' : ''}`} aria-hidden={!(alwaysTitle || scrolled)}>{title}</p>
      {copyable ? (
        <button
          type="button"
          className="icon-btn"
          aria-label="링크 복사"
          onClick={() => {
            void copyText(window.location.href).then((ok) => toast(ok ? '링크를 복사했어요' : '복사하지 못했어요. 주소창에서 복사해 주세요'));
          }}
        >
          <Icon name="link" size={22} />
        </button>
      ) : (
        <Link to="/search" className="icon-btn" aria-label="검색">
          <Icon name="search" size={22} />
        </Link>
      )}
    </div>
  );
}

export function SiteHeader({ layout }: { layout: Layout }) {
  const { pathname } = useLocation();
  const headRef = useRef<HTMLElement>(null);
  const [stuck, setStuck] = useState(false);
  // 장르 메뉴 줄이 위에 붙었는지: 위 두 줄(보조 링크 32 + 로고·검색 72)을 다 지나 스크롤했을 때만.
  // IntersectionObserver는 창이 가려져 그려지지 않을 때 '안 보임'으로 알려 와 처음부터 작은 로고가 보일 수 있어
  // 스크롤 위치와 머리글 높이로 직접 판단한다(머리글이 숨는 모바일 폭에서는 늘 false).
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const update = () => {
      const h = el.offsetHeight;
      setStuck(h > 0 && window.scrollY >= h);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const sub = layout === 'detail' || layout === 'sub';
  return (
    <>
      {/* PC(768 이상) */}
      <header className="gh" ref={headRef}>
        <div className="gh__util">
          <div className="wrap gh__util-inner"><UtilLinks /></div>
        </div>
        <div className="wrap gh__main">
          <Link to="/" className="gh__logo" aria-label="미리내 마당 홈">
            <Logo size="lg" />
          </Link>
          <SearchBox />
          <HeaderIcons />
        </div>
      </header>
      <GenreNav stuck={stuck} />

      {/* 모바일(767 이하) */}
      <div className={`mtop${layout === 'home' ? ' mtop--chips' : ''}`}>
        {sub ? (
          <SubHeader copyable={layout === 'detail' || pathname.startsWith('/notices/')} alwaysTitle={layout === 'sub'} />
        ) : (
          <div className="mh">
            <Link to="/" className="mh__logo" aria-label="미리내 마당 홈">
              <Logo size="md" />
            </Link>
            <Link to="/search" className="icon-btn" aria-label="검색">
              <Icon name="search" size={24} />
            </Link>
          </div>
        )}
        {layout === 'home' && <ChipRow />}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// 모바일 하단 탭 막대: 홈 · 랭킹 · 티켓 오픈 · 내 예매 · 마이(로그인 전엔 로그인)
// ─────────────────────────────────────────────
export function TabBar() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const tabs: { to: string; label: string; icon: IconName; active: boolean }[] = [
    { to: '/', label: '홈', icon: 'home', active: pathname === '/' || pathname.startsWith('/genre/') },
    { to: '/ranking', label: '랭킹', icon: 'rank', active: pathname === '/ranking' },
    { to: '/open', label: '티켓 오픈', icon: 'clock', active: pathname === '/open' },
    { to: '/my/reservations', label: '내 예매', icon: 'ticket', active: pathname === '/my/reservations' },
    user
      ? { to: '/my', label: '마이', icon: 'user', active: pathname === '/my' }
      : { to: loginHref(pathname + search), label: '로그인', icon: 'user', active: false },
  ];
  return (
    <nav className="tabbar" aria-label="하단 메뉴">
      <ul className="tabbar__list">
        {tabs.map((t) => (
          <li key={t.label}>
            <Link to={t.to} className={`tabbar__item${t.active ? ' is-active' : ''}`} aria-current={t.active ? 'page' : undefined}>
              <Icon name={t.icon} size={24} />
              <span>{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ─────────────────────────────────────────────
// 푸터
// ─────────────────────────────────────────────
const VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

export function SiteFooter() {
  return (
    <footer className="gf">
      <div className="gf__links">
        <ul className="wrap gf__links-inner">
          <li><Link to="/policy/terms">이용약관</Link></li>
          <li><Link to="/policy/privacy" className="gf__strong">개인정보처리방침</Link></li>
          <li><Link to="/help">이용안내</Link></li>
          <li><Link to="/notices">공지사항</Link></li>
          <li><Link to="/help/faq">자주 묻는 질문</Link></li>
        </ul>
      </div>
      <div className="wrap gf__body">
        <div className="gf__about">
          <p className="gf__brand"><Logo size="xs" /><span className="sr-only">미리내 마당</span></p>
          <p className="gf__text">
            클라우드 실습용으로 만든 가상 예매 서비스입니다.
            <br />
            공연·출연진·공연장·포스터는 모두 지어낸 것이며 실제 결제는 일어나지 않습니다.
          </p>
        </div>
        <div className="gf__cs">
          <p className="gf__cs-title">고객센터</p>
          <p className="gf__text">평일 10:00–18:00</p>
          <p className="gf__text">실습 서비스라 전화 상담은 하지 않습니다.</p>
        </div>
      </div>
      <p className="wrap gf__copy">© 2026 미리내 마당 · 버전 {VERSION}</p>
    </footer>
  );
}

/** 예매 단계·로그인 화면의 한 줄 푸터 */
export function SlimFooter() {
  return (
    <footer className="gf gf--slim">
      <div className="wrap gf__slim">
        <Link to="/policy/terms">이용약관</Link>
        <Link to="/policy/privacy" className="gf__strong">개인정보처리방침</Link>
        <span className="gf__copy-inline">© 2026 미리내 마당</span>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────
// 로그인·가입 화면의 축소 머리글(가운데 글자 로고만)
// ─────────────────────────────────────────────
export function AuthHeader() {
  return (
    <header className="ah">
      <Link to="/" className="ah__logo" aria-label="미리내 마당 홈">
        <Logo size="lg" />
      </Link>
    </header>
  );
}

// ─────────────────────────────────────────────
// 예매 단계 머리글: ① 좌석 선택 ── ② 예매 확인·결제 ── ③ 예매 완료
// ─────────────────────────────────────────────
const STEPS: { key: BookingStep; label: string }[] = [
  { key: 'seats', label: '좌석 선택' },
  { key: 'confirm', label: '예매 확인·결제' },
  { key: 'complete', label: '예매 완료' },
];
const STEP_INDEX: Record<BookingStep, number> = { queue: -1, seats: 0, confirm: 1, complete: 2 };

function Steps({ step }: { step: BookingStep }) {
  const cur = STEP_INDEX[step];
  return (
    <ol className="steps" aria-label={cur < 0 ? '예매 단계: 입장 대기 중' : `예매 단계 3단계 중 ${cur + 1}단계, ${STEPS[cur]!.label}`}>
      {step === 'queue' && (
        <li className="steps__item is-current steps__item--wait">
          <span className="steps__label">입장 대기</span>
        </li>
      )}
      {STEPS.map((s, i) => {
        const state = i < cur ? 'is-done' : i === cur ? 'is-current' : 'is-next';
        return (
          <li key={s.key} className={`steps__item ${state}`} aria-current={i === cur ? 'step' : undefined}>
            <span className="steps__no" aria-hidden="true">
              {i < cur ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span className="steps__label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DeadlineClock({ deadline, label }: { deadline: string; label: string }) {
  const left = useSecondsUntil(deadline) ?? 0;
  return (
    <span className={`bh__timer${left < 60 ? ' is-urgent' : ''}`} role="timer" aria-label={`${label} ${spokenDuration(left)}`}>
      <span aria-hidden="true">{clock(left)}</span>
      <Icon name="clock" size={18} />
    </span>
  );
}

export function BookingHeader() {
  const { chrome } = useContext(ChromeContext);
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const step = chrome?.step ?? 'queue';
  const done = step === 'complete';

  async function quit() {
    setLeaving(true);
    const b = anyBooking();
    if (b) await api.leaveQueue(b.queueToken).catch(() => undefined); // 대기·입장 포기 + 선점 해제
    clearBooking();
    setAsking(false);
    setLeaving(false);
    navigate(b?.showId ? `/shows/${b.showId}` : '/', { replace: true });
  }

  const progress = { queue: 'p0', seats: 'p1', confirm: 'p2', complete: 'p3' }[step];

  return (
    <header className="bh">
      <div className="wrap bh__pc">
        <Link to="/" className="bh__logo" aria-label="미리내 마당 홈" onClick={(e) => {
          if (!done) {
            e.preventDefault();
            setAsking(true);
          }
        }}>
          <Logo size="lg" />
        </Link>
        <Steps step={step} />
        {!done ? (
          <button type="button" className="btn btn--line btn--m bh__quit" onClick={() => setAsking(true)}>예매 그만두기</button>
        ) : (
          <span className="bh__quit" />
        )}
      </div>
      <div className="bh__m">
        {!done ? (
          <button type="button" className="icon-btn" onClick={() => setAsking(true)} aria-label="예매 그만두기">
            <Icon name="close" size={24} />
          </button>
        ) : (
          <Link to="/" className="icon-btn" aria-label="홈으로">
            <Icon name="home" size={22} />
          </Link>
        )}
        <p className="bh__title">{chrome?.title ?? ''}</p>
        {chrome?.deadline ? <DeadlineClock deadline={chrome.deadline} label={chrome.deadlineLabel ?? '남은 시간'} /> : <span className="bh__timer" />}
        <span className={`bh__progress ${progress}`} aria-hidden="true" />
      </div>
      <Dialog
        open={asking}
        onClose={() => !leaving && setAsking(false)}
        title="예매를 그만둘까요?"
        backdropClose={false}
        actions={
          <>
            <button type="button" className="btn btn--line btn--m" onClick={() => setAsking(false)} disabled={leaving}>계속 예매하기</button>
            <button type="button" className="btn btn--primary btn--m" onClick={() => void quit()} disabled={leaving}>
              {leaving ? '그만두는 중…' : '그만두기'}
            </button>
          </>
        }
      >
        <p>대기 순서와 고른 좌석이 모두 풀려요. 다시 예매하려면 처음부터 줄을 서야 해요.</p>
      </Dialog>
    </header>
  );
}
