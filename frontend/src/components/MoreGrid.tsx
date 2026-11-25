import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CardGrid } from './cards';
import { Icon } from './Icon';

/** 카드 격자를 한 번에 그리는 개수(PC 5열 × 4줄). "더 보기"를 누를 때마다 이만큼 늘린다 */
export const PAGE_SIZE = 20;

type Bag = Record<string, unknown>;

/**
 * 화면 상태 하나를 지금 방문 기록(history state)에 둔다. 주소는 그대로이고,
 * 다른 화면에 갔다가 뒤로 가기로 돌아오면 그 값이 살아난다. 새 방문(링크로 다시 들어옴)은 처음 값.
 */
export function useHistoryState<T>(key: string, initial: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const bag: Bag = location.state && typeof location.state === 'object' ? (location.state as Bag) : {};
  const raw = bag[key];
  const value = raw !== undefined && valid(raw) ? raw : initial;
  const set = (v: T) =>
    navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: { ...bag, [key]: v } });
  return [value, set];
}

type Shown = { n: number; r: string };
const isShown = (v: unknown): v is Shown =>
  !!v && typeof v === 'object' && typeof (v as Shown).n === 'number' && typeof (v as Shown).r === 'string';

/**
 * 받은 목록을 20개씩 나눠 그리는 카드 격자. API는 한 번에 받고 화면에서만 나눈다.
 * - resetKey(필터·정렬 등)가 바뀌면 처음 20개로 돌아간다.
 * - 펼친 개수는 방문 기록에 남겨 뒤로 가기로 돌아와도 유지한다.
 * - "더 보기"를 누르면 새로 나온 첫 카드로 초점을 옮긴다(키보드·화면 낭독기 사용자가 처음부터 다시 훑지 않게).
 */
export function MoreGrid<T>({
  items,
  render,
  resetKey,
  label,
  compact = false,
}: {
  items: T[];
  render: (item: T, index: number) => ReactNode;
  resetKey: string;
  label?: string;
  compact?: boolean;
}) {
  const [saved, setSaved] = useHistoryState<Shown | null>('shown', null, isShown as (v: unknown) => v is Shown | null);
  const shown = saved && saved.r === resetKey ? Math.max(PAGE_SIZE, saved.n) : PAGE_SIZE;
  const visible = items.slice(0, shown);
  const rest = items.length - visible.length;
  const wrap = useRef<HTMLDivElement>(null);
  const focusAt = useRef<number | null>(null);

  useEffect(() => {
    const i = focusAt.current;
    if (i === null) return;
    focusAt.current = null;
    wrap.current?.querySelector<HTMLElement>(`:scope > ul > li:nth-child(${i + 1}) a`)?.focus();
  }, [shown]);

  return (
    <div ref={wrap}>
      <CardGrid compact={compact} label={label}>{visible.map(render)}</CardGrid>
      {rest > 0 && (
        <div className="more">
          <button
            type="button"
            className="btn btn--line btn--m more__btn"
            onClick={() => {
              focusAt.current = shown;
              setSaved({ n: shown + PAGE_SIZE, r: resetKey });
            }}
          >
            더 보기
            <span className="more__rest">{rest}개 남음</span>
            <Icon name="down" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
