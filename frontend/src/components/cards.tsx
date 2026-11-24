import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ShowSummary } from '../api';
import { openLabel, periodLabel, won } from '../format';
import { PosterArt } from './PosterArt';
import { dimmed, StatusBadges } from './bits';
import { Icon } from './Icon';

export function priceFrom(s: Pick<ShowSummary, 'minPrice' | 'maxPrice'>) {
  return s.minPrice === s.maxPrice ? won(s.minPrice) : `${won(s.minPrice)}~`;
}

/** 카드의 마지막 줄: 판매 중은 가격, 오픈 예정은 오픈 시각, 종료는 '판매 종료' */
function PriceLine({ s }: { s: ShowSummary }) {
  if (s.status === 'UPCOMING') return <span className="pcard__line pcard__line--open">{openLabel(s.saleOpensAt)} 오픈</span>;
  if (s.status === 'CLOSED') return <span className="pcard__line pcard__line--closed">판매 종료</span>;
  return <span className="pcard__line pcard__line--price">{priceFrom(s)}</span>;
}

/**
 * 포스터 카드(03 문서 3.6). 카드 전체가 하나의 링크.
 * - rank: 제목 위에 순위 숫자(랭킹 카드)
 * - open: 가격 줄 대신 오픈 시각을 제목 위에(티켓 오픈 섹션)
 */
export function PosterCard({ show: s, rank, variant = 'default' }: { show: ShowSummary; rank?: number; variant?: 'default' | 'open' }) {
  return (
    <Link to={`/shows/${s.id}`} className="pcard">
      <span className={`pcard__poster${dimmed(s.status) ? ' is-dim' : ''}`}>
        <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} />
        <StatusBadges show={s} />
      </span>
      {variant === 'open' && <span className="pcard__open">{openLabel(s.saleOpensAt)} 오픈</span>}
      {rank !== undefined && (
        <span className="pcard__rank">
          <span className="sr-only">판매 </span>{rank}<span className="sr-only">위</span>
        </span>
      )}
      <span className="pcard__title">{s.title}</span>
      <span className="pcard__meta pcard__venue">{s.venue}</span>
      <span className="pcard__meta">{periodLabel(s.firstStartsAt, s.lastStartsAt)}</span>
      {variant !== 'open' && <PriceLine s={s} />}
    </Link>
  );
}

/** 카드 뼈대(포스터 3:4 + 글줄 2개). 깜빡이지 않는 고정 색 */
export function CardSkeleton() {
  return (
    <span className="pcard pcard--skel" aria-hidden="true">
      <span className="skel skel--poster" />
      <span className="skel skel--line14" />
      <span className="skel skel--line12" />
    </span>
  );
}

/** 포스터 카드 격자: xl 5열 / lg 4열 / md 3열 / sm 2열. compact = 필터가 있는 검색(4열) */
export function CardGrid({ children, compact = false, label }: { children: ReactNode; compact?: boolean; label?: string }) {
  return <ul className={`grid${compact ? ' grid--4' : ''}`} aria-label={label}>{children}</ul>;
}

export function GridSkeleton({ count = 10, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div className={`grid${compact ? ' grid--4' : ''}`} aria-busy="true">
      <span className="sr-only" role="status">불러오는 중</span>
      {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

/**
 * 가로 카드 줄. 모바일은 손가락으로 밀고(카드 폭 140), PC는 격자 칸과 같은 폭으로 한 번에 5장(화살표로 5장씩).
 * 화살표는 PC에서만 보이며 바깥(섹션 제목 줄)에 둔다 → useRail()로 상태를 받아 RailArrows에 넘긴다.
 */
export function useRail(itemCount: number) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [itemCount]);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * (el.clientWidth + 24), behavior: reduce ? 'auto' : 'smooth' });
  };
  return { ref, edge, page };
}

export function RailArrows({ rail, label }: { rail: ReturnType<typeof useRail>; label: string }) {
  if (rail.edge.start && rail.edge.end) return null;
  return (
    <span className="rail-arrows">
      <button type="button" className="icon-btn icon-btn--line" onClick={() => rail.page(-1)} disabled={rail.edge.start} aria-label={`${label} 이전 공연`}>
        <Icon name="left" size={20} />
      </button>
      <button type="button" className="icon-btn icon-btn--line" onClick={() => rail.page(1)} disabled={rail.edge.end} aria-label={`${label} 다음 공연`}>
        <Icon name="right" size={20} />
      </button>
    </span>
  );
}

export function Rail({ rail, children, label }: { rail?: ReturnType<typeof useRail>; children: ReactNode; label?: string }) {
  return <ul className="rail" ref={rail?.ref} aria-label={label}>{children}</ul>;
}

export function RailSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="rail" aria-busy="true">
      <span className="sr-only" role="status">불러오는 중</span>
      {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

/** 섹션 제목 줄: 제목(+개수) · 가운데 칩 등 · 오른쪽 전체보기 */
export function SectionHead({
  id,
  title,
  count,
  countTone = 'muted',
  children,
  more,
}: {
  id: string;
  title: string;
  count?: number;
  countTone?: 'muted' | 'brand';
  children?: ReactNode;
  more?: { to: string; label?: string };
}) {
  return (
    <div className="sec-head">
      <h2 id={id} className="sec-head__title">
        {title}
        {count !== undefined && <span className={`sec-head__count sec-head__count--${countTone}`}>{count}</span>}
      </h2>
      {children && <div className="sec-head__mid">{children}</div>}
      {more && (
        <Link to={more.to} className="text-btn sec-head__more">
          {more.label ?? '전체보기'}
          <Icon name="right" size={16} />
        </Link>
      )}
    </div>
  );
}
