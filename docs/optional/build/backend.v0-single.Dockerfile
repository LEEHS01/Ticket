# 티켓 예매 API 이미지 (단일 스테이지)
#   docker build --build-arg APP_VERSION=2.0 -t ticketing-backend:2.0 .
#   docker run --env-file <파일> -p 8080:8080 ticketing-backend:2.0            API 서버
#   docker run --env-file <파일> ticketing-backend:2.0 migrate                 스키마 생성과 시드만 하고 종료

# JDK 21이 들어 있는 이미지. 이 이미지 안에서 빌드하고 그대로 실행한다
FROM eclipse-temurin:21-jdk

# 이후 명령의 기준 디렉터리
WORKDIR /app

# 빌드에 필요한 파일을 복사한다 (.dockerignore 에 적은 파일은 제외된다)
COPY . ./

# Maven Wrapper로 jar를 만든다. 결과는 target/app.jar
RUN ./mvnw -B -DskipTests package

# 이미지 버전. /api/version 응답에 나온다
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# 컨테이너가 여는 포트(문서용 표시)
EXPOSE 8080

# exec 형식. docker run 뒤에 붙인 인수(migrate)가 그대로 전달된다
ENTRYPOINT ["java", "-jar", "target/app.jar"]
