using System;
using System.Net.Http;
using System.Threading.Tasks;
using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Amazon.SQS;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Http;
using Prometheus;

namespace PetSite.Controllers
{
    public class PaymentController : BaseController
    {
        private static string _txStatus = String.Empty;
        
        private readonly ILogger<PaymentController> _logger;

        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;

        //Prometheus metric to count the number of Pets adopted
        private static readonly Counter PetAdoptionCount =
            Metrics.CreateCounter("petsite_petadoptions_total", "Count the number of Pets adopted");

        public PaymentController(ILogger<PaymentController> logger, IConfiguration configuration, IHttpClientFactory httpClientFactory)
        {
            _configuration = configuration;
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        // GET: Payment
        [HttpGet]
        public ActionResult Index()
        {
            if (EnsureUserId()) return new EmptyResult();
            
            // Transfer TempData to ViewData for the view
            if (TempData["txStatus"] != null)
            {
                ViewData["txStatus"] = TempData["txStatus"];
                ViewData["error"] = TempData["error"];
            }
            
            // Handle food purchase status
            if (TempData["FoodPurchaseStatus"] != null)
            {
                ViewData["FoodPurchaseStatus"] = TempData["FoodPurchaseStatus"];
                ViewData["PurchasedFoodId"] = TempData["PurchasedFoodId"];
            }
            
            return View();
        }

        // POST: Payment/MakePayment
        [HttpPost]
        // [ValidateAntiForgeryToken]
        public async Task<IActionResult> MakePayment(string petId, string pettype)
        {
            EnsureUserId();
            // Add custom span attributes using Activity API
            var currentActivity = Activity.Current;
            if (currentActivity != null)
            {
                currentActivity.SetTag("pet.id", petId);
                currentActivity.SetTag("pet.type", pettype);
                
                _logger.LogInformation($"Inside MakePayment Action method - PetId:{petId} - PetType:{pettype}");
            }

            try
            {
                // Create a new activity for the Payment API call
                using (var activity = new Activity("Call Payment API").Start())
                {
                    if (activity != null)
                    {
                        activity.SetTag("pet.id", petId);
                        activity.SetTag("pet.type", pettype);
                    }
                    
                    var result = await PostTransaction(petId, pettype);
                }

                //Increase purchase metric count
                PetAdoptionCount.Inc();
                TempData["txStatus"] = "success";
                return RedirectToAction("Index", new { userId = ViewBag.UserId });
            }
            catch (Exception ex)
            {
                TempData["txStatus"] = "failure";
                TempData["error"] = ex.Message;
                
                // Log the exception
                _logger.LogError(ex, $"Error in MakePayment: {ex.Message}");
                
                return RedirectToAction("Index", new { userId = ViewBag.UserId });
            }
        }

        private async Task<HttpResponseMessage> PostTransaction(string petId, string pettype)
        {
            using var httpClient = _httpClientFactory.CreateClient();
            var userId = ViewBag.UserId?.ToString() ?? HttpContext.Session.GetString("userId");
            return await httpClient.PostAsync($"{SystemsManagerConfigurationProviderWithReloadExtensions.GetConfiguration(_configuration,"PAYMENT_API_URL")}?petId={petId}&petType={pettype}&userId={userId}",
                null);
        }
        
    }
}
