# 방법 2: 방법 1 + 멀티스테이지. 빌드는 JDK 이미지에서 하고, 실행 이미지에는 JRE와 jar만 둔다
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY mvnw pom.xml ./
COPY .mvn/ .mvn/
RUN ./mvnw -B -q dependency:go-offline
COPY src/ src/
RUN ./mvnw -B -q -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/app.jar ./app.jar
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
