# syntax=docker/dockerfile:1.7
#
# 1단계: Node로 정적 파일 빌드 → 2단계: nginx-unprivileged(alpine-slim)로 서빙
# 최종 이미지에는 Node·npm·소스·node_modules가 없다. 실행 사용자는 uid 101(nginx), 포트 8080.
#
# 기반 이미지는 태그와 함께 digest로 고정한다(재현 가능한 빌드, 공급망 변조 방지).
# 갱신할 때: docker pull <이미지:태그> 후 docker image inspect --format '{{index .RepoDigests 0}}'

############################
# 1) build
############################
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
ENV npm_config_fund=false \
    npm_config_audit=false \
    npm_config_update_notifier=false

# 의존성 목록만 먼저 복사 → 소스만 바뀌면 npm ci 레이어를 캐시에서 재사용
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
# mock/은 타입 검사 대상이라 복사하지만, `vite build`는 이를 번들에 넣지 않는다(mock 모드에서만 import).
COPY mock ./mock
# 화면 아래에 표시할 버전. 빌드할 때 --build-arg APP_VERSION=1.1 처럼 넘긴다
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
RUN npm run build \
 && ! grep -rqE "__mock|ratelimit@test\.kr|offline@test\.kr" dist   # 모의 코드가 번들에 섞이면 빌드 실패

############################
# 2) runtime
############################
FROM nginxinc/nginx-unprivileged:1.30-alpine-slim@sha256:5d8bb9437d74a600ec5dbf90c035451c724dc33eac8d3a71078f6f8612c345f6

LABEL org.opencontainers.image.title="ticketing-frontend" \
      org.opencontainers.image.description="미리내 마당 공연 예매 웹 UI (정적 파일 + nginx)"

# 기본 설정·예제 페이지 제거(루트 권한이 필요한 작업만 여기서 하고 바로 101로 돌아간다)
USER root
RUN rm -rf /etc/nginx/conf.d /usr/share/nginx/html/* \
 && mkdir -p /etc/nginx/snippets

# 설정과 정적 파일은 root 소유·읽기 전용 → nginx 프로세스(101)가 바꿀 수 없다
COPY --chmod=0644 nginx/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0644 nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

USER 101
EXPOSE 8080

# nginx는 SIGQUIT에서 진행 중 요청을 마치고 종료한다(롤링 업데이트 무중단)
STOPSIGNAL SIGQUIT

# docker/compose용. 쿠버네티스는 이 값을 쓰지 않으므로 매니페스트에 httpGet /healthz 프로브를 둔다.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

# 기본 /docker-entrypoint.sh는 설정 파일을 고쳐 쓰려 하므로(IPv6, envsubst) 건너뛰고 nginx를 바로 실행
ENTRYPOINT ["nginx", "-g", "daemon off;"]
