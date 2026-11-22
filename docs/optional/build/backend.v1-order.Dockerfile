# 방법 1: 명령 순서. 의존성을 먼저 받아 별도 레이어로 두고, 소스는 그 뒤에 복사한다 (단일 스테이지)
FROM eclipse-temurin:21-jdk
WORKDIR /app
COPY mvnw pom.xml ./
COPY .mvn/ .mvn/
RUN ./mvnw -B -q dependency:go-offline
COPY src/ src/
RUN ./mvnw -B -q -DskipTests package
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "target/app.jar"]
