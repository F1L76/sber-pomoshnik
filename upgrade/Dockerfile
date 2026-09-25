# ponytail: multi-stage jar — ceiling: free Render cold start; upgrade: native image later
FROM eclipse-temurin:17-jdk-jammy AS build
WORKDIR /app
COPY . .
RUN chmod +x mvnw && ./mvnw -q -DskipTests package

FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=build /app/target/upgrade-0.1.0-SNAPSHOT.jar app.jar
RUN mkdir -p /app/data/uploads
ENV SPRING_DATASOURCE_URL=jdbc:h2:file:./data/upgrade;MODE=PostgreSQL;DB_CLOSE_DELAY=-1
EXPOSE 8088
CMD ["java", "-jar", "app.jar"]
