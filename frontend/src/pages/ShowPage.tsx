import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, type PerformanceSummary, type ShowDetail } from '../api';
import { loginHref, useAuth } from '../auth';
import { useIsMobile, useLayout, useResource } from '../data';
import { dayKey, GENRE_LABEL, GENRE_SLUG, hm, koreanDay, longCountdown, openLabel, periodLabel, won } from '../format';
import { usePageTitle } from '../shell';
import { Badge, copyText, EmptyState, LoadError, Notice, readNotice, statusBadges, useSecondsUntil } from '../components/bits';
import { Calendar } from '../components/Calendar';
import { Icon } from '../components/Icon';
import { PosterArt } from '../components/PosterArt';
import { SeatPreview } from '../components/SeatMap';
import { Sheet, useToast } from '../components/overlay';

const TABS = [
  { id: 'about', label: '공연 소개' },
  { id: 'cast', label: '출연진' },
  { id: 'venue', label: '공연장' },
  { id: 'guide', label: '예매·취소 안내' },
] as const;

/** 공연 상세(03 문서 4.6). PC: 왼쪽 본문 792 + 오른쪽 고정 예매 상자 360. 모바일: 대표 영역 + 하단 고정 예매 막대 + 하단 판 */
export function ShowPage() {
  const { id } = useParams();
  const showId = Number(id);
  const valid = Number.isInteger(showId) && showId > 0;
  const [load, retry] = useResource<ShowDetail>(valid ? `show:${showId}` : null, (signal) => api.getShow(showId, signal));
  const location = useLocation();
  const notice = readNotice(location.state);
  usePageTitle(load.kind === 'ready' ? load.data.title : '공연 정보');

  if (!valid || (load.kind === 'error' && load.error.code === 'SHOW_NOT_FOUND')) {
    return (
      <div className="page">
        <EmptyState
          title="찾는 공연이 없어요"
          headingLevel="h1"
          illust="illust-404"
          icon="stage"
          actions={<Link className="btn btn--primary btn--m" to="/">공연 둘러보기</Link>}
        >
          <p>주소가 잘못됐거나 내려간 공연이에요.</p>
        </EmptyState>
      </div>
    );
  }

  if (load.kind === 'loading') return <DetailSkeleton />;

  if (load.kind === 'error') {
    return (
      <div className="page">
        <div className="wrap">
          <h1 className="sr-only" tabIndex={-1}>공연 정보</h1>
          <LoadError error={load.error} onRetry={retry} title="공연 정보를 불러오지 못했어요" />
        </div>
      </div>
    );
  }

  return <Detail show={load.data} notice={notice} onReload={retry} />;
}

function DetailSkeleton() {
  return (
    <div className="page page--detail" aria-busy="true">
      <span className="sr-only" role="status">공연 정보를 불러오는 중</span>
      <div className="wrap detail" aria-hidden="true">
        <div className="detail__main">
          <div className="dtop">
            <span className="skel skel--poster dtop__poster" />
            <div className="dtop__info">
              <span className="skel skel--line14" />
              <span className="skel dskel__title" />
              <span className="skel skel--line12" />
              <span className="skel skel--line12" />
              <span className="skel skel--line12" />
            </div>
          </div>
        </div>
        <span className="skel skel--block detail__aside dskel__box" />
      </div>
    </div>
  );
}

