#nullable enable
using System;

namespace PetSite.Helpers
{
    public static class UrlHelper
    {
        public static string BuildUrl(string baseUrl, string[]? path, params (string key, string value)[] parameters)
        {
            if (string.IsNullOrEmpty(baseUrl))
                return string.Empty;

            var url = baseUrl.TrimEnd('/');

            // Add path segments
            if (path != null && path.Length > 0)
            {
                foreach (var segment in path)
                {
                    if (!string.IsNullOrEmpty(segment))
                    {
                        url += "/" + segment.Trim('/');
                    }
                }
            }

            var hasQuery = url.Contains("?");


            if (parameters != null)
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