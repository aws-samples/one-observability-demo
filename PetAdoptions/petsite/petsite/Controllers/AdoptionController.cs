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
        public IActionResult Index([FromQuery] Pet pet)
        {
            if (EnsureUserId()) return new EmptyResult(); // Redirect happened, stop processing
            
            // Check if pet data exists in TempData (from TakeMeHome redirect)
            if (TempData["SelectedPet"] != null)
            {
                var petJson = TempData["SelectedPet"].ToString();
                pet = JsonSerializer.Deserialize<Pet>(petJson);
            }
            
            return View(pet);
        }
        


        [HttpPost]
        public async Task<IActionResult> TakeMeHome([FromForm] SearchParams searchParams)
        {
            EnsureUserId();
            // Add custom span attributes using Activity API (compatible with Application Signals auto-instrumentation)
            var currentActivity = Activity.Current;
            if (currentActivity != null)
            {
                currentActivity.SetTag("pet.id", searchParams.petid);
                currentActivity.SetTag("pet.type", searchParams.pettype);
                currentActivity.SetTag("pet.color", searchParams.petcolor);
                
                _logger.LogInformation($"Processing adoption request - PetId:{searchParams.petid}, PetType:{searchParams.pettype}, PetColor:{searchParams.petcolor}");
                
            }
            
            List<Pet> pets;
            
            try
            {
                // Create a new activity for the API call
                using (var activity = new Activity("Calling PetSearch API").Start())
                {
                    if (activity != null)
                    {
                        activity.SetTag("pet.id", searchParams.petid);
                        activity.SetTag("pet.type", searchParams.pettype);
                        activity.SetTag("pet.color", searchParams.petcolor);
                    }
                    
                    pets = await _petSearchService.GetPetDetails(searchParams.pettype, searchParams.petcolor, searchParams.petid);
                }
            }
            catch (Exception e)
            {
                // Log the exception
                _logger.LogError(e, "Error calling PetSearch API");
                pets = new List<Pet>();
            }

            var selectedPet = pets.FirstOrDefault();
            if (selectedPet != null)
            {
                TempData["SelectedPet"] = JsonSerializer.Serialize(selectedPet);
            }
            return RedirectToAction("Index", new { userid = ViewBag.UserId });
        }
    }
}
