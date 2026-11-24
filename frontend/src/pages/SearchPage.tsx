import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { Genre, SaleStatus, ShowSummary } from '../api';
import { useRanking, useSearch, useShowList } from '../data';
import { GENRE_LABEL, GENRES } from '../format';
import { pushRecent } from '../recent';
import { usePageTitle } from '../shell';
import { EmptyState, Illust, LoadError } from '../components/bits';
import { CardGrid, EAGER_COUNT, GridSkeleton, PosterCard, Rail, SectionHead } from '../components/cards';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/overlay';
import { SearchBox } from '../components/SearchBox';
import { SortSelect } from './sections';

type SearchSort = 'relevance' | 'date' | 'popular' | 'price';
const SEARCH_SORT: Record<SearchSort, string> = {
  relevance: '정확도순',
  date: '공연 가까운 순',
  popular: '인기순',
  price: '낮은 가격순',
};
const STATUSES: { value: SaleStatus; label: string }[] = [
  { value: 'ON_SALE', label: '판매 중' },
  { value: 'UPCOMING', label: '오픈 예정' },
  { value: 'CLOSED', label: '판매 종료' },
];

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

/**
 * 검색 결과(03 문서 4.5). 서버는 q(제목·공연장)만 받고, 판매 상태·장르·지역 필터와 정렬은 화면에서 한다(공연 18개).
 * 필터·정렬은 주소(/search?q=&genre=&status=&region=&sort=)에 남겨 새로 고침·뒤로 가기에 견딘다.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim().slice(0, 40);
  const statuses = list(params.get('status')).filter((s): s is SaleStatus => STATUSES.some((x) => x.value === s));
  const genres = list(params.get('genre')).filter((g): g is Genre => (GENRES as string[]).includes(g));
  const regions = list(params.get('region'));
  const sortParam = params.get('sort');
  const sort: SearchSort = sortParam && sortParam in SEARCH_SORT ? (sortParam as SearchSort) : 'relevance';
  const [sheet, setSheet] = useState(false);
  usePageTitle(q ? `‘${q}’ 검색 결과` : '검색');

  useEffect(() => {
    if (q) pushRecent(q);
  }, [q]);

  const [res, retry] = useSearch(q);

  const update = (key: string, values: string[] | string | null) => {
    const p = new URLSearchParams(params);
    const v = Array.isArray(values) ? values.join(',') : values;
    if (v) p.set(key, v);
    else p.delete(key);
    setParams(p, { replace: true });
  };
  const toggle = (key: 'status' | 'genre' | 'region', cur: string[], v: string) =>
    update(key, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  const reset = () => {
    const p = new URLSearchParams();
    p.set('q', q);
    if (sort !== 'relevance') p.set('sort', sort);
    setParams(p, { replace: true });
  };

  const all = res.kind === 'ready' ? res.data : [];
  const regionOptions = useMemo(() => [...new Set(all.map((s) => s.region).filter(Boolean))].sort(), [all]);
  const results = useMemo(() => {
    const f = all.filter(
      (s) =>
        (statuses.length === 0 || statuses.includes(s.status === 'SOLD_OUT' ? 'ON_SALE' : s.status)) &&
        (genres.length === 0 || genres.includes(s.genre)) &&
        (regions.length === 0 || regions.includes(s.region)),
    );
    return sortResults(f, sort, q);
  }, [all, statuses, genres, regions, sort, q]);
  const filterCount = statuses.length + genres.length + regions.length;

  const filters = (
    <Filters
      statuses={statuses}
      genres={genres}
      regions={regions}
      regionOptions={regionOptions}
      onToggle={toggle}
      onReset={reset}
      count={filterCount}
    />
  );

  return (
    <div className="page page--search">
      <div className="wrap">
        <div className="search__mbox">
          <SearchBox variant="page" />
        </div>

        {!q ? (
          <>
            <h1 className="sr-only" tabIndex={-1}>검색</h1>
            <NoQuery />
          </>
        ) : (
          <>
            <div className="sr-head">
              <h1 className="sr-head__title" tabIndex={-1}>
                ‘{q}’ 검색 결과
                {res.kind === 'ready' && <span className="sr-head__count">{results.length}개</span>}
              </h1>
              <div className="sr-head__tools">
                <button type="button" className="btn btn--line btn--s sr-head__filter" onClick={() => setSheet(true)}>
                  필터 <Icon name="filter" size={16} />
                  {filterCount > 0 && <span className="sr-head__fcount">{filterCount}</span>}
                </button>
                <SortSelect value={sort} options={SEARCH_SORT} onChange={(v) => update('sort', v === 'relevance' ? null : v)} />
              </div>
            </div>

            <div className="sr">
              <aside className="sr__filters" aria-label="검색 필터">{filters}</aside>
              <div className="sr__results">
                {filterCount > 0 && (
                  <div className="sr__applied">
                    <span className="sr-only">적용한 필터:</span>
                    {[
                      ...genres.map((g) => ({ key: 'genre' as const, v: g, label: GENRE_LABEL[g], cur: genres })),
                      ...statuses.map((s) => ({ key: 'status' as const, v: s, label: STATUSES.find((x) => x.value === s)!.label, cur: statuses })),
                      ...regions.map((r) => ({ key: 'region' as const, v: r, label: r, cur: regions })),
                    ].map((f) => (
                      <button key={`${f.key}-${f.v}`} type="button" className="chip is-on" onClick={() => toggle(f.key, f.cur, f.v)} aria-label={`${f.label} 필터 빼기`}>
                        {f.label}
                        <Icon name="close" size={14} className="chip__x" />
                      </button>
                    ))}
                  </div>
                )}
                {res.kind === 'loading' && <GridSkeleton count={8} compact />}
                {res.kind === 'error' && <LoadError error={res.error} onRetry={retry} title="검색하지 못했어요" />}
                {res.kind === 'ready' &&
                  (results.length === 0 ? (
                    <NoResult q={q} filtered={filterCount > 0 && all.length > 0} onReset={reset} />
                  ) : (
                    <CardGrid compact label="검색 결과">
                      {results.map((s, i) => <li key={s.id}><PosterCard show={s} eager={i < EAGER_COUNT} /></li>)}
                    </CardGrid>
                  ))}
              </div>
            </div>

            <Sheet
              open={sheet}
              onClose={() => setSheet(false)}
              title="필터"
              footer={
                <button type="button" className="btn btn--primary btn--l btn--block" onClick={() => setSheet(false)}>
                  결과 {results.length}개 보기
                </button>
              }
            >
              {filters}
            </Sheet>
          </>
        )}
      </div>
    </div>
  );
}

function sortResults(list: ShowSummary[], sort: SearchSort, q: string) {
  const out = [...list];
  const score = (s: ShowSummary) => (s.title.includes(q) ? 0 : s.venue.includes(q) ? 1 : 2);
  const byDate = (a: ShowSummary, b: ShowSummary) => a.firstStartsAt.localeCompare(b.firstStartsAt);
  if (sort === 'relevance') out.sort((a, b) => score(a) - score(b) || byDate(a, b));
  else if (sort === 'popular') out.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  else if (sort === 'price') out.sort((a, b) => a.minPrice - b.minPrice);
  else out.sort(byDate);
  return out.sort((a, b) => Number(a.status === 'CLOSED') - Number(b.status === 'CLOSED'));
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="fgroup">
      <legend className="fgroup__title">{title}</legend>
      <div className="chips">{children}</div>
    </fieldset>
  );
}

function CheckChip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      {on && <Icon name="check" size={12} />}
      {label}
    </button>
  );
}

function Filters({
  statuses,
  genres,
  regions,
  regionOptions,
  onToggle,
  onReset,
  count,
}: {
  statuses: SaleStatus[];
  genres: Genre[];
  regions: string[];
  regionOptions: string[];
  onToggle: (key: 'status' | 'genre' | 'region', cur: string[], v: string) => void;
  onReset: () => void;
  count: number;
}) {
  return (
    <div className="filters">
      <div className="filters__head">
        <p className="filters__title">필터</p>
        <button type="button" className="text-btn" onClick={onReset} disabled={count === 0}>
          <Icon name="reset" size={14} /> 초기화
        </button>
      </div>
      <FilterGroup title="판매 상태">
        {STATUSES.map((s) => <CheckChip key={s.value} on={statuses.includes(s.value)} label={s.label} onClick={() => onToggle('status', statuses, s.value)} />)}
      </FilterGroup>
      <FilterGroup title="장르">
        {GENRES.map((g) => <CheckChip key={g} on={genres.includes(g)} label={GENRE_LABEL[g]} onClick={() => onToggle('genre', genres, g)} />)}
      </FilterGroup>
      {/* 지역은 지역 데이터(v4 region)가 있을 때만 */}
      {regionOptions.length > 0 && (
        <FilterGroup title="지역">
          {regionOptions.map((r) => <CheckChip key={r} on={regions.includes(r)} label={r} onClick={() => onToggle('region', regions, r)} />)}
        </FilterGroup>
      )}
    </div>
  );
}

