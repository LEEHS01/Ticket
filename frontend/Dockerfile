# syntax=docker/dockerfile:1
# 화면(정적 파일) + /api 프록시 이미지 (멀티스테이지)
# Node 이미지에서 정적 파일을 빌드하고, nginx-unprivileged(alpine-slim) 이미지에는 결과만 넣는다
#   docker build --build-arg APP_VERSION=3.0 -t ticketing-frontend:3.0 .
FROM node:24-alpine AS build
WORKDIR /app
# 의존성 목록만 먼저 복사한다. 소스만 바뀌면 npm ci 레이어를 캐시에서 쓴다
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
COPY mock ./mock
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
RUN npm run build

# nginx-unprivileged: nginx를 uid 101(nginx)로 실행하도록 만든 이미지. 8080 포트를 쓴다
FROM nginxinc/nginx-unprivileged:1.30-alpine-slim
# 파일을 지우고 복사하는 동안만 root를 쓰고, 끝나면 101로 돌아간다
USER root
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/*
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
