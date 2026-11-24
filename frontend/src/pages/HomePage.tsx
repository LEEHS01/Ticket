import { Link } from 'react-router';
import { useBanners, useNotices, useShowList } from '../data';
import { dotDate } from '../format';
import { usePageTitle } from '../shell';
import { HeroBanner } from '../components/HeroBanner';
import { Badge } from '../components/bits';
import { Icon } from '../components/Icon';
import { AllShowsSection, OpenSection, RankingSection, ThisWeekSection } from './sections';

/**
 * 메인(03 문서 4.1): 배너 → 공지 띠 → 티켓 오픈 예정 → 지금 많이 보는 공연 → 이번 주 → 모든 공연.
 * 배너·공지는 v4 API. 없거나 실패하면 배너는 공연 목록으로 대체하고 공지 띠는 숨긴다.
 */
export function HomePage() {
  usePageTitle('');
  const [shows, retry] = useShowList();
  const [banners] = useBanners();

  return (
    <div className="page page--home">
      <div className="wrap">
        <h1 className="sr-only" tabIndex={-1}>미리내 마당 공연 예매</h1>
        <HeroBanner banners={banners} shows={shows} />
        <NoticeStrip />
        <div className="home__sections">
          <OpenSection shows={shows} />
          <RankingSection genre={null} chips />
          <ThisWeekSection shows={shows} />
          <AllShowsSection shows={shows} onRetry={retry} genre={null} title="모든 공연" />
        </div>
      </div>
    </div>
  );
}

/** 공지 띠 1200×44: [공지] 제목 · 날짜 › (고정 공지 먼저, 실패하면 숨김) */
function NoticeStrip() {
  const [notices] = useNotices(null, 1, 1);
  if (notices.kind !== 'ready') return null;
  const n = notices.data.notices[0];
  if (!n) return null;
  return (
    <Link to={`/notices/${n.id}`} className="nstrip">
      <Badge kind="notice">공지</Badge>
      <span className="nstrip__title">{n.title}</span>
      <span className="nstrip__date">{dotDate(n.publishedAt)}</span>
      <Icon name="right" size={16} className="nstrip__go" />
    </Link>
  );
}