/** 회차 고르기 상태(PC 예매 상자와 모바일 하단 판이 함께 쓴다) */
function useBooker(s: ShowDetail) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  // 로그인하고 돌아왔을 때(?perf=회차) 고르던 회차를 다시 선택해 둔다
  const wanted = s.performances.find((p) => p.id === Number(params.get('perf')));
  const first =
    wanted ??
    s.performances.find((p) => p.status === 'ON_SALE') ??
    s.performances.find((p) => p.status === 'UPCOMING') ??
    s.performances.find((p) => p.status !== 'CLOSED') ??
    s.performances[0];
  const [day, setDay] = useState<string | null>(first ? dayKey(first.startsAt) : null);
  const [perfId, setPerfId] = useState<number | null>(first?.id ?? null);

  const pickDay = useCallback(
    (d: string) => {
      setDay(d);
      const ps = s.performances.filter((p) => dayKey(p.startsAt) === d);
      setPerfId((ps.find((p) => p.status === 'ON_SALE') ?? ps[0])?.id ?? null);
    },
    [s.performances],
  );
  const dayPerfs = useMemo(() => s.performances.filter((p) => day && dayKey(p.startsAt) === day), [s.performances, day]);
  const perf = s.performances.find((p) => p.id === perfId) ?? null;

  const book = useCallback(
    (p: PerformanceSummary) => {
      if (user) {
        navigate(`/book/${p.id}/queue`, { state: { showId: s.id } });
        return;
      }
      // 비로그인: 로그인 후 이 공연·이 회차로 돌아오게
      navigate(loginHref(`/shows/${s.id}?perf=${p.id}`), {
        state: { notice: { tone: 'info', title: '예매하려면 로그인해 주세요', message: '로그인하면 고르던 회차로 돌아와요.' }, booking: true },
      });
    },
    [navigate, s.id, user],
  );

  return { day, pickDay, dayPerfs, perfId, setPerfId, perf, book, loggedIn: !!user };
}
type Booker = ReturnType<typeof useBooker>;

function castInitial(name: string) {
  const parts = name.trim().split(/\s+/);
  const roles = ['피아니스트', '첼리스트', '바이올리니스트', '지휘', '소프라노', '테너'];
  const base = parts.length > 1 && roles.includes(parts[0]!) ? parts[1]! : parts[0] ?? name;
  return base.charAt(0);
}

