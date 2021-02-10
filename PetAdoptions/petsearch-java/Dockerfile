FROM gradle:6.8-jdk15 as build

WORKDIR /app
COPY ./build.gradle ./build.gradle
COPY ./src ./src
COPY ./settings.gradle ./settings.gradle

ENV GRADLE_OPTS "-Dorg.gradle.daemon=false"
RUN gradle build -DexcludeTags='integration'
RUN wget https://github.com/aws-observability/aws-otel-java-instrumentation/releases/download/v0.12.1-aws.1/aws-opentelemetry-agent.jar

FROM amazoncorretto:15-alpine
WORKDIR /app
ARG JAR_FILE=build/libs/\*.jar
COPY --from=build /app/${JAR_FILE} ./app.jar
COPY --from=build /app/aws-opentelemetry-agent.jar ./aws-opentelemetry-agent.jar

ENV JAVA_OPTS "-javaagent:/app/aws-opentelemetry-agent.jar -Dotel.imr.export.interval=1000"
ENV HOME=/petstore

ENTRYPOINT ["java","-jar","/app/app.jar"]