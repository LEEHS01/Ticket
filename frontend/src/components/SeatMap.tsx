import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Grade, Seat, SeatLayout, SeatMap as SeatMapData } from '../api';
import { won } from '../format';
import { Icon } from './Icon';

/** 좌석 한 변 크기 단계(px). 인라인 style 없이 sz-N 클래스로 그린다(CSP) */
const SIZES = [12, 14, 16, 18, 20, 22, 24, 26, 28, 32] as const;
type Size = (typeof SIZES)[number];

/** 그 크기에서의 간격(03 문서 3.6: 좌석 사이 4, 통로 16, 행 이름 폭 20). 20px 미만은 촘촘하게 */
function metrics(size: number) {
  const compact = size < 20;
  return { gap: compact ? 2 : 4, aisle: compact ? 8 : 16, label: compact ? 16 : 20, labelGap: compact ? 4 : 8 };
}

function widthAt(size: number, perRow: number, aisles: number) {
  const m = metrics(size);
  // 통로 칸은 좌석 사이 간격(gap) 대신 aisle만큼 벌어진다(CSS .seatcell--aisle의 margin = aisle − gap)
  return perRow * size + (perRow - 1) * m.gap + aisles * (m.aisle - m.gap) + 2 * (m.label + m.labelGap);
}

/** base 이하에서 폭에 들어가는 가장 큰 크기. 12도 안 들어가면 12(가로로 민다) */
function fitSize(width: number, perRow: number, aisles: number, base: number): Size {
  const candidates = SIZES.filter((s) => s <= base);
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (widthAt(candidates[i]!, perRow, aisles) <= width) return candidates[i]!;
  }
  return SIZES[0];
}

/**
 * 좌석 배치도(03 문서 3.6, 4.8).
 * - 무대가 위, 행은 무대에서 가까운 순. aisleAfter 번호 뒤에 통로. seats[]에 없는 (행, 번호)는 빈칸.
 * - 등급 색은 등급 순서(g0~g3) 클래스로, 상태는 seat--* 클래스로 표시한다(인라인 style 없음 → CSP 안전).
 * - 처음에는 영역 폭에 맞춘다(PC 최대 24, 모바일 최대 22). ＋/－로 크기를 바꾸고 ⟲로 처음 크기로.
 *   터치 화면에서는 두 손가락으로 확대·축소, 한 손가락으로 밀기.
 * - 키보드: 배치도 안에서는 좌석 하나만 Tab으로 들어가고(roving tabindex), 화살표로 이동, Home/End로 행 끝, 스페이스·엔터로 선택.
 * - 마우스 올림·포커스 때 말풍선 "B열 5번 · R석 132,000원"(CSS ::after, data-tip).
 */
