using System;
using System.Net.Http;
using System.Threading.Tasks;
using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Amazon.SQS;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Http;
using PetSite.Helpers;
using PetSite.ViewModels;
using PetSite.Services;
using System.Text.Json;
using System.Linq;
using Prometheus;

namespace PetSite.Controllers
{
    public class PaymentController : BaseController
    {
        private static string _txStatus = String.Empty;

        private readonly ILogger<PaymentController> _logger;

        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly IPetSearchService _petSearchService;

        //Prometheus metric to count the number of Pets adopted
        private static readonly Counter PetAdoptionCount =
            Metrics.CreateCounter("petsite_petadoptions_total", "Count the number of Pets adopted");

        public PaymentController(ILogger<PaymentController> logger, IConfiguration configuration,
            IHttpClientFactory httpClientFactory, IPetSearchService petSearchService)
        {
            _configuration = configuration;
            _httpClientFactory = httpClientFactory;
            _petSearchService = petSearchService;
            _logger = logger;
        }

        // GET: Payment
        [HttpGet]
        public async Task<ActionResult> Index([FromQuery] string userId, string status, string petId, string petType)
        {
            if (EnsureUserId()) return new EmptyResult();

            // Transfer Session to ViewData for the view
            ViewData["txStatus"] = status;

            Pet petDetails = null;
            if (!string.IsNullOrEmpty(petId) && !string.IsNullOrEmpty(petType))
            {
                try
                {
                    var pets = await _petSearchService.GetPetDetails(petType, "all", petId, userId);
                    petDetails = pets?.FirstOrDefault();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error fetching pet details after payment.");
                    ViewData["txStatus"] = ex.Message;
                    throw ex;
                }
            }
            ViewData["PetDetails"] = petDetails;
            return View();
        }

        // POST: Payment/MakePayment
        [HttpPost]
        // [ValidateAntiForgeryToken]
        public async Task<IActionResult> MakePayment(string petId, string petType, string userId)
        {
            //if (EnsureUserId()) return new EmptyResult();

            if (string.IsNullOrEmpty(userId)) EnsureUserId();

            // Add custom span attributes using Activity API
            var currentActivity = Activity.Current;
            if (currentActivity != null)
            {
                currentActivity.SetTag("pet.id", petId);
                currentActivity.SetTag("pet.type", petType);

                _logger.LogInformation($"Inside MakePayment Action method - PetId:{petId} - PetType:{petType}");
            }

            try
            {
                // Create tracing span for Payment API operation
                using (var activity = Activity.Current?.Source?.StartActivity("Calling Payment API"))
                {
                    if (activity != null)
                    {
                        activity.SetTag("pet.id", petId);
                        activity.SetTag("pet.type", petType);
                    }

                    // userId parameter is already available

                    using var httpClient = _httpClientFactory.CreateClient();

                    var url = UrlHelper.BuildUrl(_configuration["paymentapiurl"], null,
                        ("petId", petId), ("petType", petType), ("userId", userId));
                    await httpClient.PostAsync(url, null);
                }

                //Increase purchase metric count
                PetAdoptionCount.Inc();
                return RedirectToAction("Index", new { userId = userId, status = "success", petType = petType, petId = petId });
            }
            catch (Exception ex)
            {
                // Log the exception
                _logger.LogError(ex, $"Error in MakePayment: {ex.Message}");

                return RedirectToAction("Index", new { userId = userId, status = ex.Message });
            }
        }
    }
}