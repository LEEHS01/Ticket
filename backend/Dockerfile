# syntax=docker/dockerfile:1
# 티켓 예매 API 이미지 (멀티스테이지)
#   build : JDK + Maven Wrapper로 jar를 만들고 레이어별로 푼다
#   jre   : jlink로 앱이 쓰는 모듈만 담은 JRE를 만든다
#   실행  : alpine + 위 JRE + 앱 + CDS 아카이브
#
#   docker build --build-arg APP_VERSION=3.0 -t ticketing-backend:3.0 .
#   docker run --env-file <파일> -p 8080:8080 ticketing-backend:3.0            API 서버
#   docker run --env-file <파일> ticketing-backend:3.0 migrate                 스키마 생성과 시드만 하고 종료
ARG JDK_IMAGE=eclipse-temurin:21-jdk-alpine
ARG BASE_IMAGE=alpine:3.22

# 1) 빌드: 의존성은 캐시 마운트(~/.m2)에 두고, jar를 레이어별로 푼다
FROM ${JDK_IMAGE} AS build
WORKDIR /workspace
COPY --chmod=0755 mvnw ./
COPY .mvn/ .mvn/
COPY pom.xml ./
COPY src/ src/
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -q -DskipTests package \
 && java -Djarmode=tools -jar target/app.jar extract --layers --destination target/extracted

# 2) JRE: jlink로 필요한 모듈만 담는다. 모듈 목록은 jdeps --print-module-deps 결과에 TLS와 JNDI 모듈을 더한 것이다
FROM ${JDK_IMAGE} AS jre
RUN jlink \
      --add-modules java.base,java.compiler,java.desktop,java.instrument,java.management,java.naming,java.net.http,java.prefs,java.rmi,java.scripting,java.security.jgss,java.sql,java.sql.rowset,jdk.crypto.ec,jdk.jfr,jdk.net,jdk.unsupported \
      --strip-debug --no-man-pages --no-header-files --compress=zip-6 \
      --generate-cds-archive \
      --output /opt/jre

# 3) 실행 이미지
FROM ${BASE_IMAGE}
# 실행 전용 사용자를 만든다. UID를 10001로 고정해 쿠버네티스의 runAsUser와 맞춘다
RUN apk upgrade --no-cache  && addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app -s /sbin/nologin app
ENV JAVA_HOME=/opt/jre \
    PATH=/opt/jre/bin:$PATH \
    LANG=C.UTF-8 \
    TZ=UTC
COPY --from=jre /opt/jre /opt/jre

# 잘 바뀌지 않는 것부터 복사한다. 소스만 바뀌면 마지막 application 레이어만 새로 만들어진다
WORKDIR /app
COPY --from=build /workspace/target/extracted/dependencies/ ./
COPY --from=build /workspace/target/extracted/spring-boot-loader/ ./
COPY --from=build /workspace/target/extracted/snapshot-dependencies/ ./
COPY --from=build /workspace/target/extracted/application/ ./

# 앱 CDS: 빌드할 때 한 번 띄워 로드된 클래스를 아카이브로 저장한다. 값은 학습 실행용이며 DB · Redis에 실제로 접속하지 않는다
RUN DB_HOST=cds-training DB_USER=cds DB_PASSWORD=cds REDIS_HOST=cds-training \
    java -XX:ArchiveClassesAtExit=/app/app.jsa -Dspring.context.exit=onRefresh -jar /app/app.jar > /dev/null

# 버전은 맨 뒤에 둔다. 버전만 바뀌면 앞 레이어를 모두 캐시에서 쓴다
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# 여기부터 root가 아닌 사용자로 실행한다
USER 10001:10001
EXPOSE 8080
# 힙은 컨테이너 메모리 한도의 75%. OOM이면 바로 종료해 다시 시작되게 한다
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-XX:+ExitOnOutOfMemoryError", "-XX:SharedArchiveFile=/app/app.jsa", "-jar", "/app/app.jar"]
