import { Link } from 'react-router';
import { usePageTitle } from '../shell';
import { Illust } from '../components/bits';

/** 없는 페이지(03 문서 4.15) */
export function NotFoundPage() {
  usePageTitle('페이지를 찾을 수 없어요');
  return (
    <div className="page page--404">
      <div className="empty empty--404">
        <Illust name="illust-404" icon="stage" size={200} />
        <h1 className="empty__title nf__title" tabIndex={-1}>페이지를 찾을 수 없어요</h1>
        <div className="empty__body"><p className="nf__body">주소가 바뀌었거나 내려간 페이지예요</p></div>
        <div className="empty__actions">
          <Link className="btn btn--primary btn--m" to="/">홈으로</Link>
          <Link className="btn btn--line btn--m" to="/search">공연 둘러보기</Link>
        </div>
      </div>
    </div>
  );
}
