using System;
using Amazon.Extensions.NETCore.Setup;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Prometheus.DotNetRuntime;
using System.Diagnostics;
using Amazon.Extensions.Configuration.SystemsManager;
using Microsoft.Extensions.DependencyInjection;
using Amazon;

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

                    // Add base configuration first
                    config.AddJsonFile("appsettings.json", optional: true, reloadOnChange: true)
                          .AddJsonFile($"appsettings.{env.EnvironmentName}.json", optional: true, reloadOnChange: true);

                    if (env.EnvironmentName.ToLower() != "development")
                    {
                        Console.WriteLine("[DEBUG] Loading Systems Manager configuration...");

                        try
                        {
                            config.AddSystemsManager("/petstore");
                            Console.WriteLine("[DEBUG] Systems Manager configuration added.");
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[WARN] Failed to configure Parameter Store: {ex.Message}");
                        }
                    }
                    else
                    {
                        Console.WriteLine("[DEBUG] Development mode - skipping Systems Manager.");
                    }
                })
                .ConfigureServices((context, services) =>
                {
                    if (context.HostingEnvironment.EnvironmentName.ToLower() != "development")
                    {
                        // Enable AWS SDK logging
                        AWSConfigs.LoggingConfig.LogTo = LoggingOptions.Console;
                        AWSConfigs.LoggingConfig.LogResponses = ResponseLoggingOption.Always;
                        AWSConfigs.LoggingConfig.LogMetrics = true;
                    }
                })
                .ConfigureWebHostDefaults(webBuilder => { webBuilder.UseStartup<Startup>(); });
    }
}