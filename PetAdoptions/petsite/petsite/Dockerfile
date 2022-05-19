FROM mcr.microsoft.com/dotnet/aspnet:6.0-bullseye-slim AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443

FROM mcr.microsoft.com/dotnet/sdk:6.0-bullseye-slim AS build
WORKDIR /src
COPY . .
RUN dotnet restore "PetSite.csproj"
RUN dotnet build "PetSite.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "PetSite.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
#ENV AWS_XRAY_DAEMON_ADDRESS=xray-service.default
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "PetSite.dll"]
