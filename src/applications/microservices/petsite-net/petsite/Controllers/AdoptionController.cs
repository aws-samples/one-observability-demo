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
using Microsoft.Extensions.Logging;

using PetSite.ViewModels;


namespace PetSite.Controllers
{
    public class AdoptionController : BaseController
    {
        private readonly PetSite.Services.IPetSearchService _petSearchService;
        private static Variety _variety = new Variety();
        private readonly ILogger<AdoptionController> _logger;

        public AdoptionController(ILogger<AdoptionController> logger, PetSite.Services.IPetSearchService petSearchService)
        {
            _petSearchService = petSearchService;
            _logger = logger;
        }

        // GET: Adoption
        [HttpGet]
        public async Task<IActionResult> Index(string userId, string petid)
        {
            if (EnsureUserId()) return new EmptyResult(); // Redirect happened, stop processing

            Pet pet;
            ViewBag.UserId = userId; // Pass userId to view for forms

            // If petid is provided, fetch pet details from the service
            if (!string.IsNullOrEmpty(petid))
            {
                try
                {
                    _logger.LogInformation($"Fetching pet details for petid: {petid}, user: {userId}");

                    // Call the service to get pet details by petid
                    var pets = await _petSearchService.GetPetDetails("", "", petid, userId);
                    pet = pets.FirstOrDefault();

                    if (pet != null)
                    {
                        _logger.LogInformation($"Retrieved pet details for petid {petid}: {JsonSerializer.Serialize(pet)}");
                    }
                    else
                    {
                        _logger.LogWarning($"No pet found for petid: {petid}");
                        pet = new Pet();
                    }
                }
                catch (Exception e)
                {
                    _logger.LogError(e, $"Error fetching pet details for petid: {petid}, user: {userId}");
                    pet = new Pet();
                    ViewBag.ErrorMessage = "Unable to load pet details. Please try again.";
                }
            }
            else
            {
                // For direct navigation without petid, show empty pet form
                pet = new Pet();
                _logger.LogInformation($"Direct navigation to Index with empty pet for user: {userId}");
            }

            return View(pet);
        }



        [HttpPost]
        public async Task<IActionResult> TakeMeHome([FromForm] SearchParams searchParams, string userId)
        {
            if(string.IsNullOrEmpty(userId)) EnsureUserId();

            // Add custom span attributes using Activity API
            var currentActivity = Activity.Current;
            if (currentActivity != null)
            {
                currentActivity.SetTag("pet.id", searchParams.petid);
                currentActivity.SetTag("pet.type", searchParams.pettype);
                currentActivity.SetTag("pet.color", searchParams.petcolor);

                _logger.LogInformation($"Processing adoption request - PetId:{searchParams.petid}, PetType:{searchParams.pettype}, PetColor:{searchParams.petcolor} - for user: {userId}");
            }

            List<Pet> pets;

            try
            {
                // Create tracing span for Search API operation
                using (var activity = Activity.Current?.Source?.StartActivity("Calling Search API"))
                {
                    if (activity != null)
                    {
                        activity.SetTag("pet.id", searchParams.petid);
                        activity.SetTag("pet.type", searchParams.pettype);
                        activity.SetTag("pet.color", searchParams.petcolor);
                    }
                    _logger.LogInformation($"Inside Adoption/TakeMeHome with - pettype: {searchParams.pettype}, petcolor: {searchParams.petcolor}, petid: {searchParams.petid} - for user: {userId}");
                    pets = await _petSearchService.GetPetDetails(searchParams.pettype, searchParams.petcolor, searchParams.petid, "userxxx");
                }
            }
            catch (Exception e)
            {
                _logger.LogError(e, $"Error calling PetSearch API for user: {userId}");
                ViewBag.ErrorMessage = $"Unable to process adoption request at this time. Please try again later.\nError message: {e.Message}";
                return View("Error", new PetSite.Models.ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
            }

            var selectedPet = pets.FirstOrDefault();
            if (selectedPet != null)
            {
                // Redirect to Index with only petid and userId in querystring
                _logger.LogInformation($"Redirecting to Index with petid: {selectedPet.petid} for user: {userId}");
                return RedirectToAction("Index", new { userId = userId, petid = selectedPet.petid });
            }

            // Redirect to Index with only userId if no pet found
            return RedirectToAction("Index", new { userId = userId });
        }
    }
}
