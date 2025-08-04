FROM gradle:7.3-jdk17 as build

WORKDIR /app
COPY ./build.gradle ./build.gradle
COPY ./src ./src
COPY ./settings.gradle ./settings.gradle

ENV GRADLE_OPTS "-Dorg.gradle.daemon=false"
RUN gradle build -DexcludeTags='integration'

FROM amazoncorretto:17-alpine
WORKDIR /app

# Install AWS CloudWatch agent for sending data to CloudWatch
RUN apk add --no-cache curl
RUN curl -L https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm -o amazon-cloudwatch-agent.rpm
RUN apk add --no-cache rpm2cpio && rpm2cpio amazon-cloudwatch-agent.rpm | cpio -idmv
RUN rm amazon-cloudwatch-agent.rpm

# Download AWS OpenTelemetry Java agent for instrumentation
ADD https://github.com/aws-observability/aws-otel-java-instrumentation/releases/download/v1.21.1/aws-opentelemetry-agent.jar /app/aws-opentelemetry-agent.jar
ENV JAVA_TOOL_OPTIONS "-javaagent:/app/aws-opentelemetry-agent.jar"

# Copy CloudWatch agent configuration to the correct path
COPY cloudwatch-config.json /etc/cwagentconfig/amazon-cloudwatch-agent.json

ARG JAR_FILE=build/libs/\*.jar
COPY --from=build /app/${JAR_FILE} ./app.jar

# OpenTelemetry agent configuration for instrumentation
ENV OTEL_TRACES_SAMPLER "always_on"
ENV OTEL_PROPAGATORS "tracecontext,baggage,xray"
ENV OTEL_RESOURCE_ATTRIBUTES "service.name=PetSearch"
ENV OTEL_IMR_EXPORT_INTERVAL "10000"
ENV OTEL_EXPORTER_OTLP_ENDPOINT "http://localhost:4317"

# CloudWatch agent configuration for sending data to CloudWatch
ENV AWS_DEFAULT_REGION=us-west-1
ENV AWS_REGION=us-west-1
ENV AWS_ACCESS_KEY_ID=dummyaccess
ENV AWS_SECRET_ACCESS_KEY=dummysecret

# Start CloudWatch agent and application
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENTRYPOINT ["/app/start.sh"]
