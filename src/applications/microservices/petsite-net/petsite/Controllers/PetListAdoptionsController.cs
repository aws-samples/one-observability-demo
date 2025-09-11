using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using PetSite.Models;
using System.Net.Http;
using System.Text.Json;
using PetSite.ViewModels;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Http;
using PetSite.Helpers;
using PetSite.Configuration;

namespace PetSite.Controllers
{
    public class PetListAdoptionsController : BaseController
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<PetListAdoptionsController> _logger;

        public PetListAdoptionsController(ILogger<PetListAdoptionsController> logger, IConfiguration configuration, IHttpClientFactory httpClientFactory)
        {
            _configuration = configuration;
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        // GET
        public async Task<IActionResult> Index()
        {
            if (EnsureUserId()) return new EmptyResult();
            // Add custom span attributes using Activity API
            var currentActivity = Activity.Current;
            if (currentActivity != null)
            {
                _logger.LogInformation("Calling PetListAdoptions API");
            }

            string result;
            List<Pet> Pets = new List<Pet>();

            try
            {
                // Begin activity span to track PetListAdoptions API call
                using (var activity = Activity.Current?.Source?.StartActivity("Calling PetListAdoptions API"))
                {
                    string petlistadoptionsurl = ParameterNames.GetParameterValue(ParameterNames.PET_LIST_ADOPTIONS_URL, _configuration);
                    using var httpClient = _httpClientFactory.CreateClient();
                    var userId = ViewBag.UserId?.ToString();
                    //var url = UrlHelper.BuildUrl(petlistadoptionsurl, null, ("userId",userId));
                    result = await httpClient.GetStringAsync(petlistadoptionsurl);
                    Pets = JsonSerializer.Deserialize<List<Pet>>(result);
                }
            }
            catch (HttpRequestException e) when (e.Message.Contains("404"))
            {
                _logger.LogWarning("PetListAdoptions API returned 404 - returning empty pets list");
                Pets = new List<Pet>();
            }
            catch (Exception e)
            {
                _logger.LogError(e, $"Error calling PetListAdoptions API: {e.Message}");
                ViewBag.ErrorMessage = $"Unable to load adoption list at this time. Please try again later.\nError message: {e.Message}";
                return View("Error", new PetSite.Models.ErrorViewModel { RequestId = System.Diagnostics.Activity.Current?.Id ?? HttpContext.TraceIdentifier });
            }

            return View(Pets);
        }
    }
}
