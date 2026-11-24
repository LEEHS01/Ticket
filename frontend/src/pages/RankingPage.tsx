import { Link, useSearchParams } from 'react-router';
import type { RankingPeriod, ShowSummary } from '../api';
import { useRanking, useShowList, type RankRow } from '../data';
import { genreFromSlug, GENRE_LABEL, GENRE_SLUG, GENRES, periodLabel, shortDateTime } from '../format';
import { usePageTitle } from '../shell';
import { LoadError, StatusBadges, dimmed } from '../components/bits';
import { priceFrom } from '../components/cards';
import { PosterArt } from '../components/PosterArt';

const PERIODS: { value: RankingPeriod; label: string }[] = [
  { value: 'DAILY', label: '일간' },
  { value: 'WEEKLY', label: '주간' },
  { value: 'ALL', label: '전체' },
];

/**
 * 랭킹(03 문서 4.3). 장르 밑줄 탭 → 1~3위 큰 칸 → 4위부터 가로 목록 줄 → 판매 기록이 없는 공연은 끝에 '집계 전'.
 * v4 랭킹 API가 없으면 전체 기간 판매 순으로 대신하고, 기간 단추·기준 시각·점유율을 숨긴다.
 */
export function RankingPage() {
  usePageTitle('랭킹');
  const [params, setParams] = useSearchParams();
  const genre = genreFromSlug(params.get('genre'));
  const period = (PERIODS.find((p) => p.value === params.get('period'))?.value ?? 'WEEKLY') as RankingPeriod;
  const [rank, retry] = useRanking(genre, period);
  const [shows] = useShowList();

  const setQuery = (next: { genre?: string | null; period?: RankingPeriod }) => {
    const p = new URLSearchParams(params);
    if (next.genre !== undefined) {
      if (next.genre) p.set('genre', next.genre);
      else p.delete('genre');
    }
    if (next.period) p.set('period', next.period);
    setParams(p, { replace: true });
  };

  const data = rank.kind === 'ready' ? rank.data : null;
  const ranked = new Set(data?.items.map((it) => it.show.id) ?? []);
  // 판매 기록이 없는 공연(집계 전): 같은 장르의 판매 중·오픈 예정 공연 중 랭킹에 없는 것
  const unranked: ShowSummary[] =
    data && shows.kind === 'ready'
      ? shows.data.filter((s) => (!genre || s.genre === genre) && !ranked.has(s.id) && s.status !== 'CLOSED')
      : [];

  return (
    <div className="page page--ranking">
      <div className="wrap">
        <div className="pagehead">
          <h1 className="pagehead__title" tabIndex={-1}>랭킹</h1>
          <p className="pagehead__sub">
            판매량 기준{data?.rankedAt ? ` · ${shortDateTime(data.rankedAt)} 기준` : ''}
          </p>
        </div>

        <div className="rank__bar">
          <nav className="tabs rank__tabs" aria-label="랭킹 장르">
            <Link to="/ranking" className="tab" aria-current={!genre ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setQuery({ genre: null }); }}>전체</Link>
            {GENRES.map((g) => (
              <Link
                key={g}
                to={`/ranking?genre=${GENRE_SLUG[g]}`}
                className="tab"
                aria-current={genre === g ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setQuery({ genre: GENRE_SLUG[g] });
                }}
              >
                {GENRE_LABEL[g]}
              </Link>
            ))}
          </nav>
          {data?.period && (
            <div className="seg rank__period" role="group" aria-label="집계 기간">
              {PERIODS.map((p) => (
                <button key={p.value} type="button" className="seg__btn" aria-pressed={period === p.value} onClick={() => setQuery({ period: p.value })}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {rank.kind === 'loading' && (
          <div className="rank__top" aria-busy="true">
            <span className="sr-only" role="status">불러오는 중</span>
            {[0, 1, 2].map((i) => <span key={i} className="skel skel--block rank__skel" aria-hidden="true" />)}
          </div>
        )}
        {rank.kind === 'error' && (
          <div className="rank__err"><LoadError error={rank.error} onRetry={retry} title="랭킹을 불러오지 못했어요" /></div>
        )}
        {data && data.items.length === 0 && unranked.length === 0 && <p className="sec-empty rank__err">아직 판매 기록이 없어요.</p>}
        {data && data.items.length > 0 && (
          <>
            <ol className="rank__top" aria-label="1위부터 3위">
              {data.items.slice(0, 3).map((it) => <TopCard key={it.show.id} row={it} />)}
            </ol>
            {data.items.length > 3 && (
              <ol className="rank__list" start={4} aria-label="4위부터">
                {data.items.slice(3).map((it, i) => <RankLine key={it.show.id} row={it} eager={i < 3} />)}
              </ol>
            )}
          </>
        )}
        {data && unranked.length > 0 && (
          <section className="rank__unranked" aria-labelledby="unranked-h">
            <h2 id="unranked-h" className="rank__unranked-title">집계 전</h2>
            <ul className="rank__list">
              {unranked.map((s) => <RankLine key={s.id} row={{ rank: 0, show: s, share: null }} />)}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function TopCard({ row }: { row: RankRow }) {
  const s = row.show;
  return (
    <li className="rtop">
      <Link to={`/shows/${s.id}`} className={`rtop__poster${dimmed(s.status) ? ' is-dim' : ''}`} tabIndex={-1} aria-hidden="true">
        <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} eager />
      </Link>
      <div className="rtop__body">
        <p className="rtop__rank"><span className="sr-only">판매 </span>{row.rank}<span className="sr-only">위</span></p>
        <h2 className="rtop__title"><Link to={`/shows/${s.id}`}>{s.title}</Link></h2>
        <p className="rtop__meta">{s.venue} · {periodLabel(s.firstStartsAt, s.lastStartsAt)}</p>
        <p className="rtop__price">
          {s.status === 'CLOSED' ? <span className="rtop__closed">판매 종료</span> : <span>{priceFrom(s)}</span>}
          <StatusBadges show={s} />
        </p>
        {row.share !== null && <p className="rtop__share">예매 점유율 {row.share.toFixed(1)}%</p>}
        <Link to={`/shows/${s.id}`} className="btn btn--line btn--s rtop__btn">예매하기</Link>
      </div>
    </li>
  );
}

function RankLine({ row, eager = false }: { row: RankRow; eager?: boolean }) {
  const s = row.show;
  return (
    <li className="lrow">
      <span className="lrow__lead">
        {row.rank > 0 ? (
          <span className="lrow__rank"><span className="sr-only">판매 </span>{row.rank}<span className="sr-only">위</span></span>
        ) : (
          <span className="lrow__rank lrow__rank--none" aria-label="순위 없음">–</span>
        )}
      </span>
      <span className="thumb thumb--72 lrow__thumb" aria-hidden="true">
        <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} eager={eager} />
      </span>
      <div className="lrow__body">
        <p className="lrow__title"><Link to={`/shows/${s.id}`}>{s.title}</Link></p>
        <p className="lrow__meta">{s.venue} · {periodLabel(s.firstStartsAt, s.lastStartsAt)}</p>
        <StatusBadges show={s} />
      </div>
      <div className="lrow__end">
        <div>
          <p className="lrow__price">{s.status === 'CLOSED' ? '판매 종료' : priceFrom(s)}</p>
          {row.share !== null && <p className="lrow__share">점유율 {row.share.toFixed(1)}%</p>}
        </div>
        <Link to={`/shows/${s.id}`} className="btn btn--line btn--s" aria-label={`${s.title} 예매하기`}>예매하기</Link>
      </div>
    </li>
  );
}
