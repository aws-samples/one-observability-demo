FROM mcr.microsoft.com/dotnet/aspnet:8.0-bullseye-slim-amd64 AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443

FROM mcr.microsoft.com/dotnet/sdk:8.0-bullseye-slim-amd64 AS build
WORKDIR /src
COPY . .
RUN dotnet restore "PetSite.csproj"
RUN dotnet build "PetSite.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "PetSite.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
# Removed X-Ray daemon address environment variable
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "PetSite.dll"]
