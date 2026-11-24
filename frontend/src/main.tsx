import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

// 글꼴은 npm 패키지로 번들에 포함한다(외부 CDN 없음). Pretendard, SIL Open Font License 1.1(public/licenses/pretendard-OFL.txt).
// 가변 글꼴 + 다이내믹 서브셋: 화면에 쓰인 글자 범위의 woff2 조각만 내려받는다.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import './pages.css';

import { App } from './App';
import { AuthProvider } from './auth';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
