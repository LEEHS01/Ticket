import { useParams } from 'react-router';
import { useShowList } from '../data';
import { genreFromSlug, GENRE_LABEL } from '../format';
import { usePageTitle } from '../shell';
import { AllShowsSection, OpenSection, RankingSection } from './sections';
import { NotFoundPage } from './NotFoundPage';

/** 장르(03 문서 4.2): 제목 줄 → 장르 랭킹 → 오픈 예정(있을 때만) → 장르 전체 */
export function GenrePage() {
  const { genre: slug } = useParams();
  const genre = genreFromSlug(slug);
  const [shows, retry] = useShowList();
  usePageTitle(genre ? GENRE_LABEL[genre] : '없는 페이지');
  if (!genre) return <NotFoundPage />;

  const mine = shows.kind === 'ready' ? shows.data.filter((s) => s.genre === genre) : [];
  const onSale = mine.filter((s) => s.status === 'ON_SALE' || s.status === 'SOLD_OUT').length;
  const upcoming = mine.filter((s) => s.status === 'UPCOMING').length;
  const scoped = shows.kind === 'ready' ? { kind: 'ready' as const, data: mine } : shows;

  return (
    <div className="page page--genre">
      <div className="wrap">
        <div className="pagehead">
          <h1 className="pagehead__title" tabIndex={-1}>{GENRE_LABEL[genre]}</h1>
          <p className="pagehead__sub">
            {shows.kind === 'ready' ? `판매 중 ${onSale} · 오픈 예정 ${upcoming}` : ' '}
          </p>
        </div>
        <div className="genre__sections">
          <RankingSection key={genre} genre={genre} chips={false} eagerTop />
          <OpenSection shows={scoped} />
          <AllShowsSection key={`all-${genre}`} shows={shows} onRetry={retry} genre={genre} title={`${GENRE_LABEL[genre]} 전체`} />
        </div>
      </div>
    </div>
  );
}
