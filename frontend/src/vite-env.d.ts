/// <reference types="vite/client" />

/** vite.config.ts의 posterImages 플러그인이 만든다: 포스터 이미지(두 크기 모두)가 있는 공연 id 목록 */
declare module 'virtual:poster-images' {
  const ids: number[];
  export default ids;
}
