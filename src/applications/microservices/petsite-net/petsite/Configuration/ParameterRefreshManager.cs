using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using Microsoft.Extensions.Logging;

namespace PetSite.Configuration
{
    public class ParameterRefreshManager
    {
        private readonly IAmazonSimpleSystemsManagement _ssmClient;
        private readonly ILogger<ParameterRefreshManager> _logger;
        private readonly TimeSpan _refreshInterval;
        private readonly ConcurrentDictionary<string, CachedParameter> _cache;
        private readonly string _parameterPrefix;

        private class CachedParameter
        {
            public string Value { get; set; }
            public DateTime Timestamp { get; set; }
        }

        public ParameterRefreshManager(IAmazonSimpleSystemsManagement ssmClient, ILogger<ParameterRefreshManager> logger)
        {
            _ssmClient = ssmClient;
            _logger = logger;
            _cache = new ConcurrentDictionary<string, CachedParameter>();

            _parameterPrefix = Environment.GetEnvironmentVariable("PARAMETER_STORE_PREFIX") ?? "/petstore";

            var intervalStr = Environment.GetEnvironmentVariable("CONFIG_REFRESH_INTERVAL");
            var intervalSeconds = 300; // default 5 minutes

            if (!string.IsNullOrEmpty(intervalStr) && int.TryParse(intervalStr, out var parsed))
            {
                intervalSeconds = parsed;
            }

            _refreshInterval = intervalSeconds == -1
                ? TimeSpan.MaxValue
                : TimeSpan.FromSeconds(intervalSeconds);

            _logger.LogInformation(
                "Parameter refresh interval: {Interval}",
                intervalSeconds == -1 ? "disabled" : $"{intervalSeconds} seconds"
            );
        }

        public async Task<string> GetParameterAsync(string parameterName)
        {
            var fullParameterName = parameterName.StartsWith("/") ? parameterName : $"{_parameterPrefix}/{parameterName}";

            if (_cache.TryGetValue(fullParameterName, out var cached))
            {
                var elapsed = DateTime.UtcNow - cached.Timestamp;
                if (elapsed < _refreshInterval)
                {
                    _logger.LogDebug("Using cached parameter: {ParameterName}", fullParameterName);
                    return cached.Value;
                }

                _logger.LogInformation(
                    "Parameter {ParameterName} needs refresh (elapsed: {Elapsed})",
                    fullParameterName,
                    elapsed
                );
            }

            _logger.LogInformation("Fetching parameter from SSM: {ParameterName}", fullParameterName);

            var request = new GetParameterRequest
            {
                Name = fullParameterName,
                WithDecryption = false
            };

            var response = await _ssmClient.GetParameterAsync(request);
            var value = response.Parameter.Value;

            _cache[fullParameterName] = new CachedParameter
            {
                Value = value,
                Timestamp = DateTime.UtcNow
            };

            _logger.LogDebug("Parameter cached: {ParameterName}", fullParameterName);
            return value;
        }
    }
}
