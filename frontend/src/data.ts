// 화면에서 함께 쓰는 조회 훅. 같은 내용을 여러 화면이 쓰므로(메인·장르·검색·랭킹) 잠깐 메모리에 담아 둔다.
// - 캐시는 이 탭의 메모리에만 있다(저장소에 넣지 않음). 30초가 지나면 다음 사용 때 뒤에서 새로 받는다.
// - v4 엔드포인트(배너·공지·랭킹·배치 미리보기)는 v3 백엔드에 없을 수 있다. 호출부가 실패를 보고 영역을 숨기거나 대체한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  toApiError,
  type ApiError,
  type Banner,
  type Genre,
  type NoticeCategory,
  type NoticePage,
  type RankingPeriod,
  type SeatLayout,
  type ShowSummary,
} from './api';

export type Load<T> = { kind: 'loading' } | { kind: 'error'; error: ApiError } | { kind: 'ready'; data: T };

const TTL_MS = 30_000;
const cache = new Map<string, { data: unknown; at: number }>();

/** 예매·취소 뒤처럼 잔여석이 바뀌었을 때 공연 목록 캐시를 비운다 */
export function invalidate(prefix: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

/**
 * key가 같으면 같은 자료. key가 null이면 부르지 않는다.
 * 돌려주는 retry()는 캐시를 버리고 다시 받는다.
 */
export function useResource<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>): [Load<T>, () => void] {
  const hit = key ? cache.get(key) : undefined;
  const [state, setState] = useState<Load<T>>(() => (hit ? { kind: 'ready', data: hit.data as T } : { kind: 'loading' }));
  const [attempt, setAttempt] = useState(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  useEffect(() => {
    if (!key) return;
    const cached = cache.get(key);
    if (cached) {
      setState({ kind: 'ready', data: cached.data as T });
      if (Date.now() - cached.at < TTL_MS) return;
    } else {
      setState({ kind: 'loading' });
    }
    const ac = new AbortController();
    fetchRef.current(ac.signal).then(
      (data) => {
        cache.set(key, { data, at: Date.now() });
        setState({ kind: 'ready', data });
      },
      (err) => {
        if (ac.signal.aborted) return;
        // 캐시가 있으면 그것을 계속 보여 준다(뒤에서 새로 받기만 실패)
        if (!cached) setState({ kind: 'error', error: toApiError(err) });
      },
    );
    return () => ac.abort();
  }, [key, attempt]);

  const retry = useCallback(() => {
    if (key) cache.delete(key);
    setAttempt((n) => n + 1);
  }, [key]);

  return [state, retry];
}

/** 전체 공연(공연 가까운 순). 공연이 18개라 장르·상태·검색 필터와 정렬은 화면에서 한다(03 문서 4.5) */
export function useShowList() {
  return useResource<ShowSummary[]>('shows:all', (signal) => api.listShows({ sort: 'date' }, signal));
}

/** 검색: 서버는 q만 받고(제목·공연장), 나머지 필터·정렬은 화면에서 */
export function useSearch(q: string) {
  return useResource<ShowSummary[]>(q ? `shows:q:${q}` : null, (signal) => api.listShows({ q, sort: 'date' }, signal));
}

export type RankRow = { rank: number; show: ShowSummary; share: number | null };
export type RankData = { rankedAt: string | null; period: RankingPeriod | null; items: RankRow[] };

/**
 * 랭킹. v4 GET /api/rankings를 쓰고, 엔드포인트가 없는 백엔드(404)면 v3 방식(전체 기간 판매 순, 받은 목록 안의 순서)으로 대신한다.
 * 그때는 기준 시각·기간·점유율이 없다(period: null) → 화면은 기간 단추와 점유율을 숨긴다.
 */
export function useRanking(genre: Genre | null, period: RankingPeriod = 'WEEKLY') {
  return useResource<RankData>(`rank:${genre ?? 'ALL'}:${period}`, async (signal) => {
    try {
      const r = await api.rankings({ genre: genre ?? undefined, period }, signal);
      return { rankedAt: r.rankedAt, period: r.period, items: r.items.map((it) => ({ rank: it.rank, show: it.show, share: it.share })) };
    } catch (err) {
      const e = toApiError(err);
      if (!e.isMissingEndpoint) throw e;
      const shows = await api.listShows({ genre: genre ?? undefined, sort: 'ranking' }, signal);
      return {
        rankedAt: null,
        period: null,
        items: shows.filter((s) => s.rank !== null).map((show, i) => ({ rank: i + 1, show, share: null })),
      };
    }
  });
}

export function useBanners() {
  return useResource<Banner[]>('banners', (signal) => api.banners(signal));
}

export function useNotices(category: NoticeCategory | null, page: number, size: number) {
  return useResource<NoticePage>(`notices:${category ?? 'ALL'}:${page}:${size}`, (signal) =>
    api.notices({ category: category ?? undefined, page, size }, signal),
  );
}

export function useLayout(performanceId: number | null) {
  return useResource<SeatLayout>(performanceId ? `layout:${performanceId}` : null, (signal) => api.layout(performanceId!, signal));
}

/** 미디어 쿼리 상태(767px 이하 = 모바일) */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const MOBILE = '(max-width: 767px)';
export const useIsMobile = () => useMedia(MOBILE);
export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');