export function SeatMap({
  map,
  selected,
  onToggle,
  highlight,
  base,
}: {
  map: SeatMapData;
  selected: Set<number>;
  onToggle: (seat: Seat) => void;
  /** 이 등급만 강조(모바일 등급 칩) */
  highlight: string | null;
  /** 처음 맞춤 크기의 상한: PC 24, 모바일 22 */
  base: 22 | 24;
}) {
  const gradeIndex = useMemo(() => new Map(map.grades.map((g, i) => [g.code, i])), [map.grades]);
  const gradeOf = useMemo(() => new Map(map.grades.map((g) => [g.code, g])), [map.grades]);

  const matrix = useMemo(() => {
    const byKey = new Map(map.seats.map((s) => [`${s.row}-${s.number}`, s]));
    return map.rows.map((row) => Array.from({ length: map.seatsPerRow }, (_, i) => byKey.get(`${row}-${i + 1}`) ?? null));
  }, [map]);

  const firstSelectable = useMemo(() => map.seats.find((s) => s.status === 'AVAILABLE' || s.status === 'MINE') ?? map.seats[0], [map.seats]);
  const [focusId, setFocusId] = useState<number | null>(null);
  const activeId = focusId !== null && map.seats.some((s) => s.id === focusId) ? focusId : firstSelectable?.id ?? null;
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const scrollRef = useRef<HTMLDivElement>(null);

  const aisles = map.aisleAfter.filter((n) => n < map.seatsPerRow).length;
  const [fit, setFit] = useState<Size>(base === 24 ? 24 : 22);
  const [size, setSize] = useState<Size | null>(null); // null = 맞춤
  const current: Size = size ?? fit;

  // 영역 폭에 맞춘 크기
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setFit(fitSize(w, map.seatsPerRow, aisles, base));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [map.seatsPerRow, aisles, base]);

  // 크기를 바꿔도 보던 곳(가운데)이 그대로 보이게
  const centerRef = useRef<{ x: number; y: number } | null>(null);
  const changeSize = useCallback((next: Size | null) => {
    const el = scrollRef.current;
    if (el) {
      centerRef.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth),
        y: (el.scrollTop + el.clientHeight / 2) / Math.max(1, el.scrollHeight),
      };
    }
    setSize(next);
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const c = centerRef.current;
    if (!el) return;
    if (c) {
      el.scrollLeft = c.x * el.scrollWidth - el.clientWidth / 2;
      el.scrollTop = c.y * el.scrollHeight - el.clientHeight / 2;
      centerRef.current = null;
    } else if (el.scrollWidth > el.clientWidth) {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; // 무대 정면
    }
  }, [current]);

  const idx = SIZES.indexOf(current);
  const zoomIn = () => changeSize(SIZES[Math.min(SIZES.length - 1, idx + 1)]!);
  const zoomOut = () => changeSize(SIZES[Math.max(0, idx - 1)]!);

  // 두 손가락 확대·축소(브라우저 확대는 touch-action으로 막고 여기서 크기 단계를 바꾼다)
  const pinchRef = useRef<{ dist: number; size: number } | null>(null);
  const sizeRef = useRef(current);
  sizeRef.current = current;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinchRef.current = { dist: dist(e.touches), size: sizeRef.current };
    };
    const onMove = (e: TouchEvent) => {
      const p = pinchRef.current;
      if (!p || e.touches.length !== 2) return;
      e.preventDefault();
      const target = p.size * (dist(e.touches) / p.dist);
      const nearest = SIZES.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
      if (nearest !== sizeRef.current) changeSize(nearest);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchRef.current = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [changeSize]);

  const aisleSet = new Set(map.aisleAfter);

  function move(seat: Seat, dr: number, dc: number, edge?: 'start' | 'end') {
    const r = map.rows.indexOf(seat.row);
    let c = seat.number - 1;
    let nr = r;
    if (edge === 'start') c = -1;
    if (edge === 'end') c = map.seatsPerRow;
    for (let step = 0; step < map.seatsPerRow * map.rows.length; step++) {
      if (edge) c += edge === 'start' ? 1 : -1;
      else {
        nr += dr;
        c += dc;
      }
      if (nr < 0 || nr >= map.rows.length || c < 0 || c >= map.seatsPerRow) return;
      const next = matrix[nr]?.[c];
      if (next) {
        setFocusId(next.id);
        refs.current.get(next.id)?.focus();
        return;
      }
    }
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, seat: Seat) {
    const k = e.key;
    if (k === 'ArrowRight') move(seat, 0, 1);
    else if (k === 'ArrowLeft') move(seat, 0, -1);
    else if (k === 'ArrowDown') move(seat, 1, 0);
    else if (k === 'ArrowUp') move(seat, -1, 0);
    else if (k === 'Home') move(seat, 0, 0, 'start');
    else if (k === 'End') move(seat, 0, 0, 'end');
    else return;
    e.preventDefault();
  }

  const compact = current < 20;

  return (
    <div className={`seatmap sz-${current}${compact ? ' seatmap--compact' : ''}${highlight ? ' has-highlight' : ''}`}>
      <div className="seatmap__scroll" ref={scrollRef}>
        <div className="seatmap__inner">
          <div className="stage" aria-hidden="true">무대</div>
          <div className="seatmap__rows" role="group" aria-label="좌석 배치도. 화살표 키로 좌석을 옮겨 다니고 스페이스 키로 고릅니다.">
            {matrix.map((cells, ri) => (
              <div className="seatrow" key={map.rows[ri]}>
                <span className="seatrow__label" aria-hidden="true">{map.rows[ri]}</span>
                <span className="seatrow__seats">
                  {cells.map((seat, ci) => (
                    <span key={ci} className={`seatcell${aisleSet.has(ci + 1) && ci + 1 < map.seatsPerRow ? ' seatcell--aisle' : ''}`}>
                      {seat ? (
                        <SeatButton
                          seat={seat}
                          grade={gradeOf.get(seat.grade)}
                          gi={gradeIndex.get(seat.grade) ?? 0}
                          selected={selected.has(seat.id)}
                          dim={!!highlight && seat.grade !== highlight}
                          tabbable={seat.id === activeId}
                          tip={`${ri < 2 ? ' tip-below' : ''}${ci < 3 ? ' tip-l' : ci >= map.seatsPerRow - 3 ? ' tip-r' : ''}`}
                          onToggle={onToggle}
                          onKey={onKey}
                          onFocus={() => setFocusId(seat.id)}
                          setRef={(el) => {
                            if (el) refs.current.set(seat.id, el);
                            else refs.current.delete(seat.id);
                          }}
                        />
                      ) : (
                        <span className="seat seat--void" aria-hidden="true" />
                      )}
                    </span>
                  ))}
                </span>
                <span className="seatrow__label" aria-hidden="true">{map.rows[ri]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="seatmap__zoom" role="group" aria-label="배치도 크기">
        <button type="button" className="zoom-btn" onClick={zoomIn} disabled={idx >= SIZES.length - 1} aria-label="좌석 크게">
          <Icon name="plus" size={20} />
        </button>
        <button type="button" className="zoom-btn" onClick={zoomOut} disabled={idx <= 0} aria-label="좌석 작게">
          <Icon name="minus" size={20} />
        </button>
        <button type="button" className="zoom-btn" onClick={() => changeSize(null)} disabled={size === null} aria-label="처음 크기로">
          <Icon name="reset" size={20} />
        </button>
      </div>
    </div>
  );
}

function SeatButton({
  seat,
  grade,
  gi,
  selected,
  dim,
  tabbable,
  tip,
  onToggle,
  onKey,
  onFocus,
  setRef,
}: {
  seat: Seat;
  grade: Grade | undefined;
  gi: number;
  selected: boolean;
  dim: boolean;
  tabbable: boolean;
  tip: string;
  onToggle: (s: Seat) => void;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, s: Seat) => void;
  onFocus: () => void;
  setRef: (el: HTMLButtonElement | null) => void;
}) {
  const selectable = seat.status === 'AVAILABLE' || seat.status === 'MINE';
  const state = selected ? 'picked' : selectable ? 'open' : 'taken';
  const stateLabel = selected ? '선택함' : seat.status === 'HELD' ? '다른 관객이 고르는 중' : seat.status === 'SOLD' ? '판매됨' : '선택 가능';
  const gradeText = `${grade?.name ?? seat.grade} ${grade ? won(grade.price) : ''}`.trim();
  return (
    <button
      ref={setRef}
      type="button"
      className={`seat g${gi} seat--${state}${dim && !selected ? ' is-dim' : ''}${tip}`}
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={selectable ? selected : undefined}
      aria-disabled={selectable ? undefined : true}
      aria-label={`${seat.row}열 ${seat.number}번, ${gradeText}, ${stateLabel}`}
      data-tip={selectable ? `${seat.row}열 ${seat.number}번 · ${gradeText}` : `${seat.row}열 ${seat.number}번 · 선택할 수 없음`}
      onClick={() => selectable && onToggle(seat)}
      onKeyDown={(e) => onKey(e, seat)}
      onFocus={onFocus}
    >
      {selected && (
        <svg className="seat__check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
    </button>
  );
}

/** 범례: 등급 견본 + 가격 + 잔여, 그 뒤 '선택한 좌석'·'선택할 수 없음' */
export function SeatLegend({ grades, remaining }: { grades: Grade[]; remaining?: Map<string, number> }) {
  return (
    <ul className="legend" aria-label="좌석 범례">
      {grades.map((g, i) => (
        <li key={g.code}>
          <span className={`swatch g${i}`} aria-hidden="true" />
          {g.name} {won(g.price)}
          {remaining && <span className="legend__left"> · 잔여 {remaining.get(g.code) ?? 0}</span>}
        </li>
      ))}
      <li><span className="swatch swatch--picked" aria-hidden="true" />선택한 좌석</li>
      <li><span className="swatch swatch--taken" aria-hidden="true" />선택할 수 없음</li>
    </ul>
  );
}

/**
 * 상세 화면의 좌석 배치 미리보기(v4 GET /performances/:id/layout). 등급 색만, 누를 수 없음, 높이 200 안.
 * 좌석 상태를 받지 않으므로 판매·선점 여부는 보이지 않는다.
 */
export function SeatPreview({ layout }: { layout: SeatLayout }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(8);
  const aisles = layout.aisleAfter.filter((n) => n < layout.seatsPerRow).length;
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - 32;
      // 좌석 크기 s, 간격 s/4, 통로 s, 행 사이 s/4 → 폭·높이(무대 20 + 여백 포함 200) 안에 들어가는 정수 크기
      const byW = Math.floor(w / (layout.seatsPerRow * 1.25 + aisles));
      const byH = Math.floor((200 - 52) / (layout.rows.length * 1.25));
      setPx(Math.max(4, Math.min(14, byW, byH)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.seatsPerRow, layout.rows.length, aisles]);

  const gi = new Map(layout.grades.map((g, i) => [g.code, i]));
  const byKey = new Map(layout.seats.map((s) => [`${s.row}-${s.number}`, s]));
  const aisleSet = new Set(layout.aisleAfter);
  return (
    <div className={`preview pv-${px}`} ref={boxRef}>
      <div className="preview__stage" aria-hidden="true">무대</div>
      <div className="preview__rows" aria-hidden="true">
        {layout.rows.map((row) => (
          <div className="preview__row" key={row}>
            {Array.from({ length: layout.seatsPerRow }, (_, i) => {
              const s = byKey.get(`${row}-${i + 1}`);
              const aisle = aisleSet.has(i + 1) && i + 1 < layout.seatsPerRow ? ' is-aisle' : '';
              return <span key={i} className={`preview__seat${s ? ` g${gi.get(s.grade) ?? 0}` : ' is-void'}${aisle}`} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
