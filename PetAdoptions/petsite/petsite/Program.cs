using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore;
using Prometheus.DotNetRuntime;

namespace PetSite
{
    public class Program
    {
        public static void Main(string[] args)
        {
            // Sets default settings to collect dotnet runtime specific metrics
            DotNetRuntimeStatsBuilder.Default().StartCollecting();

            //You can also set the specifics on what metrics you want to collect as below
            // DotNetRuntimeStatsBuilder.Customize()
            //     .WithThreadPoolSchedulingStats()
            //     .WithContentionStats()
            //     .WithGcStats()
            //     .WithJitStats()
            //     .WithThreadPoolStats()
            //     .WithErrorHandler(ex => Console.WriteLine("ERROR: " + ex.ToString()))
            //     //.WithDebuggingMetrics(true);
            //     .StartCollecting();

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
                        config.AddSystemsManager(configureSource =>
                        {
                            configureSource.Path = "/petstore";
                            configureSource.Optional = true;
                            configureSource.ReloadAfter = TimeSpan.FromMinutes(5);
                        });
                })
                .ConfigureWebHostDefaults(webBuilder => { webBuilder.UseStartup<Startup>(); });
    }
}