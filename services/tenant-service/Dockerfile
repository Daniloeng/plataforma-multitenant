# Build a partir da raiz do repositório: docker build -f services/tenant-service/Dockerfile .
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
# O pom raiz lista todos os módulos; o Maven exige que existam, mesmo construindo só um (-pl).
COPY pom.xml .
COPY libs libs
COPY services services
RUN mvn -B -q -pl services/tenant-service -am package -DskipTests -Dspotless.check.skip=true -Djacoco.skip=true

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 app
COPY --from=build /src/services/tenant-service/target/tenant-service.jar app.jar
USER 10001
EXPOSE 8081
# Heap limitado: a estimativa de memória do plano pede JVMs enxutas.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:+UseSerialGC"
HEALTHCHECK --interval=10s --timeout=3s --retries=12 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8081 && printf 'GET /actuator/health/readiness HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q UP <&3"]
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
