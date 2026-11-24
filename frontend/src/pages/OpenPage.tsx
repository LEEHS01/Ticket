import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Genre, ShowSummary } from '../api';
import { useShowList } from '../data';
import { daysUntil, dDayLabel, dDayShort, GENRE_LABEL, GENRES, hm, openLabel, periodLabel, shortDate } from '../format';
import { downloadOpenIcs } from '../ics';
import { usePageTitle } from '../shell';
import { Badge, EmptyState, LoadError } from '../components/bits';
import { CardGrid, GridSkeleton, PosterCard, SectionHead } from '../components/cards';
import { PosterArt } from '../components/PosterArt';
import { Icon } from '../components/Icon';
import { useToast } from '../components/overlay';
import { SortSelect, upcomingOf } from './sections';

type OpenSort = 'open' | 'date';
const OPEN_SORT: Record<OpenSort, string> = { open: '오픈 가까운 순', date: '공연 가까운 순' };

/** 티켓 오픈 예정(03 문서 4.4): 곧 열려요(3칸) → 오픈 일정(장르 칩·정렬) → 최근 오픈한 공연 */
export function OpenPage() {
  usePageTitle('티켓 오픈 예정');
  const [shows, retry] = useShowList();
  const [genre, setGenre] = useState<Genre | null>(null);
  const [sort, setSort] = useState<OpenSort>('open');

  const upcoming = useMemo(() => (shows.kind === 'ready' ? upcomingOf(shows.data) : []), [shows]);
  const schedule = useMemo(() => {
    const f = upcoming.filter((s) => !genre || s.genre === genre);
    return sort === 'date' ? [...f].sort((a, b) => a.firstStartsAt.localeCompare(b.firstStartsAt)) : f;
  }, [upcoming, genre, sort]);
  // 최근 오픈한 공연: 판매 중이고 오픈한 지 7일 안
  const recent = useMemo(
    () =>
      shows.kind === 'ready'
        ? shows.data
            .filter((s) => (s.status === 'ON_SALE' || s.status === 'SOLD_OUT') && daysUntil(s.saleOpensAt) >= -7)
            .sort((a, b) => b.saleOpensAt.localeCompare(a.saleOpensAt))
        : [],
    [shows],
  );

  return (
    <div className="page page--open">
      <div className="wrap">
        <div className="pagehead">
          <h1 className="pagehead__title" tabIndex={-1}>티켓 오픈 예정</h1>
          <p className="pagehead__sub">오픈 시각이 지나면 상세에서 바로 예매할 수 있어요</p>
        </div>

        {shows.kind === 'loading' && <div className="open__first"><GridSkeleton count={5} /></div>}
        {shows.kind === 'error' && <div className="open__first"><LoadError error={shows.error} onRetry={retry} title="오픈 예정 공연을 불러오지 못했어요" /></div>}

        {shows.kind === 'ready' && upcoming.length === 0 && (
          <EmptyState title="예정된 티켓 오픈이 없어요" icon="clock" actions={<Link to="/" className="btn btn--primary btn--m">공연 둘러보기</Link>}>
            <p>새 공연의 오픈 일정이 정해지면 여기에 보여요.</p>
          </EmptyState>
        )}

        {upcoming.length > 0 && (
          <div className="open__sections">
            <section className="sec" aria-labelledby="soon-h">
              <SectionHead id="soon-h" title="곧 열려요" />
              <ul className="soon">
                {upcoming.slice(0, 3).map((s) => <SoonCard key={s.id} s={s} />)}
              </ul>
            </section>

            <section className="sec" aria-labelledby="sched-h">
              <SectionHead id="sched-h" title="오픈 일정" count={schedule.length}>
                <div className="chips chips--scroll" role="group" aria-label="장르">
                  <button type="button" className="chip" aria-pressed={genre === null} onClick={() => setGenre(null)}>전체</button>
                  {GENRES.map((g) => (
                    <button key={g} type="button" className="chip" aria-pressed={genre === g} onClick={() => setGenre(g)}>{GENRE_LABEL[g]}</button>
                  ))}
                </div>
                <span className="sec-head__push"><SortSelect value={sort} options={OPEN_SORT} onChange={setSort} /></span>
              </SectionHead>
              {schedule.length === 0 ? (
                <p className="sec-empty">이 장르의 오픈 일정은 아직 없어요.</p>
              ) : (
                <ul className="open__list">
                  {schedule.map((s, i) => <ScheduleRow key={s.id} s={s} eager={i < 3} />)}
                </ul>
              )}
            </section>
          </div>
        )}

        {recent.length > 0 && (
          <section className="sec open__recent" aria-labelledby="recent-h">
            <SectionHead id="recent-h" title="최근 오픈한 공연" />
            <CardGrid label="최근 오픈한 공연">
              {recent.map((s) => <li key={s.id}><PosterCard show={s} /></li>)}
            </CardGrid>
          </section>
        )}
      </div>
    </div>
  );
}

function SoonCard({ s }: { s: ShowSummary }) {
  const toast = useToast();
  const near = daysUntil(s.saleOpensAt) <= 3;
  return (
    <li className="soon__card">
      <Link to={`/shows/${s.id}`} className="soon__poster" tabIndex={-1} aria-hidden="true">
        <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} eager />
      </Link>
      <div className="soon__body">
        <span className={`soon__dday${near ? ' is-near' : ''}`}>{dDayShort(s.saleOpensAt)}</span>
        <p className="soon__when">{openLabel(s.saleOpensAt)} 오픈</p>
        <h3 className="soon__title"><Link to={`/shows/${s.id}`}>{s.title}</Link></h3>
        <p className="soon__venue">{s.venue}</p>
        <div className="soon__actions">
          <Link to={`/shows/${s.id}`} className="btn btn--line btn--s">공연 정보</Link>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              downloadOpenIcs(s);
              toast('캘린더 파일을 내려받았어요');
            }}
          >
            <Icon name="calendar" size={16} />
            캘린더에 추가
          </button>
        </div>
      </div>
    </li>
  );
}

function ScheduleRow({ s, eager = false }: { s: ShowSummary; eager?: boolean }) {
  const d = dDayLabel(s.saleOpensAt);
  return (
    <li className="lrow">
      <span className="lrow__lead">
        <span className="lrow__date">{shortDate(s.saleOpensAt).slice(0, 5)}</span>
        <span className="lrow__time">{shortDate(s.saleOpensAt).slice(5)} {hm(s.saleOpensAt)}</span>
      </span>
      <span className="thumb thumb--72 lrow__thumb" aria-hidden="true">
        <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} eager={eager} />
      </span>
      <div className="lrow__body">
        <p className="lrow__title"><Link to={`/shows/${s.id}`}>{s.title}</Link></p>
        <p className="lrow__meta">{s.venue} · {periodLabel(s.firstStartsAt, s.lastStartsAt)}</p>
      </div>
      <div className="lrow__end">
        {d ? <Badge kind="dday">{d}</Badge> : <Badge kind="upcoming">오픈 예정</Badge>}
        <Link to={`/shows/${s.id}`} className="btn btn--line btn--s" aria-label={`${s.title} 공연 정보`}>공연 정보</Link>
      </div>
    </li>
  );
}
