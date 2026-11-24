import { useMemo, useState } from 'react';
import type { PerformanceSummary } from '../api';
import { dayKey } from '../format';
import { Icon } from './Icon';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 관람일 달력(03 문서 3.6, 한국 시간 기준).
 * - 회차가 있는 날만 누를 수 있다. 회차가 있는 첫 달(또는 선택한 날의 달)로 연다.
 * - 회차가 없는 달로는 넘길 수 없다(화살표 비활성).
 */
export function Calendar({
  performances,
  selected,
  onSelect,
}: {
  performances: PerformanceSummary[];
  selected: string | null;
  onSelect: (day: string) => void;
}) {
  const byDay = useMemo(() => {
    const m = new Map<string, PerformanceSummary[]>();
    for (const p of performances) {
      const k = dayKey(p.startsAt);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [performances]);

  const months = useMemo(() => [...new Set([...byDay.keys()].map((k) => k.slice(0, 7)))].sort(), [byDay]);
  const today = dayKey(Date.now());

  const initial = Math.max(0, months.indexOf((selected ?? months[0] ?? '').slice(0, 7)));
  const [mi, setMi] = useState(initial);
  const month = months[mi];
  if (!month) return null;

  const [y, m] = month.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [...Array<null>(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div className="cal">
      <div className="cal__head">
        <button type="button" className="icon-btn" onClick={() => setMi(mi - 1)} disabled={mi === 0} aria-label="이전 달">
          <Icon name="left" size={20} />
        </button>
        <p className="cal__month" aria-live="polite">
          <span className="sr-only">{y}년 {m}월</span>
          <span aria-hidden="true">{y}.{String(m).padStart(2, '0')}</span>
        </p>
        <button type="button" className="icon-btn" onClick={() => setMi(mi + 1)} disabled={mi >= months.length - 1} aria-label="다음 달">
          <Icon name="right" size={20} />
        </button>
      </div>
      <div className="cal__grid" role="group" aria-label={`${y}년 ${m}월 관람일`}>
        {WEEK.map((w, i) => (
          <span key={w} className={`cal__dow${i === 0 ? ' is-sun' : ''}`} aria-hidden="true">{w}</span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} aria-hidden="true" />;
          const key = `${month}-${String(d).padStart(2, '0')}`;
          const dow = (firstDow + d - 1) % 7;
          const isToday = key === today;
          const ps = byDay.get(key);
          const sun = dow === 0 ? ' is-sun' : '';
          const todayMark = isToday ? <span className="cal__today">오늘</span> : null;
          if (!ps) {
            return (
              <span key={key} className={`cal__day is-off${sun}`} aria-hidden="true">
                <span className="cal__num">{d}</span>
                {todayMark}
              </span>
            );
          }
          const open = ps.some((p) => p.status === 'ON_SALE' || p.status === 'UPCOMING');
          const isSel = selected === key;
          return (
            <button
              key={key}
              type="button"
              className={`cal__day${open ? ' is-open' : ' is-muted'}${sun}${isSel ? ' is-selected' : ''}`}
              aria-pressed={isSel}
              aria-label={`${m}월 ${d}일 ${WEEK[dow]}요일${isToday ? ', 오늘' : ''}, 회차 ${ps.length}개${open ? '' : ', 예매 불가'}`}
              onClick={() => onSelect(key)}
            >
              <span className="cal__num">{d}</span>
              {todayMark ?? <span className="cal__dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
