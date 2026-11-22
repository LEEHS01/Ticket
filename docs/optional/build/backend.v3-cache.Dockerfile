# syntax=docker/dockerfile:1
# 방법 3: 방법 2 + 캐시 마운트 + layered jar.
#   의존성은 레이어가 아니라 BuildKit 캐시 마운트(~/.m2)에 둔다. dependency:go-offline 단계가 없어진다
#   jar를 의존성 · 로더 · 애플리케이션으로 풀어 따로 복사한다. 소스만 바뀌면 마지막 레이어만 바뀐다
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY mvnw pom.xml ./
COPY .mvn/ .mvn/
COPY src/ src/
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -q -DskipTests package \
 && java -Djarmode=tools -jar target/app.jar extract --layers --destination target/extracted

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/extracted/dependencies/ ./
COPY --from=build /app/target/extracted/spring-boot-loader/ ./
COPY --from=build /app/target/extracted/snapshot-dependencies/ ./
COPY --from=build /app/target/extracted/application/ ./
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
