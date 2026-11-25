import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType, useSearchParams } from 'react-router';
import { RequireAuth } from './auth';
import { genreFromSlug, GENRE_SLUG } from './format';
import {
  AuthHeader,
  BookingChromeProvider,
  BookingHeader,
  layoutOf,
  PageMetaProvider,
  SiteFooter,
  SiteHeader,
  SlimFooter,
  TabBar,
} from './shell';
import { ToastProvider } from './components/overlay';
import { HomePage } from './pages/HomePage';
import { GenrePage } from './pages/GenrePage';
import { RankingPage } from './pages/RankingPage';
import { OpenPage } from './pages/OpenPage';
import { SearchPage } from './pages/SearchPage';
import { ShowPage } from './pages/ShowPage';
import { QueuePage } from './pages/QueuePage';
import { SeatsPage } from './pages/SeatsPage';
import { ConfirmPage } from './pages/ConfirmPage';
import { CompletePage } from './pages/CompletePage';
import { LoginPage, SignupPage } from './pages/AuthPages';
import { AccountPage, MyReservationsPage } from './pages/MyPages';
import { NoticeDetailPage, NoticesPage } from './pages/NoticePages';
import { HelpPage } from './pages/HelpPage';
import { PolicyPage } from './pages/PolicyPage';
import { NotFoundPage } from './pages/NotFoundPage';

/** 방문 기록마다 마지막 스크롤 위치(뒤로·앞으로 가기에서 되살린다). 탭을 새로 고치면 비어 있다 */
const scrollByKey = new Map<string, number>();

/**
 * 페이지가 바뀌면 맨 위로, 그리고 본문 제목으로 포커스를 옮겨 화면 낭독기에 전환을 알린다.
 * 뒤로·앞으로 가기(POP)로 돌아온 화면은 맨 위 대신 떠날 때의 스크롤 위치로 돌려놓는다
 * (펼쳐 둔 "더 보기" 목록 중간으로 돌아오게).
 */
function useRouteFocus() {
  const { pathname, search, key, state } = useLocation();
  const navType = useNavigationType();
  const prev = useRef<{ pathname: string; search: string } | null>(null);

  // 브라우저의 자동 복원은 화면이 다 그려지기 전에 동작해 어긋나므로 직접 한다
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  }, []);

  // 지금 방문 기록의 스크롤 위치를 계속 적어 둔다
  useEffect(() => {
    // 같은 화면 안의 바꿔치기(더 보기·필터)는 새 key가 생기므로 지금 위치를 이어 적는다(스크롤 없이 바로 떠나도 되살리게)
    if (navType === 'REPLACE' && !scrollByKey.has(key)) scrollByKey.set(key, window.scrollY);
    let raf = 0;
    const save = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => scrollByKey.set(key, window.scrollY));
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', save);
    };
  }, [key, navType]);

  useEffect(() => {
    const last = prev.current;
    prev.current = { pathname, search };
    if (!last) return; // 처음 열 때는 브라우저 그대로
    // 다른 화면으로 가거나, 지금 화면을 다시 누를 때(홈에서 로고 등)만. 같은 화면 안에서 주소·상태만 바뀔 때
    // (필터·정렬·더 보기·검색 조건)는 스크롤과 포커스를 건드리지 않는다
    // 지금 주소로 가는 링크는 라우터가 바꿔치기(REPLACE)로 처리한다. 화면 상태(state) 없이 같은 주소면 다시 누른 것
    const samePage = last.pathname === pathname;
    const reclick = samePage && last.search === search && navType !== 'POP' && !state;
    if (samePage && !reclick) return;
    const target = navType === 'POP' ? (scrollByKey.get(key) ?? 0) : 0;
    window.scrollTo(0, target);
    // 목록이 늦게 그려지면 문서가 짧아 끝까지 못 내려가므로 잠깐(최대 2초) 다시 시도. 사용자가 스크롤을 건드리면 멈춘다
    let tries = 0;
    let timer = 0;
    const stop = () => window.clearTimeout(timer);
    const retry = () => {
      if (Math.abs(window.scrollY - target) < 2 || ++tries > 20) return;
      window.scrollTo(0, target);
      timer = window.setTimeout(retry, 100);
    };
    if (target > 0) timer = window.setTimeout(retry, 100);
    const cancelOn = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    cancelOn.forEach((t) => window.addEventListener(t, stop, { passive: true, once: true }));
    // 화면이 데이터를 받은 뒤 h1을 그리는 경우가 있어 다음 프레임에도 한 번 더 찾는다
    const focus = () => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
    focus();
    const t = window.setTimeout(focus, 300);
    return () => {
      window.clearTimeout(t);
      stop();
      cancelOn.forEach((ev) => window.removeEventListener(ev, stop));
    };
    // navType·pathname·search는 key가 바뀔 때 함께 바뀐다
  }, [key]);
}

