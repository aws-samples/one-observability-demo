namespace PetSite.Configuration
{
    public static class ParameterNames
    {
        // Default Values
        public const string DEFAULT_PARAMETER_PREFIX = "/petstore";

        // Environment Variable Names (all caps)
        public const string PARAMETER_PREFIX = "PARAMETER_PREFIX";
        public const string PET_HISTORY_URL = "PET_HISTORY_URL";
        public const string PET_LIST_ADOPTIONS_URL = "PET_LIST_ADOPTIONS_URL";
        public const string CLEANUP_ADOPTIONS_URL = "CLEANUP_ADOPTIONS_URL";
        public const string PAYMENT_API_URL = "PAYMENT_API_URL";
        public const string FOOD_API_URL = "FOOD_API_URL";
        public const string SEARCH_API_URL = "SEARCH_API_URL";
        public const string RUM_SCRIPT_PARAMETER = "RUM_SCRIPT_PARAMETER";

        // SSM Parameter Names (without prefix since AddSystemsManager adds /petstore prefix)
        public static class SSMParameters
        {
            public const string PET_HISTORY_URL = "pethistoryurl";
            public const string PET_LIST_ADOPTIONS_URL = "petlistadoptionsurl";
            public const string CLEANUP_ADOPTIONS_URL = "cleanupadoptionsurl";
            public const string PAYMENT_API_URL = "paymentapiurl";
            public const string FOOD_API_URL = "foodapiurl";
            public const string SEARCH_API_URL = "searchapiurl";
            public const string RUM_SCRIPT_PARAMETER = "rumscriptparameter";
        }
    }
}
