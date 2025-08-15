using System;

namespace PetSite.Helpers
{
    public static class UrlHelper
    {
        public static string BuildUrl(string baseUrl, params (string key, string value)[] parameters)
        {
            if (string.IsNullOrEmpty(baseUrl))
                return string.Empty;

            var url = baseUrl;
            var hasQuery = url.Contains("?");

            foreach (var (key, value) in parameters)
            {
                if (!string.IsNullOrEmpty(value))
                {
                    var separator = hasQuery ? "&" : "?";
                    url += $"{separator}{key}={Uri.EscapeDataString(value)}";
                    hasQuery = true;
                }
            }

            return url;
        }
    }
}