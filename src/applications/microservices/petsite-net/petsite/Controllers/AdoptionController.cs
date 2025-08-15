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
            
            _logger.LogInformation($"In Index Adoption/Index method with pet: {JsonSerializer.Serialize(pet)}");
            
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
                
                _logger.LogInformation($"Processing adoption request - PetId:{searchParams.petid}, PetType:{searchParams.pettype}, PetColor:{searchParams.petcolor}");
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
                    _logger.LogInformation($"Inside Adoption/TakeMeHome with - pettype: {searchParams.pettype}, petcolor: {searchParams.petcolor}, petid: {searchParams.petid}");
                    pets = await _petSearchService.GetPetDetails(searchParams.pettype, searchParams.petcolor, searchParams.petid, "userxxx");
                }
            }
            catch (Exception e)
            {
                // Log the exception
                _logger.LogError(e, "Error calling PetSearch API");
                throw e;
            }

            var selectedPet = pets.FirstOrDefault();
            if (selectedPet != null)
            {
                return RedirectToAction("Index", new { 
                    userId = userId,
                    petid = selectedPet.petid,
                    pettype = selectedPet.pettype,
                    petcolor = selectedPet.petcolor,
                    peturl = selectedPet.peturl,
                    price = selectedPet.price,
                    cuteness_rate = selectedPet.cuteness_rate
                });
            }
            
            return RedirectToAction("Index", new { userId = userId });
        }
    }
}
