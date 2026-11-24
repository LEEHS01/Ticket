import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useRanking } from '../data';
import { clearRecent, pushRecent, readRecent, removeRecent } from '../recent';
import { Icon } from './Icon';

/** 검색 주소: 검색어는 40자까지(계약 3.4) */
export function searchHref(q: string) {
  return `/search?q=${encodeURIComponent(q.trim().slice(0, 40))}`;
}

/**
 * 머리글 검색창(PC 460×44). 포커스하면 아래로 펼침 상자: 최근 검색어(localStorage, 최대 8개) / 많이 찾는 공연(랭킹 1~5위).
 * 엔터 → /search?q=
 */
export function SearchBox({ variant = 'header' }: { variant?: 'header' | 'page' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const id = useId();
  const current = location.pathname === '/search' ? new URLSearchParams(location.search).get('q') ?? '' : '';
  const [q, setQ] = useState(current);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rank] = useRanking(null);

  useEffect(() => setQ(current), [current]);
  useEffect(() => setOpen(false), [location.pathname, location.search]);

  // 바깥을 누르거나 포커스가 나가면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = q.trim().slice(0, 40);
    if (!v) {
      inputRef.current?.focus();
      return;
    }
    pushRecent(v);
    setOpen(false);
    inputRef.current?.blur();
    navigate(searchHref(v));
  }

  const popular = rank.kind === 'ready' ? rank.data.items.slice(0, 5) : [];

  return (
    <div
      className={`search search--${variant}${open ? ' is-open' : ''}`}
      ref={boxRef}
      onBlur={(e) => {
        if (!boxRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          inputRef.current?.focus();
        }
      }}
    >
      <form role="search" onSubmit={onSubmit} className="search__form">
        <label htmlFor={`${id}-q`} className="sr-only">공연, 공연장 검색</label>
        <Icon name="search" size={20} className="search__icon" />
        <input
          ref={inputRef}
          id={`${id}-q`}
          className="search__input"
          type="search"
          name="q"
          maxLength={40}
          autoComplete="off"
          placeholder="공연, 공연장 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            setRecent(readRecent());
            setOpen(true);
          }}
          aria-expanded={open}
          aria-controls={`${id}-pop`}
        />
        <button type="submit" className="sr-only">검색</button>
      </form>
      {open && (
        <div className="search__pop" id={`${id}-pop`}>
          <div className="search__group">
            <div className="search__group-head">
              <p className="search__group-title">최근 검색어</p>
              {recent.length > 0 && (
                <button type="button" className="text-btn text-btn--s" onClick={() => { clearRecent(); setRecent([]); }}>
                  모두 지우기
                </button>
              )}
            </div>
            {recent.length === 0 ? (
              <p className="search__none">최근 검색어가 없어요</p>
            ) : (
              <ul className="search__recent">
                {recent.map((r) => (
                  <li key={r}>
                    <Link to={searchHref(r)} className="search__recent-link" onClick={() => pushRecent(r)}>{r}</Link>
                    <button
                      type="button"
                      className="search__remove"
                      aria-label={`최근 검색어 ${r} 지우기`}
                      onClick={() => {
                        removeRecent(r);
                        setRecent(readRecent());
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {popular.length > 0 && (
            <div className="search__group">
              <p className="search__group-title">많이 찾는 공연</p>
              <ol className="search__popular">
                {popular.map((it) => (
                  <li key={it.show.id}>
                    <Link to={`/shows/${it.show.id}`}>
                      <span className="search__no">{it.rank}</span>
                      <span className="search__ptitle">{it.show.title}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
