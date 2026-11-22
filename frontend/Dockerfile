# 화면(정적 파일) + /api 프록시 이미지 (단일 스테이지)
# nginx 이미지에는 Node.js가 없으므로, 먼저 호스트에서 정적 파일을 빌드한 뒤 이미지를 만든다
#   VITE_APP_VERSION=2.0 npm run build         결과: dist/
#   docker build -t ticketing-frontend:2.0 .

# nginx 공식 이미지
FROM nginx:1.30

# 기본 예제 페이지와 기본 서버 설정을 지운다
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/*

# nginx 설정: 정적 파일 서빙, /api 는 backend:8080 으로 전달
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf

# 호스트에서 빌드한 정적 파일
COPY dist/ /usr/share/nginx/html/

# 컨테이너가 여는 포트(문서용 표시)
EXPOSE 8080

# 기본 entrypoint 스크립트를 거치지 않고 nginx를 포그라운드로 실행한다
ENTRYPOINT ["nginx", "-g", "daemon off;"]
