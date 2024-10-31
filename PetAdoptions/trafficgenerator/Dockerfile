FROM mcr.microsoft.com/dotnet/aspnet:6.0-bullseye-slim AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443

FROM mcr.microsoft.com/dotnet/sdk:6.0-bullseye-slim AS build
WORKDIR /src
COPY . .
RUN dotnet restore "trafficgenerator.csproj"
RUN dotnet build "trafficgenerator.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "trafficgenerator.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
#ENV DOTNET_ENVIRONMENT=Development
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "trafficgenerator.dll"]