function Detail({ show: s, notice, onReload }: { show: ShowDetail; notice: ReturnType<typeof readNotice>; onReload: () => void }) {
  const booker = useBooker(s);
  const toast = useToast();
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  const badges = statusBadges(s);

  const copyLink = () =>
    void copyText(window.location.origin + `/shows/${s.id}`).then((ok) => toast(ok ? '링크를 복사했어요' : '복사하지 못했어요. 주소창에서 복사해 주세요'));

  const info: [string, ReactNode][] = [
    ['장소', <a href="#venue" className="dinfo__venue">{s.venue}<Icon name="right" size={14} /></a>],
    ['기간', periodLabel(s.firstStartsAt, s.lastStartsAt)],
    ['관람 시간', `${s.runningMinutes}분`],
    ['관람 등급', s.ageRating],
    ['출연', s.cast.join(', ')],
  ];

  return (
    <div className="page page--detail">
      {/* 모바일 대표 영역: 포스터를 흐리게 확대한 바탕 + 가운데 포스터 */}
      <div className="dhero" aria-hidden="true">
        <span className="dhero__bg">
          <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} eager={mobile} />
        </span>
        <span className="dhero__poster">
          <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} size="lg" eager={mobile} priority={mobile} />
        </span>
      </div>

      <div className="wrap">
        <nav className="crumbs" aria-label="현재 위치">
          <Link to="/">홈</Link>
          <Icon name="right" size={12} />
          <Link to={`/genre/${GENRE_SLUG[s.genre]}`}>{GENRE_LABEL[s.genre]}</Link>
        </nav>
        {notice && (
          <div className="detail__notice">
            <Notice tone={notice.tone} title={notice.title}>{notice.message && <p>{notice.message}</p>}</Notice>
          </div>
        )}
      </div>

      <div className="wrap detail">
        <div className="detail__main">
          <div className="dtop">
            <div className="dtop__poster">
              <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} size="lg" alt={`${s.title} 포스터`} eager={!mobile} priority={!mobile} />
            </div>
            <div className="dtop__info">
              <div className="badges dtop__badges">
                <Badge kind="genre">{GENRE_LABEL[s.genre]}</Badge>
                {s.rank !== null && <Badge kind="rank">{s.rank}위</Badge>}
                {badges.map((b) => <Badge key={b.label} kind={b.kind}>{b.label}</Badge>)}
              </div>
              <h1 className="dtop__title" tabIndex={-1}>{s.title}</h1>
              {s.tagline && <p className="dtop__tagline">{s.tagline}</p>}
              <dl className="dinfo">
                {info.map(([k, v]) => (
                  <div key={k} className="dinfo__row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <ul className="pricebox" aria-label="가격">
                {s.grades.map((g, i) => (
                  <li key={g.code}>
                    <span className={`swatch g${i}`} aria-hidden="true" />
                    <span className="pricebox__name">{g.name}</span>
                    <span className="pricebox__won">{won(g.price)}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className="text-btn dtop__copy" onClick={copyLink}>
                <Icon name="link" size={16} /> 링크 복사
              </button>
            </div>
          </div>

          <DetailTabs />

          <section id="about" className="dsec" aria-labelledby="about-h">
            <h2 id="about-h" className="dsec__title">공연 소개</h2>
            <p className="dsec__prose">{s.description}</p>
          </section>

          <section id="cast" className="dsec" aria-labelledby="cast-h">
            <h2 id="cast-h" className="dsec__title">출연진</h2>
            <ul className="cast">
              {s.cast.map((c) => (
                <li key={c} className="cast__item">
                  <span className="cast__avatar" aria-hidden="true">{castInitial(c)}</span>
                  <span className="cast__name">{c}</span>
                </li>
              ))}
            </ul>
          </section>

          <section id="venue" className="dsec" aria-labelledby="venue-h">
            <h2 id="venue-h" className="dsec__title">공연장</h2>
            <p className="venue__line">
              <strong className="venue__name">{s.venueInfo.name}</strong>
              {s.venueInfo.region && <span> · {s.venueInfo.region}</span>}
              {s.venueInfo.seatCount > 0 && <span> · 총 {s.venueInfo.seatCount.toLocaleString('ko-KR')}석</span>}
            </p>
            <VenuePreview performanceId={s.performances[0]?.id ?? null} />
          </section>

          <section id="guide" className="dsec" aria-labelledby="guide-h">
            <h2 id="guide-h" className="dsec__title">예매·취소 안내</h2>
            <ul className="bullets">
              {s.notices.map((n) => <li key={n}>{n}</li>)}
            </ul>
            <table className="ctable">
              <caption className="sr-only">취소 안내</caption>
              <thead>
                <tr><th scope="col">취소 가능 시점</th><th scope="col">수수료</th></tr>
              </thead>
              <tbody>
                <tr><td>예매 후 ~ 회차 시작 전</td><td>없음</td></tr>
                <tr><td>회차 시작 이후</td><td>취소할 수 없음</td></tr>
              </tbody>
            </table>
            <p className="ctable__note">실습 서비스라 실제 결제·환불은 일어나지 않아요. 취소는 내 예매에서 할 수 있어요.</p>
          </section>
        </div>

        <aside className="detail__aside" aria-labelledby="booker-h">
          <div className="booker">
            <h2 id="booker-h" className="booker__title">관람일</h2>
            <BookerBody show={s} booker={booker} onReload={onReload} />
          </div>
        </aside>
      </div>

      {/* 모바일 하단 고정 예매 막대 → 하단 판(회차가 하나면 판 없이 바로) */}
      <div className="dbar">
        <MobileBookButton show={s} booker={booker} onOpen={() => setSheet(true)} />
      </div>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="관람일·회차 선택"
        footer={booker.perf && <BookButton show={s} perf={booker.perf} booker={booker} onReload={onReload} compact />}
      >
        <BookerBody show={s} booker={booker} onReload={onReload} inSheet />
      </Sheet>
    </div>
  );
}

/** 상세 본문 밑줄 탭: 같은 화면 안 섹션으로 이동하고, 스크롤 위치에 따라 선택 탭이 바뀐다 */
function DetailTabs() {
  const [active, setActive] = useState<string>('about');
  const clicking = useRef(0);
  useEffect(() => {
    const els = TABS.map((t) => document.getElementById(t.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        if (Date.now() < clicking.current) return;
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive(vis.target.id);
      },
      { rootMargin: '-130px 0px -55% 0px' },
    );
    els.forEach((e) => io.observe(e));
    const hash = window.location.hash.slice(1);
    if (TABS.some((t) => t.id === hash)) {
      setActive(hash);
      requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
    }
    return () => io.disconnect();
  }, []);
  return (
    <nav className="dtabs" aria-label="공연 정보">
      <div className="tabs dtabs__inner">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className={`tab${active === t.id ? ' is-active' : ''}`}
            aria-current={active === t.id ? 'location' : undefined}
            onClick={(e) => {
              e.preventDefault();
              clicking.current = Date.now() + 800;
              setActive(t.id);
              const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              document.getElementById(t.id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
              window.history.replaceState(window.history.state, '', `#${t.id}`);
            }}
          >
            {t.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function VenuePreview({ performanceId }: { performanceId: number | null }) {
  const [layout] = useLayout(performanceId);
  // v4 배치 미리보기가 없거나 실패하면 숨긴다
  if (layout.kind !== 'ready') return null;
  return (
    <figure className="venue__preview">
      <SeatPreview layout={layout.data} />
      <figcaption className="venue__cap">좌석 배치 미리보기 · 실제 남은 좌석은 예매 단계에서 확인할 수 있어요</figcaption>
    </figure>
  );
}

function BookerBody({ show: s, booker, onReload, inSheet = false }: { show: ShowDetail; booker: Booker; onReload: () => void; inSheet?: boolean }) {
  if (s.performances.length === 0) return <p className="booker__none">등록된 회차가 없어요.</p>;
  const dayLabel = booker.day ? koreanDay(`${booker.day}T12:00:00+09:00`) : '';
  return (
    <div className="booker__body">
      <Calendar performances={s.performances} selected={booker.day} onSelect={booker.pickDay} />
      <hr className="booker__line" />
      <div className="booker__head">
        <h3 className="booker__subtitle">회차</h3>
        <span className="booker__day">{dayLabel}</span>
      </div>
      <fieldset className="times">
        <legend className="sr-only">{dayLabel} 회차</legend>
        {booker.dayPerfs.map((p) => {
          const n = s.performances.filter((x) => dayKey(x.startsAt) === dayKey(p.startsAt)).indexOf(p) + 1;
          const left = p.remainingByGrade.reduce((a, g) => a + g.remaining, 0);
          const off = p.status === 'SOLD_OUT' || p.status === 'CLOSED';
          return (
            <label key={p.id} className={`time-btn${off ? ' is-off' : ''}`}>
              <input
                type="radio"
                name={inSheet ? 'perf-m' : 'perf'}
                checked={booker.perfId === p.id}
                disabled={off}
                onChange={() => booker.setPerfId(p.id)}
              />
              <span className="time-btn__name">{n}회 {hm(p.startsAt)}</span>
              {p.status === 'SOLD_OUT' ? (
                <span className="time-btn__left time-btn__left--none">매진</span>
              ) : p.status === 'CLOSED' ? (
                <span className="time-btn__left">판매 종료</span>
              ) : p.status === 'UPCOMING' ? (
                <span className="time-btn__left">오픈 예정</span>
              ) : (
                <span className="time-btn__left">잔여 {left}석</span>
              )}
            </label>
          );
        })}
      </fieldset>
      {booker.perf && <Remaining perf={booker.perf} show={s} />}
      {!inSheet && booker.perf && <BookButton show={s} perf={booker.perf} booker={booker} onReload={onReload} />}
    </div>
  );
}

function Remaining({ perf, show }: { perf: PerformanceSummary; show: ShowDetail }) {
  return (
    <div className="remain">
      <div className="remain__head">
        <h3 className="remain__title">등급별 잔여석</h3>
        <span className="info-tip" tabIndex={0} aria-describedby={`tip-${perf.id}`}>
          <Icon name="info" size={16} />
          <span className="sr-only">잔여석 안내</span>
          <span className="info-tip__bubble" role="tooltip" id={`tip-${perf.id}`}>판매된 좌석만 뺀 수예요. 좌석 화면에서 더 적을 수 있어요.</span>
        </span>
      </div>
      <ul className="remain__list">
        {show.grades.map((g, i) => {
          const r = perf.remainingByGrade.find((x) => x.grade === g.code);
          const left = r?.remaining ?? 0;
          return (
            <li key={g.code}>
              <span className={`swatch g${i}`} aria-hidden="true" />
              <span className="remain__name">{g.name}</span>
              <span className="remain__price">{won(g.price)}</span>
              <span className={`remain__n${left === 0 ? ' is-none' : ''}`}>{left === 0 ? '매진' : `${left}석`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OpenCountdown({ at, onOpen }: { at: string; onOpen: () => void }) {
  const left = useSecondsUntil(at);
  const fired = useRef(false);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onOpen(); // 오픈 시각이 지나면 다시 불러와 '예매하기'로 바뀐다
    }
  }, [left, onOpen]);
  if (left === null) return null;
  return (
    <p className="booker__count" role="timer" aria-live="off">
      오픈까지 <span className="tnum">{longCountdown(left)}</span>
    </p>
  );
}

function BookButton({ show: s, perf, booker, onReload, compact = false }: { show: ShowDetail; perf: PerformanceSummary; booker: Booker; onReload: () => void; compact?: boolean }) {
  let button: ReactNode;
  let note: ReactNode = null;
  let top: ReactNode = null;
  if (perf.status === 'ON_SALE') {
    button = <button type="button" className="btn btn--primary btn--l btn--block" onClick={() => booker.book(perf)}>예매하기</button>;
    note = booker.loggedIn ? `1인 최대 ${s.maxSeatsPerBooking}매` : '로그인 후 예매할 수 있어요';
  } else if (perf.status === 'UPCOMING') {
    top = <OpenCountdown at={s.saleOpensAt} onOpen={onReload} />;
    button = <button type="button" className="btn btn--primary btn--l btn--block" disabled>{openLabel(s.saleOpensAt)} 오픈</button>;
    note = '오픈 시각이 지나면 바로 예매할 수 있어요';
  } else if (perf.status === 'SOLD_OUT') {
    button = <button type="button" className="btn btn--primary btn--l btn--block" disabled>매진된 회차예요</button>;
    note = '다른 회차를 골라 주세요';
  } else {
    button = <button type="button" className="btn btn--primary btn--l btn--block" disabled>끝난 공연이에요</button>;
  }
  return (
    <div className={`booker__cta${compact ? ' is-compact' : ''}`}>
      {top}
      {button}
      {note && !compact && <p className="booker__note">{note}</p>}
    </div>
  );
}

function MobileBookButton({ show: s, booker, onOpen }: { show: ShowDetail; booker: Booker; onOpen: () => void }) {
  const sellable = s.performances.filter((p) => p.status === 'ON_SALE');
  if (s.status === 'UPCOMING') {
    return <button type="button" className="btn btn--primary btn--l btn--block" disabled>{openLabel(s.saleOpensAt)} 오픈</button>;
  }
  if (sellable.length === 0) {
    return (
      <button type="button" className="btn btn--primary btn--l btn--block" disabled>
        {s.status === 'SOLD_OUT' ? '매진된 공연이에요' : '끝난 공연이에요'}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn btn--primary btn--l btn--block"
      onClick={() => (s.performances.length === 1 && sellable[0] ? booker.book(sellable[0]) : onOpen())}
    >
      예매하기
    </button>
  );
}