/** 옛 주소 넘김: /?genre=MUSICAL → /genre/musical, /?q=달빛 → /search?q=달빛 */
function HomeOrRedirect() {
  const [params] = useSearchParams();
  const q = params.get('q');
  if (q) return <Navigate to={`/search?q=${encodeURIComponent(q.slice(0, 40))}`} replace />;
  const g = genreFromSlug(params.get('genre'));
  if (g) return <Navigate to={`/genre/${GENRE_SLUG[g]}`} replace />;
  return <HomePage />;
}

function Shell() {
  useRouteFocus();
  const { pathname } = useLocation();
  const layout = layoutOf(pathname);
  const full = layout !== 'booking' && layout !== 'auth';
  // 하단 탭 막대: 상세(고정 예매 막대로 바뀜)·예매 단계·로그인/가입에서 숨긴다
  const tabbar = full && layout !== 'detail';

  return (
    <div className={`app app--${layout}${tabbar ? ' has-tabbar' : ''}`}>
      <a className="skip-link" href="#main">본문으로 건너뛰기</a>
      {layout === 'booking' ? <BookingHeader /> : layout === 'auth' ? <AuthHeader /> : <SiteHeader layout={layout} />}

      <main id="main" className="main">
        <Routes>
          <Route path="/" element={<HomeOrRedirect />} />
          <Route path="/genre/:genre" element={<GenrePage />} />
          <Route path="/ranking" element={<RankingPage />} />
          <Route path="/open" element={<OpenPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/shows/:id" element={<ShowPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/book/:performanceId/queue" element={<RequireAuth><QueuePage /></RequireAuth>} />
          <Route path="/book/:performanceId/seats" element={<RequireAuth><SeatsPage /></RequireAuth>} />
          <Route path="/book/:performanceId/confirm" element={<RequireAuth><ConfirmPage /></RequireAuth>} />
          <Route path="/complete" element={<CompletePage />} />
          <Route path="/my" element={<RequireAuth><AccountPage /></RequireAuth>} />
          <Route path="/my/reservations" element={<RequireAuth><MyReservationsPage /></RequireAuth>} />
          <Route path="/notices" element={<NoticesPage />} />
          <Route path="/notices/:id" element={<NoticeDetailPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/faq" element={<HelpPage />} />
          <Route path="/policy/terms" element={<PolicyPage kind="terms" />} />
          <Route path="/policy/privacy" element={<PolicyPage kind="privacy" />} />
          {/* 옛 주소 */}
          <Route path="/me/reservations" element={<Navigate to="/my/reservations" replace />} />
          <Route path="/lookup" element={<Navigate to="/my/reservations" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      {full ? <SiteFooter /> : <SlimFooter />}
      {tabbar && <TabBar />}
    </div>
  );
}

export function App() {
  return (
    <PageMetaProvider>
      <BookingChromeProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </BookingChromeProvider>
    </PageMetaProvider>
  );
}
