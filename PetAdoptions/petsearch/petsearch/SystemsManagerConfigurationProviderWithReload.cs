using System;
using System.Collections.Generic;
using Amazon.Extensions.Configuration.SystemsManager;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Primitives;

namespace PetSearch
{
    /// <summary>
    /// Simple wrapper around <see cref="SystemsManagerConfigurationProvider"/> to load
    /// parameters from SSM on the first use. Helps with deployment scenarios when
    /// the service starts before all SSM parameters are created.
    /// </summary>
    public class SystemsManagerConfigurationProviderWithReload : IConfigurationProvider
    {
        private readonly SystemsManagerConfigurationProvider _provider;
        private readonly TimeSpan? _reloadAfter;
        private DateTime _lastAccessTime;
        
        public SystemsManagerConfigurationProviderWithReload(SystemsManagerConfigurationSource source)
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
        
        public class ConfigurationSource : SystemsManagerConfigurationSource, IConfigurationSource
        {
            IConfigurationProvider IConfigurationSource.Build(IConfigurationBuilder builder)
                => new SystemsManagerConfigurationProviderWithReload(this);
        }
    }
}