using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
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
using Prometheus;

namespace PetSite.Controllers
{
    public class HomeController : BaseController
    {
        private readonly ILogger<HomeController> _logger;
        private readonly PetSite.Services.IPetSearchService _petSearchService;
        private readonly IHttpClientFactory _httpClientFactory;
        private static Variety _variety = new Variety();
        private readonly IConfiguration _configuration;

        //Prometheus metric to count the number of searches performed
        private static readonly Counter PetSearchCount =
            Metrics.CreateCounter("petsite_petsearches_total", "Count the number of searches performed");

        //Prometheus metric to count the number of puppy searches performed
        private static readonly Counter PuppySearchCount =
            Metrics.CreateCounter("petsite_pet_puppy_searches_total", "Count the number of puppy searches performed");

        //Prometheus metric to count the number of kitten searches performed
        private static readonly Counter KittenSearchCount =
            Metrics.CreateCounter("petsite_pet_kitten_searches_total", "Count the number of kitten searches performed");

        //Prometheus metric to count the number of bunny searches performed
        private static readonly Counter BunnySearchCount =
            Metrics.CreateCounter("petsite_pet_bunny_searches_total", "Count the number of bunny searches performed");

        private static readonly Gauge PetsWaitingForAdoption = Metrics
            .CreateGauge("petsite_pets_waiting_for_adoption", "Number of pets waiting for adoption.");



        public HomeController(ILogger<HomeController> logger, IConfiguration configuration, PetSite.Services.IPetSearchService petSearchService, IHttpClientFactory httpClientFactory)
        {
            _configuration = configuration;
            _petSearchService = petSearchService;
            _httpClientFactory = httpClientFactory;
            _logger = logger;

            _variety.PetTypes = new List<SelectListItem>()
            {
                new SelectListItem() {Value = "all", Text = "All"},
                new SelectListItem() {Value = "puppy", Text = "Puppy"},
                new SelectListItem() {Value = "kitten", Text = "Kitten"},
                new SelectListItem() {Value = "bunny", Text = "Bunny"}
            };

            _variety.PetColors = new List<SelectListItem>()
            {
                new SelectListItem() {Value = "all", Text = "All"},
                new SelectListItem() {Value = "brown", Text = "Brown"},
                new SelectListItem() {Value = "black", Text = "Black"},
                new SelectListItem() {Value = "white", Text = "White"}
            };
        }

        [HttpGet("housekeeping")]
        public async Task<IActionResult> HouseKeeping()
        {
            if (EnsureUserId()) return new EmptyResult();
            _logger.LogInformation("In Housekeeping, trying to reset the app.");

            string cleanupadoptionsurl = _configuration["cleanupadoptionsurl"];
            
            using var httpClient = _httpClientFactory.CreateClient();
            var userId = ViewBag.UserId?.ToString();
            var url = UrlHelper.BuildUrl(cleanupadoptionsurl, ("userId", userId));
            await httpClient.PostAsync(url, null);

            return View();
        }

        [HttpGet]
        public async Task<IActionResult> Index(string selectedPetType, string selectedPetColor, string petid)
        {
            if (EnsureUserId()) return new EmptyResult();
            // Add custom span attributes using Activity API
            var currentActivity = Activity.Current;
            if (currentActivity != null)
            {
                currentActivity.SetTag("pet.type", selectedPetType);
                currentActivity.SetTag("pet.color", selectedPetColor);
                currentActivity.SetTag("pet.id", petid);
                
                _logger.LogInformation($"Search string - PetType:{selectedPetType} PetColor:{selectedPetColor} PetId:{petid}");
            }
            
            List<Pet> Pets;

            try
            {
                // Create a new activity for the API call
                using (var activity = Activity.Current?.Source?.StartActivity("Calling Search API"))
                {
                    if (activity != null)
                    {
                        activity.SetTag("pet.type", selectedPetType);
                        activity.SetTag("pet.color", selectedPetColor);
                        activity.SetTag("pet.id", petid);
                    }

                    var userId = Request.Query["userId"].ToString();
                    Pets = await _petSearchService.GetPetDetails(selectedPetType, selectedPetColor, petid, userId);
                }
            }
            catch (HttpRequestException e)
            {
                _logger.LogError(e, "HTTP error received after calling PetSearch API");
                ViewBag.ErrorMessage = $"Unable to search pets at this time. Please try again later. \nError message received - {e.Message}";
                Pets = new List<Pet>();
                throw e;
            }
            catch (TaskCanceledException e)
            {
                _logger.LogError(e, "Timeout calling PetSearch API");
                ViewBag.ErrorMessage = "Search request timed out. Please try again.";
                Pets = new List<Pet>();
                throw e;
            }
            catch (Exception e)
            {
                _logger.LogError(e, "Unexpected error calling PetSearch API");
                ViewBag.ErrorMessage = "An unexpected error occurred. Please try again.";
                Pets = new List<Pet>();
                throw e;
            }

            var PetDetails = new PetDetails()
            {
                Pets = Pets,
                Varieties = new Variety
                {
                    PetTypes = _variety.PetTypes,
                    PetColors = _variety.PetColors,
                    SelectedPetColor = selectedPetColor,
                    SelectedPetType = selectedPetType
                }
            };
            
            _logger.LogInformation("Search completed with {PetCount} pets found", Pets.Count);

            // Sets the metric value to the number of pets available for adoption at the moment
            PetsWaitingForAdoption.Set(Pets.Where(pet => pet.availability == "yes").Count());

            return View(PetDetails);
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error(string userId, string message)
        {
            if (!string.IsNullOrEmpty(userId))
            {
                ViewBag.UserId = userId;
                ViewData["UserId"] = userId;
            }
            
            ViewBag.ErrorMessage = message;
            
            return View(new ErrorViewModel {RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier});
        }
    }
}
