import { Link } from 'react-router';
import { PRIVACY, TERMS } from '../content';
import { usePageTitle } from '../shell';

/** 이용약관 / 개인정보처리방침: 실습 서비스임을 밝히는 짧은 정적 문서 */
export function PolicyPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const title = kind === 'terms' ? '이용약관' : '개인정보처리방침';
  usePageTitle(title);
  const sections = kind === 'terms' ? TERMS : PRIVACY;
  return (
    <div className="page page--policy">
      <div className="wrap policy">
        <div className="pagehead">
          <h1 className="pagehead__title" tabIndex={-1}>{title}</h1>
          <p className="pagehead__sub">시행일 2026.11.24 · 클라우드 실습용 가상 서비스의 안내 문서예요</p>
        </div>
        <nav className="tabs policy__tabs" aria-label="정책 문서">
          <Link to="/policy/terms" className="tab" aria-current={kind === 'terms' ? 'page' : undefined}>이용약관</Link>
          <Link to="/policy/privacy" className="tab" aria-current={kind === 'privacy' ? 'page' : undefined}>개인정보처리방침</Link>
        </nav>
        <div className="policy__body">
          {sections.map((s, i) => (
            <section key={s.h} className="policy__sec">
              <h2 className="policy__h">{i + 1}. {s.h}</h2>
              {s.p.map((p) => <p key={p} className="policy__p">{p}</p>)}
            </section>
          ))}
          <p className="policy__p policy__license">
            이 서비스의 글꼴은 Pretendard(SIL Open Font License 1.1)를 씁니다. <a href="/licenses/pretendard-OFL.txt">라이선스 전문</a>
          </p>
        </div>
      </div>
    </div>
  );
}
