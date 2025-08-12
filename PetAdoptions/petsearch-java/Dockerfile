FROM gradle:7.3-jdk17 as build

WORKDIR /app
COPY ./build.gradle ./build.gradle
COPY ./src ./src
COPY ./settings.gradle ./settings.gradle

ENV GRADLE_OPTS "-Dorg.gradle.daemon=false"
RUN gradle build -DexcludeTags='integration'

FROM amazoncorretto:17-alpine
WORKDIR /app

ARG JAR_FILE=build/libs/\*.jar
COPY --from=build /app/${JAR_FILE} ./app.jar

ENTRYPOINT ["java","-jar","/app/app.jar"]
