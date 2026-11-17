# syntax=docker/dockerfile:1
#
# 티켓 예매 API — 멀티스테이지 빌드
#   build       : JDK + Maven Wrapper로 jar 빌드 → layered jar 추출
#   jre         : jlink로 앱에 필요한 모듈만 담은 맞춤 JRE (+ JDK 기본 클래스 CDS)
#   runtime-jre : (비교용) 공식 JRE alpine 이미지 기반     docker build --target runtime-jre .
#   runtime     : (기본) alpine + 맞춤 JRE + 앱 CDS 아카이브
#
# 실행:  docker run --read-only --tmpfs /tmp --env-file .env -p 8080:8080 ticketing-backend
# 마이그레이션(K8s Job): docker run --read-only --tmpfs /tmp --env-file .env.migrate ticketing-backend migrate

ARG JDK_IMAGE=eclipse-temurin:21-jdk-alpine
ARG JRE_IMAGE=eclipse-temurin:21-jre-alpine
ARG BASE_IMAGE=alpine:3.22

############################ 1) build ############################
FROM ${JDK_IMAGE} AS build
WORKDIR /workspace

# (1) 의존성 캐시: Maven 저장소(~/.m2)를 BuildKit 캐시 마운트에 둔다 → 소스가 바뀌어도 의존성을 다시 받지 않는다
#     예전에는 `mvnw dependency:go-offline` 으로 의존성 레이어를 따로 만들었는데, 이 단계 하나가 처음 빌드의
#     5분 이상을 차지했다(모든 플러그인까지 내려받고 확인한다). 캐시 마운트와 역할이 겹쳐서 뺐다.
COPY --chmod=0755 mvnw ./
COPY .mvn/ .mvn/
COPY pom.xml ./

# (2) 소스 복사 후 패키징 (테스트는 CI/`mvn verify`에서 별도로 돈다)
COPY src/ src/
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -q -DskipTests package \
 && java -Djarmode=tools -jar target/app.jar extract --layers --destination target/extracted

############################ 2) jlink 맞춤 JRE ############################
FROM ${JDK_IMAGE} AS jre
# 모듈 목록: jdeps --print-module-deps 결과 + TLS(EC 암호) + JNDI. README "이미지 최적화" 참고.
RUN jlink \
      --add-modules java.base,java.compiler,java.desktop,java.instrument,java.management,java.naming,java.net.http,java.prefs,java.rmi,java.scripting,java.security.jgss,java.sql,java.sql.rowset,jdk.crypto.ec,jdk.jfr,jdk.net,jdk.unsupported \
      --strip-debug --no-man-pages --no-header-files --compress=zip-6 \
      --generate-cds-archive \
      --output /opt/jre

############################ 3a) 비교용: 공식 JRE 이미지 ############################
FROM ${JRE_IMAGE} AS runtime-jre
RUN addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app -s /sbin/nologin app
WORKDIR /app
COPY --from=build /workspace/target/extracted/dependencies/ ./
COPY --from=build /workspace/target/extracted/spring-boot-loader/ ./
COPY --from=build /workspace/target/extracted/snapshot-dependencies/ ./
COPY --from=build /workspace/target/extracted/application/ ./
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-XX:+ExitOnOutOfMemoryError", "-XX:-UsePerfData", "-jar", "/app/app.jar"]

############################ 3b) 기본: alpine + 맞춤 JRE + CDS ############################
FROM ${BASE_IMAGE} AS runtime
# 보안 패치 반영 후 non-root 사용자 생성(UID 고정 → K8s runAsNonRoot/runAsUser와 맞추기 쉬움)
RUN apk upgrade --no-cache \
 && addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app -s /sbin/nologin app

ENV JAVA_HOME=/opt/jre \
    PATH=/opt/jre/bin:$PATH \
    LANG=C.UTF-8 \
    TZ=UTC
COPY --from=jre /opt/jre /opt/jre

# (3) layered jar: 잘 안 바뀌는 순서대로 복사 → 코드만 바뀌면 마지막 레이어(~100KB)만 새로 push
WORKDIR /app
COPY --from=build /workspace/target/extracted/dependencies/ ./
COPY --from=build /workspace/target/extracted/spring-boot-loader/ ./
COPY --from=build /workspace/target/extracted/snapshot-dependencies/ ./
COPY --from=build /workspace/target/extracted/application/ ./

# (4) 앱 CDS: 빌드 때 한 번 컨텍스트까지 띄워(접속 없음) 로드된 클래스를 아카이브로 저장 → 기동 시간 단축
#     값들은 학습 실행용 더미. Hikari·Lettuce는 지연 연결이라 실제로 접속하지 않는다.
RUN DB_HOST=cds-training DB_USER=cds DB_PASSWORD=cds REDIS_HOST=cds-training \
    java -XX:ArchiveClassesAtExit=/app/app.jsa -Dspring.context.exit=onRefresh -jar /app/app.jar > /dev/null

# 이미지 버전. 맨 뒤에 두어 버전만 바뀌면 앞 레이어를 모두 캐시에서 재사용한다(/api/version 으로 확인)
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

USER 10001:10001
EXPOSE 8080
# 힙은 고정값 대신 컨테이너 메모리 한도의 75%. OOM이면 즉시 종료해 K8s가 재시작하게 한다.
# -XX:-UsePerfData: /tmp/hsperfdata 파일을 만들지 않는다(읽기 전용 FS 친화).
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-XX:+ExitOnOutOfMemoryError", "-XX:-UsePerfData", "-XX:SharedArchiveFile=/app/app.jsa", "-jar", "/app/app.jar"]
