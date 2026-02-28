FROM --platform=$BUILDPLATFORM public.ecr.aws/docker/library/gradle:7.3-jdk17 as build

WORKDIR /app
COPY ./build.gradle ./build.gradle
COPY ./src ./src
COPY ./settings.gradle ./settings.gradle

ENV GRADLE_OPTS "-Dorg.gradle.daemon=false"
RUN gradle build -DexcludeTags='integration' --no-daemon --stacktrace

FROM public.ecr.aws/amazoncorretto/amazoncorretto:17-al2-generic-jdk
WORKDIR /app

RUN yum install -y curl unzip && \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws && \
    yum clean all

ARG JAR_FILE=build/libs/\*.jar
COPY --from=build /app/${JAR_FILE} ./app.jar

# Create non-root user
RUN yum install -y shadow-utils && \
    useradd -r -u 1000 appuser && \
    chown -R appuser:appuser /app && \
    yum clean all
USER appuser

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:80/actuator/health || exit 1

ENTRYPOINT ["java","-jar","/app/app.jar"]
