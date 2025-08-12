using System;
using Amazon.Extensions.NETCore.Setup;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Prometheus.DotNetRuntime;
using System.Diagnostics;
using Amazon.Extensions.Configuration.SystemsManager;
using Microsoft.Extensions.DependencyInjection;

namespace PetSite
{
    public class Program
    {
        public static void Main(string[] args)
        {
            // Sets default settings to collect dotnet runtime specific metrics
            DotNetRuntimeStatsBuilder.Default().StartCollecting();

            // Configure Activity source for custom spans
            Activity.DefaultIdFormat = ActivityIdFormat.W3C;
            Activity.ForceDefaultIdFormat = true;

            CreateHostBuilder(args).Build().Run();
        }

        public static IHostBuilder CreateHostBuilder(string[] args) =>
            Host.CreateDefaultBuilder(args)
                .ConfigureAppConfiguration((hostingContext, config) =>
                {
                    var env = hostingContext.HostingEnvironment;
                    Console.WriteLine($"ENVIRONMENT NAME IS: {env.EnvironmentName}");
                    if (env.EnvironmentName.ToLower() == "development")
                        config.AddJsonFile("appsettings.json", optional: true, reloadOnChange: true)
                            .AddJsonFile($"appsettings.{env.EnvironmentName}.json",
                                optional: true, reloadOnChange: true);
                    else
                    {
                        config.AddSystemsManager(configureSource =>
                        {
                            configureSource.Path = "/petstore";
                            configureSource.Optional = true;
                            configureSource.ReloadAfter = TimeSpan.FromMinutes(5);
                        });
                    }
                })
                .ConfigureServices((context, services) =>
                {
                    services.AddDefaultAWSOptions(context.Configuration.GetAWSOptions());
                })
                .ConfigureWebHostDefaults(webBuilder => { webBuilder.UseStartup<Startup>(); });
    }
}
