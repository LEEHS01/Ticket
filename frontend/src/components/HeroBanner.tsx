import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import bannerIds from 'virtual:banner-images';
import type { Banner, ShowSummary } from '../api';
import type { Load } from '../data';
import { useIsMobile, useReducedMotion } from '../data';
import { GENRE_LABEL, periodLabel, shortPeriod } from '../format';
import { PosterArt } from './PosterArt';
import { Icon } from './Icon';

const HAS_BANNER = new Set(bannerIds);
const AUTOPLAY_MS = 5000;

type Slide = { key: string; showId: number; eyebrow: string; title: string; subtitle: string; show: ShowSummary | null; mobileImageUrl: string | null };

/**
 * 배너가 없을 때(v4 엔드포인트 없음·실패·빈 목록)의 대체: 판매 중 인기 공연과 가장 가까운 오픈 예정 공연으로 최대 6장.
 * 문구는 공연 정보(장르·제목·한 줄 소개 또는 공연장)로 만든다.
 */
function fallbackSlides(shows: ShowSummary[]): Slide[] {
  const onSale = shows.filter((s) => s.status === 'ON_SALE').sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const upcoming = shows.filter((s) => s.status === 'UPCOMING').sort((a, b) => a.saleOpensAt.localeCompare(b.saleOpensAt));
  const picked = [...onSale.slice(0, 5), ...upcoming.slice(0, 1)].slice(0, 6);
  return picked.map((s) => ({
    key: `s${s.id}`,
    showId: s.id,
    eyebrow: GENRE_LABEL[s.genre],
    title: s.title,
    subtitle: s.tagline || s.venue,
    show: s,
    mobileImageUrl: null,
  }));
}

function fromBanners(banners: Banner[], shows: ShowSummary[]): Slide[] {
  const byId = new Map(shows.map((s) => [s.id, s]));
  return banners.slice(0, 6).map((b) => ({
    key: `b${b.id}`,
    showId: b.showId,
    eyebrow: b.eyebrow,
    title: b.title,
    subtitle: b.subtitle,
    show: byId.get(b.showId) ?? null,
    // 외부 주소는 쓰지 않는다(같은 출처의 /banners/ 경로만)
    mobileImageUrl: b.mobileImageUrl && b.mobileImageUrl.startsWith('/banners/') ? b.mobileImageUrl : null,
  }));
}

/** PC 배너 그림이 없을 때: 포스터 색(hue)으로 만든 어두운 2색 그라데이션(SVG 속성으로 칠해 CSP와 충돌하지 않는다) */
function HueField({ hue }: { hue: number }) {
  const id = `hf${hue}`;
  return (
    <svg className="hero__field" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 42% 14%)`} />
          <stop offset="1" stopColor={`hsl(${(hue + 36) % 360} 48% 30%)`} />
        </linearGradient>
      </defs>
      <rect width="1200" height="400" fill={`url(#${id})`} />
    </svg>
  );
}

function SlideView({ slide, index, total, active, eager, mobile }: { slide: Slide; index: number; total: number; active: boolean; eager: boolean; mobile: boolean }) {
  const s = slide.show;
  const banner = HAS_BANNER.has(slide.showId);
  return (
    <div
      className={`hero__slide${banner ? ' has-banner' : ''}${slide.mobileImageUrl ? ' has-mimg' : ''}`}
      role="group"
      aria-roledescription="슬라이드"
      aria-label={`${index + 1} / ${total}`}
      aria-hidden={!active}
      inert={!active}
    >
      <Link to={`/shows/${slide.showId}`} className="hero__link">
        {/* PC 바탕: 배너 그림(큰 것 1440×480, 작은 것 1200×400. 받은 원본 1584px 안에서 3:1로 잘라 키우지 않음) 또는 포스터 색 그라데이션 */}
        <span className="hero__bg" aria-hidden="true">
          {/* 모바일은 포스터 카드를 쓰므로(03 문서 4.1) 배너 그림을 받지 않는다 */}
          {mobile ? null : banner ? (
            <img
              src={`/banners/banner-${slide.showId}-sm.webp`}
              srcSet={`/banners/banner-${slide.showId}-sm.webp 1200w, /banners/banner-${slide.showId}.webp 1440w`}
              sizes="(min-width: 1280px) 1200px, 100vw"
              width={1200}
              height={400}
              alt=""
              loading={eager ? 'eager' : 'lazy'}
              fetchPriority={index === 0 ? 'high' : undefined}
              decoding="async"
            />
          ) : (
            <HueField hue={s?.poster.hue ?? 190} />
          )}
        </span>
        {/* 포스터: 모바일은 카드 전체를 채우고(위쪽 기준), PC 대체 표시에서는 오른쪽 320 높이 */}
        {s && (
          <span className="hero__poster" aria-hidden="true">
            <PosterArt showId={s.id} poster={s.poster} title={s.title} genre={s.genre} size="lg" eager={eager} priority={index === 0} />
          </span>
        )}
        {slide.mobileImageUrl && <img className="hero__mimg" src={slide.mobileImageUrl} alt="" loading="lazy" decoding="async" />}
        <span className="hero__shade" aria-hidden="true" />
        <span className="hero__text">
          <span className="hero__eyebrow">{slide.eyebrow}</span>
          <span className="hero__title">{slide.title}</span>
          {slide.subtitle && <span className="hero__sub">{slide.subtitle}</span>}
          {s && (
            <span className="hero__meta">
              <span className="hero__meta-pc">{periodLabel(s.firstStartsAt, s.lastStartsAt)} · {s.venue}</span>
              <span className="hero__meta-m">{shortPeriod(s.firstStartsAt, s.lastStartsAt)} · {s.venue}</span>
            </span>
          )}
          <span className="hero__cta">
            자세히 보기
            <Icon name="right" size={16} />
          </span>
        </span>
      </Link>
    </div>
  );
}

