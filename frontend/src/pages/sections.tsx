// 메인·장르 화면이 함께 쓰는 섹션: 티켓 오픈 예정, 랭킹, 이번 주 공연, 전체 목록
import { useMemo, useState } from 'react';
import type { Genre, SaleStatus, ShowSummary } from '../api';
import { useRanking, type Load } from '../data';
import { GENRE_LABEL, GENRE_SLUG, GENRES } from '../format';
import { GridSkeleton, PosterCard, Rail, RailArrows, RailSkeleton, SectionHead, useRail } from '../components/cards';
import { EmptyState, LoadError } from '../components/bits';
import { MoreGrid, useHistoryState } from '../components/MoreGrid';
import { Icon } from '../components/Icon';

export function upcomingOf(shows: ShowSummary[]) {
  return shows.filter((s) => s.status === 'UPCOMING').sort((a, b) => a.saleOpensAt.localeCompare(b.saleOpensAt));
}

/** 이번 주에 볼 수 있는 공연: 판매 중이고 첫 회차 ≤ 오늘+7일, 마지막 회차 ≥ 지금 */
export function thisWeekOf(shows: ShowSummary[], now = Date.now()) {
  const limit = now + 7 * 86_400_000;
  return shows
    .filter((s) => s.status === 'ON_SALE' && Date.parse(s.firstStartsAt) <= limit && Date.parse(s.lastStartsAt) >= now)
    .sort((a, b) => a.firstStartsAt.localeCompare(b.firstStartsAt));
}

// ── 티켓 오픈 예정 ──
export function OpenSection({ shows, title = '티켓 오픈 예정' }: { shows: Load<ShowSummary[]>; title?: string }) {
  if (shows.kind !== 'ready') return null; // 전체 목록 섹션이 로딩·오류를 보여 준다
  const list = upcomingOf(shows.data);
  if (list.length === 0) return null;
  return (
    <section className="sec" aria-labelledby="sec-open">
      <SectionHead id="sec-open" title={title} count={list.length} countTone="brand" more={{ to: '/open' }} />
      <Rail label={title}>
        {list.slice(0, 5).map((s) => (
          <li key={s.id}><PosterCard show={s} variant="open" eager /></li>
        ))}
      </Rail>
    </section>
  );
}

// ── 랭킹 카드 1~5위 ──
export function RankingSection({
  genre,
  chips,
  eagerTop = false,
}: {
  genre: Genre | null;
  chips: boolean;
  /** 화면 위쪽이라 첫 화면에 보이면 true */
  eagerTop?: boolean;
}) {
  const [picked, setPicked] = useState<Genre | null>(genre);
  const active = chips ? picked : genre;
  const [rank, retry] = useRanking(active);
  const title = genre ? `${GENRE_LABEL[genre]} 랭킹` : '지금 많이 보는 공연';
  return (
    <section className="sec" aria-labelledby="sec-rank">
      <SectionHead
        id="sec-rank"
        title={title}
        more={{ to: active ? `/ranking?genre=${GENRE_SLUG[active]}` : '/ranking', label: '랭킹 전체보기' }}
      >
        {chips && (
          <div className="chips chips--scroll" role="group" aria-label="랭킹 장르">
            <button type="button" className="chip" aria-pressed={picked === null} onClick={() => setPicked(null)}>전체</button>
            {GENRES.map((g) => (
              <button key={g} type="button" className="chip" aria-pressed={picked === g} onClick={() => setPicked(g)}>{GENRE_LABEL[g]}</button>
            ))}
          </div>
        )}
      </SectionHead>
      {rank.kind === 'loading' && <RailSkeleton />}
      {rank.kind === 'error' && <LoadError error={rank.error} onRetry={retry} title="랭킹을 불러오지 못했어요" />}
      {rank.kind === 'ready' &&
        (rank.data.items.length === 0 ? (
          <p className="sec-empty">아직 판매 기록이 없어요.</p>
        ) : (
          <Rail label={`${title} 1~5위`}>
            {/* 순위는 받은 목록 안의 순서(장르를 고르면 그 장르 안 1, 2, 3…) */}
            {rank.data.items.slice(0, 5).map((it, i) => (
              <li key={it.show.id}><PosterCard show={it.show} rank={i + 1} eager={eagerTop} /></li>
            ))}
          </Rail>
        ))}
    </section>
  );
}

