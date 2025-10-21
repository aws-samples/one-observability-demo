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
            if (_cache.TryGetValue(parameterName, out var cached))
            {
                var elapsed = DateTime.UtcNow - cached.Timestamp;
                if (elapsed < _refreshInterval)
                {
                    _logger.LogDebug("Using cached parameter: {ParameterName}", parameterName);
                    return cached.Value;
                }

                _logger.LogInformation(
                    "Parameter {ParameterName} needs refresh (elapsed: {Elapsed})",
                    parameterName,
                    elapsed
                );
            }

            _logger.LogInformation("Fetching parameter from SSM: {ParameterName}", parameterName);

            var request = new GetParameterRequest
            {
                Name = parameterName,
                WithDecryption = false
            };

            var response = await _ssmClient.GetParameterAsync(request);
            var value = response.Parameter.Value;

            _cache[parameterName] = new CachedParameter
            {
                Value = value,
                Timestamp = DateTime.UtcNow
            };

            _logger.LogDebug("Parameter cached: {ParameterName}", parameterName);
            return value;
        }
    }
}
