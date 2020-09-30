using System;
using System.Collections.Generic;
using Amazon.Extensions.Configuration.SystemsManager;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Primitives;

namespace PetSite
{
    /// <summary>
    /// Simple wrapper around <see cref="SystemsManagerConfigurationProvider"/> to load
    /// parameters from SSM on the first use. Helps with deployment scenarios when
    /// the service starts before all SSM parameters are created.
    /// </summary>
    public static class SystemsManagerConfigurationProviderWithReloadExtensions
    {
        public static IConfigurationBuilder AddSystemsManagerWithReload(
            this IConfigurationBuilder builder,
            Action<SystemsManagerConfigurationSource> configureSource)
        {
            if (configureSource == null)
                throw new ArgumentNullException(nameof (configureSource));
            
            var configurationSource = new ConfigurationSource();
            configureSource(configurationSource);
            
            if (string.IsNullOrWhiteSpace(configurationSource.Path))
                throw new ArgumentNullException("Path");
            if (configurationSource.AwsOptions != null)
                return builder.Add(configurationSource);
            
            configurationSource.AwsOptions = builder.Build().GetAWSOptions();
            return builder.Add(configurationSource);
        }

        private class ConfigurationSource : SystemsManagerConfigurationSource, IConfigurationSource
        {
            IConfigurationProvider IConfigurationSource.Build(IConfigurationBuilder builder)
                => new ConfigurationProvider(this);
        }

        private class ConfigurationProvider : IConfigurationProvider
        {
            private readonly SystemsManagerConfigurationProvider _provider;
            private readonly TimeSpan? _reloadAfter;
            private DateTime _lastAccessTime;
            
            public ConfigurationProvider(SystemsManagerConfigurationSource source)
            {
                _reloadAfter = source.ReloadAfter;
                _provider = new SystemsManagerConfigurationProvider(source);
            }

            public IChangeToken GetReloadToken() 
                => _provider.GetReloadToken();
            
            public IEnumerable<string> GetChildKeys(IEnumerable<string> earlierKeys, string parentPath)
                => _provider.GetChildKeys(earlierKeys, parentPath);
            
            public void Set(string key, string value) 
                => _provider.Set(key, value);

            public void Load()
            {
                ReloadIfNeeded(forceReload: true); 
            }

            public bool TryGet(string key, out string value)
            {
                ReloadIfNeeded();
                return _provider.TryGet(key, out value);
            }

            private void ReloadIfNeeded(bool forceReload = false)
            {
                if (forceReload || (_reloadAfter.HasValue && (DateTime.UtcNow - _lastAccessTime) > _reloadAfter))
                    _provider.Load();
                
                _lastAccessTime = DateTime.UtcNow;
            }
        }

        /*Amazon.Extensions.Configuration.SystemsManager doesn't support AssumeRoleWithWebIdentity see issue here. As a temporary solution, environment variables where provided to override configurations read from Parameter store as those were empty. Long term solution needs to update class SystemsManagerConfigurationProviderWithReloadExtensions 
        using a different base class or wait for the issue to be solved.
        The workaround is to provide a way to inject the ParameterValues as environment variables*/
                
        private static Dictionary<string,string> ConfigurationMapping = new Dictionary<string, string> {
            { "searchapiurl", "SEARCH_API_URL"},
            { "updateadoptionstatusurl", "UPDATE_ADOPTION_STATUS_URL"},
            { "cleanupadoptionsurl", "CLEANUP_ADOPTIONS_URL"},
            { "paymentapiurl", "PAYMENT_API_URL"},
            { "queueurl", "QUEUE_URL"},
            { "snsarn", "SNS_ARN"},
            { "petlistadoptionsurl", "PET_LIST_ADOPTION_URL"}
        };
        
        public static string GetConfiguration(IConfiguration _configuration, string value)
        {
            string retVal = _configuration[value];

            string envVar = ConfigurationMapping[value];
            if (!string.IsNullOrEmpty(envVar))
            {
              if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable(envVar)))
                {
                    retVal = Environment.GetEnvironmentVariable(envVar);
                }  
            }
            return retVal;
  
        }
    }
}