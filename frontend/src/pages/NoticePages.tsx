import { Link, useParams, useSearchParams } from 'react-router';
import { api, type Notice as NoticeData, type NoticeCategory, type NoticeSummary } from '../api';
import { useNotices, useResource, useShowList } from '../data';
import { dotDate, periodLabel, shortDateTime } from '../format';
import { usePageTitle } from '../shell';
import { Badge, EmptyState, LoadError } from '../components/bits';
import { Icon } from '../components/Icon';
import { PosterArt } from '../components/PosterArt';

const PAGE_SIZE = 15;
const CATEGORY_LABEL: Record<NoticeCategory, string> = { TICKET_OPEN: '티켓 오픈', SERVICE: '안내' };
const CATS: { key: NoticeCategory | null; label: string; slug: string | null }[] = [
  { key: null, label: '전체', slug: null },
  { key: 'TICKET_OPEN', label: '티켓 오픈', slug: 'ticket-open' },
  { key: 'SERVICE', label: '서비스 안내', slug: 'service' },
];

function CategoryBadge({ n }: { n: NoticeSummary }) {
  if (n.pinned) return <Badge kind="dday">중요</Badge>;
  return n.category === 'TICKET_OPEN' ? <Badge kind="upcoming">{CATEGORY_LABEL[n.category]}</Badge> : <Badge kind="notice">{CATEGORY_LABEL[n.category]}</Badge>;
}

