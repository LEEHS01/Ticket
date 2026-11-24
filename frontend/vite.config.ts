import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

// 모의 API는 `vite --mode mock`(npm run dev:mock)일 때만 개발 서버 미들웨어로 붙는다.
// vite.config.ts와 mock/ 폴더는 Node에서만 실행되므로 프로덕션 번들(dist)에 절대 들어가지 않는다.

/**
 * public 아래 이미지 폴더의 파일 목록을 빌드 시점에 가상 모듈로 만든다.
 * 화면은 이 목록에 있는 파일만 요청하고, 없으면 대체 표시를 그린다 → 없는 파일을 요청하는 404가 생기지 않는다.
 * 개발 서버에서는 파일을 넣거나 지우면 전체 새로고침으로 목록이 다시 만들어진다.
 *
 * - virtual:poster-images  public/posters/{공연 id}.webp + {id}-sm.webp 가 모두 있는 공연 id
 * - virtual:banner-images  public/banners/banner-{공연 id}.webp + banner-{id}-sm.webp 가 모두 있는 공연 id
 * - virtual:illust-images  public/illust/{이름}.webp 의 이름(illust-queue 등)
 */
function imageList(virtualId: string, folder: string, list: (files: Set<string>) => (string | number)[]): PluginOption {
  const RESOLVED = '\0' + virtualId;
  const dir = fileURLToPath(new URL(`./public/${folder}`, import.meta.url));
  const read = () => {
    try {
      return list(new Set(readdirSync(dir)));
    } catch {
      return [];
    }
  };
  return {
    name: `image-list:${folder}`,
    resolveId: (id) => (id === virtualId ? RESOLVED : null),
    load: (id) => (id === RESOLVED ? `export default ${JSON.stringify(read())};` : null),
    configureServer(server) {
      server.watcher.add(dir);
      const reload = (file: string) => {
        if (!file.replace(/\\/g, '/').includes(`/public/${folder}/`)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
    },
  };
}

const idsWithSmall = (re: RegExp, small: (id: string) => string) => (files: Set<string>) =>
  [...files]
    .map((f) => re.exec(f)?.[1])
    .filter((id): id is string => !!id && files.has(small(id)))
    .map(Number)
    .sort((a, b) => a - b);

/** nginx(security-headers.conf)의 CSP를 그대로 읽어 미리보기 서버에도 건다 → 프로덕션 빌드의 CSP 위반을 로컬에서 확인 */
function productionCsp(): string | undefined {
  try {
    const conf = readFileSync(fileURLToPath(new URL('./nginx/security-headers.conf', import.meta.url)), 'utf8');
    return /Content-Security-Policy "([^"]+)"/.exec(conf)?.[1];
  } catch {
    return undefined;
  }
}

export default defineConfig(async ({ command, mode }) => {
  const plugins: PluginOption[] = [
    react(),
    imageList('virtual:poster-images', 'posters', idsWithSmall(/^(\d+)\.webp$/, (id) => `${id}-sm.webp`)),
    imageList('virtual:banner-images', 'banners', idsWithSmall(/^banner-(\d+)\.webp$/, (id) => `banner-${id}-sm.webp`)),
    imageList('virtual:illust-images', 'illust', (files) =>
      [...files].map((f) => /^(illust-[a-z0-9-]+)\.webp$/.exec(f)?.[1]).filter((n): n is string => !!n).sort(),
    ),
  ];
  if (command === 'serve' && mode === 'mock') {
    const { mockApiPlugin } = await import('./mock/server');
    plugins.push(mockApiPlugin());
  }
  const csp = productionCsp();

  return {
    plugins,
    preview: {
      port: 4173,
      strictPort: true,
      headers: csp ? { 'Content-Security-Policy': csp } : undefined,
      proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:8080', changeOrigin: false } },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: mode === 'mock' ? undefined : {
        // 기본은 로컬 백엔드(8080). 통합 환경 등 다른 곳에 붙일 때: API_PROXY=http://localhost:8088 npm run dev
        '/api': { target: process.env.API_PROXY ?? 'http://localhost:8080', changeOrigin: false },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      // 폰트·이미지를 data: URI로 인라인하지 않는다 → CSP를 'self'만으로 유지
      assetsInlineLimit: 0,
      cssCodeSplit: true,
    },
  };
});
