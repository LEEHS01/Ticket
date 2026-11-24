import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router';
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

/** 페이지가 바뀌면 맨 위로, 그리고 본문 제목으로 포커스를 옮겨 화면 낭독기에 전환을 알린다. */
function useRouteFocus() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    // 화면이 데이터를 받은 뒤 h1을 그리는 경우가 있어 다음 프레임에도 한 번 더 찾는다
    const focus = () => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
    focus();
    const t = window.setTimeout(focus, 300);
    return () => window.clearTimeout(t);
  }, [pathname]);
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
