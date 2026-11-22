# syntax=docker/dockerfile:1
# 화면(정적 파일) + /api 프록시 이미지 (멀티스테이지)
# Node 이미지에서 정적 파일을 빌드하고, nginx(alpine-slim) 이미지에는 결과만 넣는다
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

FROM nginx:1.30-alpine-slim
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/*
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