/** 공지사항 목록(03 문서 4.13). PC 표, 모바일 목록. 고정 공지는 맨 위 [중요]. 한 쪽 15개 */
export function NoticesPage() {
  usePageTitle('공지사항');
  const [params, setParams] = useSearchParams();
  const cat = CATS.find((c) => c.slug === params.get('category')) ?? CATS[0]!;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [res, retry] = useNotices(cat.key, page, PAGE_SIZE);

  const go = (next: { category?: string | null; page?: number }) => {
    const p = new URLSearchParams(params);
    if (next.category !== undefined) {
      if (next.category) p.set('category', next.category);
      else p.delete('category');
      p.delete('page');
    }
    if (next.page) {
      if (next.page > 1) p.set('page', String(next.page));
      else p.delete('page');
    }
    setParams(p);
    window.scrollTo(0, 0);
  };

  return (
    <div className="page page--notices">
      <div className="wrap">
        <div className="pagehead">
          <h1 className="pagehead__title" tabIndex={-1}>공지사항</h1>
          <p className="pagehead__sub">티켓 오픈 일정과 서비스 소식을 알려 드려요</p>
        </div>
        <div className="tabs notices__tabs" role="group" aria-label="공지 구분">
          {CATS.map((c) => (
            <button key={c.label} type="button" className={`tab${cat.key === c.key ? ' is-active' : ''}`} aria-pressed={cat.key === c.key} onClick={() => go({ category: c.slug })}>
              {c.label}
            </button>
          ))}
        </div>

        {res.kind === 'loading' && (
          <div className="ntable-skel" aria-busy="true">
            <span className="sr-only" role="status">불러오는 중</span>
            {Array.from({ length: 5 }, (_, i) => <span key={i} className="skel ntable-skel__row" aria-hidden="true" />)}
          </div>
        )}
        {res.kind === 'error' && (
          <div className="notices__err">
            {res.error.isMissingEndpoint ? (
              <EmptyState title="공지사항을 준비하고 있어요" icon="megaphone">
                <p>지금은 공지사항을 볼 수 없어요. 잠시 후 다시 들러 주세요.</p>
              </EmptyState>
            ) : (
              <LoadError error={res.error} onRetry={retry} title="공지사항을 불러오지 못했어요" />
            )}
          </div>
        )}
        {res.kind === 'ready' &&
          (res.data.notices.length === 0 ? (
            <EmptyState title="등록된 공지가 없어요" icon="megaphone" />
          ) : (
            <>
              <table className="ntable">
                <caption className="sr-only">공지사항 목록</caption>
                <thead>
                  <tr>
                    <th scope="col" className="ntable__cat">구분</th>
                    <th scope="col">제목</th>
                    <th scope="col" className="ntable__open">오픈 일시</th>
                    <th scope="col" className="ntable__date">등록일</th>
                  </tr>
                </thead>
                <tbody>
                  {res.data.notices.map((n) => (
                    <tr key={n.id} className={n.pinned ? 'is-pinned' : ''}>
                      <td className="ntable__cat"><CategoryBadge n={n} /></td>
                      <td className="ntable__title"><Link to={`/notices/${n.id}`}>{n.title}</Link></td>
                      <td className="ntable__open">{n.ticketOpenAt ? shortDateTime(n.ticketOpenAt) : '–'}</td>
                      <td className="ntable__date">{dotDate(n.publishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="nlist">
                {res.data.notices.map((n) => (
                  <li key={n.id}>
                    <Link to={`/notices/${n.id}`} className="nlist__item">
                      <CategoryBadge n={n} />
                      <span className="nlist__title">{n.title}</span>
                      <span className="nlist__date">{dotDate(n.publishedAt)}{n.ticketOpenAt ? ` · ${shortDateTime(n.ticketOpenAt)} 오픈` : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {res.data.totalPages > 1 && <Pager page={res.data.page} total={res.data.totalPages} onGo={(p) => go({ page: p })} />}
            </>
          ))}
      </div>
    </div>
  );
}

function Pager({ page, total, onGo }: { page: number; total: number; onGo: (p: number) => void }) {
  return (
    <nav className="pager" aria-label="쪽 번호">
      <button type="button" className="pager__btn" onClick={() => onGo(page - 1)} disabled={page <= 1} aria-label="이전 쪽">
        <Icon name="left" size={18} />
      </button>
      {Array.from({ length: total }, (_, i) => i + 1).map((p) => (
        <button key={p} type="button" className="pager__btn" aria-current={p === page ? 'page' : undefined} onClick={() => onGo(p)}>
          {p}
        </button>
      ))}
      <button type="button" className="pager__btn" onClick={() => onGo(page + 1)} disabled={page >= total} aria-label="다음 쪽">
        <Icon name="right" size={18} />
      </button>
    </nav>
  );
}

/** 공지 상세: 경로 → 머리표+제목 → 등록일 → 본문 → 관련 공연 → 이전 글/다음 글 → 목록 */
export function NoticeDetailPage() {
  const { id } = useParams();
  const noticeId = Number(id);
  const valid = Number.isInteger(noticeId) && noticeId > 0;
  const [res, retry] = useResource<NoticeData>(valid ? `notice:${noticeId}` : null, (signal) => api.notice(noticeId, signal));
  // 이전 글·다음 글은 목록(최대 50건)에서 찾는다
  const [around] = useNotices(null, 1, 50);
  const [shows] = useShowList();
  usePageTitle(res.kind === 'ready' ? res.data.title : '공지사항');

  if (!valid || (res.kind === 'error' && (res.error.code === 'NOTICE_NOT_FOUND' || res.error.isMissingEndpoint))) {
    return (
      <div className="page">
        <EmptyState
          title="공지를 찾을 수 없어요"
          headingLevel="h1"
          icon="megaphone"
          actions={<Link to="/notices" className="btn btn--line btn--m">공지사항 목록</Link>}
        >
          <p>주소가 잘못됐거나 내려간 공지예요.</p>
        </EmptyState>
      </div>
    );
  }

  const list = around.kind === 'ready' ? around.data.notices : [];
  const idx = list.findIndex((n) => n.id === noticeId);
  const newer = idx > 0 ? list[idx - 1] : undefined;
  const older = idx >= 0 ? list[idx + 1] : undefined;
  const n = res.kind === 'ready' ? res.data : null;
  const show = n?.showId && shows.kind === 'ready' ? shows.data.find((s) => s.id === n.showId) : undefined;

  return (
    <div className="page page--notice">
      <div className="wrap ndetail">
        <nav className="crumbs" aria-label="현재 위치">
          <Link to="/">홈</Link>
          <Icon name="right" size={12} />
          <Link to="/notices">공지사항</Link>
        </nav>
        {res.kind === 'loading' && (
          <div aria-busy="true">
            <span className="sr-only" role="status">불러오는 중</span>
            <span className="skel dskel__title" aria-hidden="true" />
            <span className="skel skel--block" aria-hidden="true" />
          </div>
        )}
        {res.kind === 'error' && <LoadError error={res.error} onRetry={retry} title="공지를 불러오지 못했어요" />}
        {n && (
          <article>
            <header className="ndetail__head">
              <CategoryBadge n={n} />
              <h1 className="ndetail__title" tabIndex={-1}>{n.title}</h1>
              <p className="ndetail__date">
                등록일 {dotDate(n.publishedAt)}
                {n.ticketOpenAt && <> · 티켓 오픈 {shortDateTime(n.ticketOpenAt)}</>}
              </p>
            </header>
            <div className="ndetail__body">{n.body}</div>
            {show && (
              <div className="ndetail__show">
                <span className="thumb thumb--72" aria-hidden="true">
                  <PosterArt showId={show.id} poster={show.poster} title={show.title} genre={show.genre} />
                </span>
                <div className="ndetail__show-body">
                  <p className="lrow__title">{show.title}</p>
                  <p className="lrow__meta">{show.venue} · {periodLabel(show.firstStartsAt, show.lastStartsAt)}</p>
                </div>
                <Link to={`/shows/${show.id}`} className="btn btn--line btn--s">공연 보러 가기</Link>
              </div>
            )}
          </article>
        )}
        {(newer || older) && (
          <ul className="ndetail__nav">
            {newer && (
              <li>
                <span className="ndetail__navlabel">다음 글</span>
                <Link to={`/notices/${newer.id}`}>{newer.title}</Link>
              </li>
            )}
            {older && (
              <li>
                <span className="ndetail__navlabel">이전 글</span>
                <Link to={`/notices/${older.id}`}>{older.title}</Link>
              </li>
            )}
          </ul>
        )}
        <div className="ndetail__back">
          <Link to="/notices" className="btn btn--line btn--m">목록</Link>
        </div>
      </div>
    </div>
  );
}
