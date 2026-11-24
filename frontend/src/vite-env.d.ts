/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 이미지 빌드 때 넣는 버전(Dockerfile의 APP_VERSION). 개발 서버에서는 없다 */
  readonly VITE_APP_VERSION?: string;
}

/** vite.config.ts가 만든다: 포스터 이미지(두 크기 모두)가 있는 공연 id 목록 */
declare module 'virtual:poster-images' {
  const ids: number[];
  export default ids;
}

/** vite.config.ts가 만든다: 배너 이미지(banner-{id}.webp, -sm.webp 모두)가 있는 공연 id 목록 */
declare module 'virtual:banner-images' {
  const ids: number[];
  export default ids;
}

/** vite.config.ts가 만든다: public/illust/에 있는 안내 그림 이름(illust-queue 등) */
declare module 'virtual:illust-images' {
  const names: string[];
  export default names;
}
