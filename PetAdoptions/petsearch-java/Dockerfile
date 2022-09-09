FROM gradle:7.3-jdk17 as build

WORKDIR /app
COPY ./build.gradle ./build.gradle
COPY ./src ./src
COPY ./settings.gradle ./settings.gradle

ENV GRADLE_OPTS "-Dorg.gradle.daemon=false"
RUN gradle build -DexcludeTags='integration'

FROM amazoncorretto:17-alpine
WORKDIR /app

ADD https://github.com/aws-observability/aws-otel-java-instrumentation/releases/download/v1.17.0/aws-opentelemetry-agent.jar /app/aws-opentelemetry-agent.jar
ENV JAVA_TOOL_OPTIONS "-javaagent:/app/aws-opentelemetry-agent.jar"

ARG JAR_FILE=build/libs/\*.jar
COPY --from=build /app/${JAR_FILE} ./app.jar

# OpenTelemetry agent configuration
ENV OTEL_TRACES_SAMPLER "always_on"
ENV OTEL_PROPAGATORS "tracecontext,baggage,xray"
ENV OTEL_RESOURCE_ATTRIBUTES "service.name=PetSearch"
ENV OTEL_IMR_EXPORT_INTERVAL "10000"
ENV OTEL_EXPORTER_OTLP_ENDPOINT "http://localhost:4317"

ENTRYPOINT ["java","-jar","/app/app.jar"]