/**
 * 메인 배너 슬라이드(03 문서 4.1, 3.6 배너 넘김 표시).
 * PC 1200×400(모서리 12), 모바일 335×400 포스터 카드. 5초 자동 넘김.
 * 마우스 올림·포커스·화면 밖·탭 숨김이면 멈추고, prefers-reduced-motion이면 자동 넘김을 끈다. 일시정지 단추 필수.
 */
export function HeroBanner({ banners, shows }: { banners: Load<Banner[]>; shows: Load<ShowSummary[]> }) {
  const showList = shows.kind === 'ready' ? shows.data : [];
  const slides =
    banners.kind === 'ready' && banners.data.length > 0
      ? fromBanners(banners.data, showList)
      : banners.kind === 'loading' || shows.kind !== 'ready'
        ? null
        : fallbackSlides(showList);

  const [index, setIndex] = useState(0);
  // auto: 기본(움직임 줄이기 설정이면 멈춤), paused/playing: 사용자가 단추로 정함
  const [play, setPlay] = useState<'auto' | 'paused' | 'playing'>('auto');
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [visible, setVisible] = useState(true);
  const reduce = useReducedMotion();
  const mobile = useIsMobile();
  const rootRef = useRef<HTMLElement>(null);
  const total = slides?.length ?? 0;
  const at = total ? index % total : 0;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting && !document.hidden), { threshold: 0.3 });
    io.observe(el);
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [total]);

  const playing = play === 'playing' || (play === 'auto' && !reduce);
  const running = total > 1 && playing && !hover && !focusIn && visible;
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % total), AUTOPLAY_MS);
    return () => window.clearTimeout(t);
  }, [running, at, total]);

  // 손가락으로 밀기
  const touch = useRef<{ x: number; y: number } | null>(null);

  if (!slides) {
    return <div className="hero hero--skel" aria-hidden="true" />;
  }
  if (total === 0) return null;

  const go = (d: 1 | -1) => setIndex((i) => (i + d + total) % total);

  return (
    <section
      ref={rootRef}
      className="hero"
      aria-roledescription="캐러셀"
      aria-label="추천 공연"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocusIn(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false);
      }}
      // 배너는 transform으로만 넘긴다. overflow: clip을 모르는 브라우저에서 안쪽 scrollIntoView·찾기 때문에
      // 상자가 스크롤되면 모든 장이 밀려 보이므로 바로 되돌린다(clip을 아는 브라우저에서는 스크롤 자체가 생기지 않음)
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollLeft !== 0 || el.scrollTop !== 0) {
          el.scrollLeft = 0;
          el.scrollTop = 0;
        }
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const s = touch.current;
        const t = e.changedTouches[0];
        touch.current = null;
        if (!s || !t) return;
        const dx = t.clientX - s.x;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(t.clientY - s.y)) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className={`hero__track at-${at}`} aria-live={running ? 'off' : 'polite'}>
        {slides.map((sl, i) => (
          <SlideView key={sl.key} slide={sl} index={i} total={total} active={i === at} eager={i === 0 || i === at || i === (at + 1) % total} mobile={mobile} />
        ))}
      </div>
      {total > 1 && (
        <>
          <button type="button" className="hero__arrow hero__arrow--prev" onClick={() => go(-1)} aria-label="이전 배너">
            <Icon name="left" size={20} />
          </button>
          <button type="button" className="hero__arrow hero__arrow--next" onClick={() => go(1)} aria-label="다음 배너">
            <Icon name="right" size={20} />
          </button>
        </>
      )}
      <div className="hero__pager">
        {total > 1 && (
          <button
            type="button"
            className="hero__pause"
            onClick={() => setPlay(playing ? 'paused' : 'playing')}
            aria-label={playing ? '자동 넘김 멈춤' : '자동 넘김 시작'}
          >
            <Icon name={playing ? 'pause' : 'play'} size={14} />
          </button>
        )}
        <span className="hero__count">
          <span className="sr-only">전체 {total}개 중 </span>
          {at + 1} <span aria-hidden="true">/</span> {total}
        </span>
      </div>
    </section>
  );
}
