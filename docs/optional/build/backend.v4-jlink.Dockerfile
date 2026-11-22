# syntax=docker/dockerfile:1
# 방법 4: 방법 3 + 기반 이미지 변경. alpine 위에 jlink로 만든 JRE(앱이 쓰는 모듈만)를 올리고, CDS 아카이브로 기동 시간을 줄인다
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
RUN apk upgrade --no-cache
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

EXPOSE 8080
# 힙은 컨테이너 메모리 한도의 75%. OOM이면 바로 종료해 다시 시작되게 한다
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-XX:+ExitOnOutOfMemoryError", "-XX:SharedArchiveFile=/app/app.jsa", "-jar", "/app/app.jar"]
