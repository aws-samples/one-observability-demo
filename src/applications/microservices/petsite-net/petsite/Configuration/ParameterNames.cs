using System;
using Microsoft.Extensions.Configuration;

namespace PetSite.Configuration
{
    public static class ParameterNames
    {
        // Environment Variable Names for parameter names (all caps)
        public const string PET_HISTORY_URL = "PET_HISTORY_URL_PARAM_NAME";
        public const string PET_LIST_ADOPTIONS_URL = "PET_LIST_ADOPTIONS_URL_PARAM_NAME";
        public const string CLEANUP_ADOPTIONS_URL = "CLEANUP_ADOPTIONS_URL_PARAM_NAME";
        public const string PAYMENT_API_URL = "PAYMENT_API_URL_PARAM_NAME";
        public const string FOOD_API_URL = "FOOD_API_URL_PARAM_NAME";
        public const string CART_API_URL = "CART_API_URL_PARAM_NAME";
        public const string SEARCH_API_URL = "SEARCH_API_URL_PARAM_NAME";
        public const string RUM_SCRIPT_PARAMETER = "RUM_SCRIPT_PARAMETER_NAME";

        /// <summary>
        /// Retrieves a parameter value using the parameter name from environment variables.
        /// The environment variable should contain the actual parameter name, and this method
        /// will use that parameter name to retrieve the value from the configuration.
        /// </summary>
        /// <param name="parameterNameEnvVar">The environment variable name that contains the parameter name</param>
        /// <param name="configuration">The IConfiguration instance to retrieve the parameter value</param>
        /// <returns>The parameter value</returns>
        /// <exception cref="InvalidOperationException">Thrown when the parameter name environment variable is missing</exception>
        public static string GetParameterValue(string parameterNameEnvVar, IConfiguration configuration)
        {
            // Get the parameter name from environment variable
            var parameterName = Environment.GetEnvironmentVariable(parameterNameEnvVar);

            if (string.IsNullOrEmpty(parameterName))
            {
                throw new InvalidOperationException($"Parameter name environment variable '{parameterNameEnvVar}' is not set or is empty. Please ensure the environment variable contains the actual parameter name.");
            }

            // Get the parameter value using the parameter name from configuration
            var parameterValue = configuration[parameterName];

            if (string.IsNullOrEmpty(parameterValue))
            {
                throw new InvalidOperationException($"Parameter value for '{parameterName}' is not found in configuration. Parameter name was retrieved from environment variable '{parameterNameEnvVar}'.");
            }

            return parameterValue;
        }
    }
}
