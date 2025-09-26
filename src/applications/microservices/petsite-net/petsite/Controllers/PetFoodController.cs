using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using System;
using System.Net.Http;
using System.Threading.Tasks;
using System.Diagnostics;

namespace PetSite.Controllers
{
    public class PetFoodController : Controller
    {
        private static HttpClient httpClient;
        private IConfiguration _configuration;

        public PetFoodController(IConfiguration configuration)
        {
            _configuration = configuration;
            httpClient = new HttpClient();
        }

        [HttpGet("/petfood")]
        public async Task<string> Index()
        {
            // Add custom span attributes using Activity API
            var currentActivity = Activity.Current;
            if (currentActivity != null)
            {
                currentActivity.SetTag("operation", "GetPetFood");
                Console.WriteLine("Calling PetFood");
            }

            string result;

            try
            {
                // Begin activity to monitor PetFood
                using (var activity = Activity.Current?.Source?.StartActivity("Calling PetFood"))
                {
                    // Get our data from petfood
                    result = await httpClient.GetStringAsync("http://petfood");
                }
            }
            catch (Exception e)
            {
                Console.WriteLine($"Error calling PetFood: {e.Message}");
                throw;
            }

            // Return the result!
            return result;
        }

        [HttpGet("/petfood-metric/{entityId}/{value}")]
        public async Task<string> PetFoodMetric(string entityId, float value)
        {
            // Add custom span attributes using Activity API
            var currentActivity = Activity.Current;
            if (currentActivity != null)
            {
                currentActivity.SetTag("operation", "PetFoodMetric");
                currentActivity.SetTag("entityId", entityId);
                currentActivity.SetTag("value", value.ToString());

                Console.WriteLine("Calling: " + "http://petfood-metric/metric/" + entityId + "/" + value.ToString());
            }

            string result;

            try
            {
                // Begin activity to monitor PetFood metrics retrieval
                using (var activity = Activity.Current?.Source?.StartActivity("Calling PetFood metrics"))
                {
                    if (activity != null)
                    {
                        activity.SetTag("entityId", entityId);
                        activity.SetTag("value", value.ToString());
                    }

                    result = await httpClient.GetStringAsync("http://petfood-metric/metric/" + entityId + "/" + value.ToString());
                }
            }
            catch (Exception e)
            {
                Console.WriteLine($"Error calling PetFood metric: {e.Message}");
                throw;
            }

            return result;
        }
    }
}