function Popular({ title }: { title: string }) {
  const [rank] = useRanking(null);
  const [shows] = useShowList();
  const items = rank.kind === 'ready' && rank.data.items.length > 0
    ? rank.data.items.slice(0, 5).map((it) => it.show)
    : shows.kind === 'ready' ? shows.data.filter((s) => s.status === 'ON_SALE').slice(0, 5) : [];
  if (items.length === 0) return null;
  return (
    <section className="sec sr__popular" aria-labelledby="pop-h">
      <SectionHead id="pop-h" title={title} more={{ to: '/ranking', label: '랭킹 전체보기' }} />
      <Rail label={title}>
        {items.map((s, i) => <li key={s.id}><PosterCard show={s} rank={i + 1} eager /></li>)}
      </Rail>
    </section>
  );
}

function NoResult({ q, filtered, onReset }: { q: string; filtered: boolean; onReset: () => void }) {
  return (
    <>
      <div className="empty">
        <Illust name="illust-empty" icon="search" />
        <p className="empty__title">{filtered ? '필터에 맞는 공연이 없어요' : `‘${q}’와 맞는 공연이 없어요`}</p>
        <div className="empty__body">
          <p>{filtered ? '필터를 줄이거나 초기화해 보세요.' : '공연 이름이나 공연장 이름의 일부로 찾아보세요.'}</p>
        </div>
        {filtered && (
          <div className="empty__actions">
            <button type="button" className="btn btn--line btn--m" onClick={onReset}>필터 초기화</button>
          </div>
        )}
      </div>
      <Popular title="지금 많이 보는 공연" />
    </>
  );
}

/** 검색어 없이 들어왔을 때: 최근 검색어(검색창 펼침과 같은 내용) + 많이 찾는 공연 */
function NoQuery() {
  return (
    <div className="sr__noq">
      <EmptyState title="찾고 싶은 공연이 있나요?" icon="search">
        <p>공연 이름이나 공연장 이름으로 찾아보세요.</p>
      </EmptyState>
      <Popular title="많이 찾는 공연" />
    </div>
  );
}
