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
            _logger=  logger;
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
                    string petlistadoptionsurl = _configuration["petlistadoptionsurl"];
                    using var httpClient = _httpClientFactory.CreateClient();
                    var userId = ViewBag.UserId?.ToString();
                    var url = UrlHelper.BuildUrl(petlistadoptionsurl, ("userId", userId));
                    result = await httpClient.GetStringAsync(url);
                    Pets = JsonSerializer.Deserialize<List<Pet>>(result);
                }
            }
            catch (Exception e)
            {
                _logger.LogError(e, $"Error calling PetListAdoptions API: {e.Message}");
                throw;
            }

            return View(Pets);
        }
    }
}