// ── 이번 주에 볼 수 있는 공연(가로 넘김, 화살표로 5장씩) ──
export function ThisWeekSection({ shows }: { shows: Load<ShowSummary[]> }) {
  const list = shows.kind === 'ready' ? thisWeekOf(shows.data) : [];
  const rail = useRail(list.length);
  if (list.length === 0) return null;
  return (
    <section className="sec" aria-labelledby="sec-week">
      <SectionHead id="sec-week" title="이번 주에 볼 수 있는 공연">
        <RailArrows rail={rail} label="이번 주 공연" />
      </SectionHead>
      <Rail rail={rail} label="이번 주에 볼 수 있는 공연">
        {list.map((s) => (
          <li key={s.id}><PosterCard show={s} /></li>
        ))}
      </Rail>
    </section>
  );
}

// ── 정렬 ──
export type SortKey = 'date' | 'popular' | 'price' | 'new';
export const SORT_LABEL: Record<SortKey, string> = {
  date: '공연 가까운 순',
  popular: '인기순',
  price: '낮은 가격순',
  new: '최근 등록순',
};

export function sortShows(list: ShowSummary[], key: SortKey) {
  const out = [...list];
  if (key === 'popular') out.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  else if (key === 'price') out.sort((a, b) => a.minPrice - b.minPrice);
  else if (key === 'new') out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else out.sort((a, b) => a.firstStartsAt.localeCompare(b.firstStartsAt));
  // 판매 종료는 맨 뒤
  return out.sort((a, b) => Number(a.status === 'CLOSED') - Number(b.status === 'CLOSED'));
}

export function SortSelect<K extends string>({ value, options, onChange, label = '정렬' }: { value: K; options: Record<K, string>; onChange: (v: K) => void; label?: string }) {
  return (
    <label className="select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as K)}>
        {(Object.keys(options) as K[]).map((k) => <option key={k} value={k}>{options[k]}</option>)}
      </select>
      <Icon name="down" size={16} />
    </label>
  );
}

const STATUS_FILTERS: { value: SaleStatus | null; label: string }[] = [
  { value: null, label: '전체' },
  { value: 'ON_SALE', label: '판매 중' },
  { value: 'UPCOMING', label: '오픈 예정' },
  { value: 'CLOSED', label: '판매 종료' },
];

const isStatusFilter = (v: unknown): v is SaleStatus | null => v === null || STATUS_FILTERS.some((f) => f.value === v);
const isSortKey = (v: unknown): v is SortKey => typeof v === 'string' && v in SORT_LABEL;

// ── 전체 목록(상태 칩 + 정렬 + 5열 격자) ──
export function AllShowsSection({
  shows,
  onRetry,
  genre,
  title,
}: {
  shows: Load<ShowSummary[]>;
  onRetry: () => void;
  genre: Genre | null;
  title: string;
}) {
  // 상태 칩·정렬·펼친 개수는 방문 기록에 둔다(공연 상세에 갔다가 뒤로 오면 그대로)
  const [status, setStatus] = useHistoryState<SaleStatus | null>('status', null, isStatusFilter);
  const [sort, setSort] = useHistoryState<SortKey>('sort', 'date', isSortKey);
  const base = useMemo(() => (shows.kind === 'ready' ? shows.data.filter((s) => !genre || s.genre === genre) : []), [shows, genre]);
  const list = useMemo(() => {
    // '판매 중'에는 매진도 넣는다(판매 기간 안의 공연)
    const f = status === null ? base : base.filter((s) => (status === 'ON_SALE' ? s.status === 'ON_SALE' || s.status === 'SOLD_OUT' : s.status === status));
    return sortShows(f, sort);
  }, [base, status, sort]);

  return (
    <section className="sec" aria-labelledby="sec-all">
      <SectionHead id="sec-all" title={title} count={shows.kind === 'ready' ? base.length : undefined}>
        <span className="sec-head__push">
          <SortSelect value={sort} options={SORT_LABEL} onChange={setSort} />
        </span>
      </SectionHead>
      <div className="chips chips--scroll filter-row" role="group" aria-label="판매 상태">
        {STATUS_FILTERS.map((f) => (
          <button key={f.label} type="button" className="chip" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}>
            {f.label}
          </button>
        ))}
      </div>
      {shows.kind === 'loading' && <GridSkeleton />}
      {shows.kind === 'error' && <LoadError error={shows.error} onRetry={onRetry} title="공연 목록을 불러오지 못했어요" />}
      {shows.kind === 'ready' &&
        (list.length === 0 ? (
          <EmptyState title="조건에 맞는 공연이 없어요">
            <p>다른 판매 상태를 골라 보세요.</p>
          </EmptyState>
        ) : (
          <MoreGrid
            items={list}
            resetKey={`${status ?? 'ALL'}|${sort}`}
            label={title}
            render={(s) => <li key={s.id}><PosterCard show={s} /></li>}
          />
        ))}
    </section>
  );
}
