using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using PetSite.ViewModels;

namespace PetSite.Controllers
{
    public class AdoptionController : Controller
    {
        private static readonly HttpClient HttpClient = new HttpClient();
        private static Variety _variety = new Variety();
        private static IConfiguration _configuration;

        private static string _searchApiurl;

        public AdoptionController(IConfiguration configuration)
        {
            _configuration = configuration;
            
            //_searchApiurl = _configuration["searchapiurl"];
            _searchApiurl = SystemsManagerConfigurationProviderWithReloadExtensions.GetConfiguration(_configuration,"searchapiurl");
        }
        
        // GET: Adoption
        [HttpGet]
        public IActionResult Index([FromQuery] Pet pet)
        {
            return View(pet);
        }
        
        private async Task<string> GetPetDetails(SearchParams searchParams)
        {
            string searchString = string.Empty;

            if (!String.IsNullOrEmpty(searchParams.pettype) && searchParams.pettype != "all") searchString = $"pettype={searchParams.pettype}";
            if (!String.IsNullOrEmpty(searchParams.petcolor) && searchParams.petcolor != "all") searchString = $"&{searchString}&petcolor={searchParams.petcolor}";
            if (!String.IsNullOrEmpty(searchParams.petid) && searchParams.petid != "all") searchString = $"&{searchString}&petid={searchParams.petid}";

            return await HttpClient.GetStringAsync($"{_searchApiurl}{searchString}");
        }

        [HttpPost]
        public async Task<IActionResult> TakeMeHome([FromForm] SearchParams searchParams)
        {
            // Add custom span attributes using Activity API (compatible with Application Signals auto-instrumentation)
            var currentActivity = Activity.Current;
            if (currentActivity != null)
            {
                currentActivity.SetTag("pet.id", searchParams.petid);
                currentActivity.SetTag("pet.type", searchParams.pettype);
                currentActivity.SetTag("pet.color", searchParams.petcolor);
                
                Console.WriteLine($"Processing adoption request - PetId:{searchParams.petid}, PetType:{searchParams.pettype}, PetColor:{searchParams.petcolor}");
            }
            
            string result;
            
            try
            {
                // Create a new activity for the API call
                using (var activity = new Activity("Calling Search API").Start())
                {
                    if (activity != null)
                    {
                        activity.SetTag("pet.id", searchParams.petid);
                        activity.SetTag("pet.type", searchParams.pettype);
                        activity.SetTag("pet.color", searchParams.petcolor);
                    }
                    
                    result = await GetPetDetails(searchParams);
                }
            }
            catch (Exception e)
            {
                // Log the exception
                Console.WriteLine($"Error calling search API: {e.Message}");
                throw;
            }

            return View("Index", JsonSerializer.Deserialize<List<Pet>>(result).FirstOrDefault());
        }
    }
}
