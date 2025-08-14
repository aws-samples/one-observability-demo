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

        public PaymentController(ILogger<PaymentController> logger, IConfiguration configuration,
            IHttpClientFactory httpClientFactory)
        {
            _configuration = configuration;
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        // GET: Payment
        [HttpGet]
        public ActionResult Index()
        {
            _logger.LogInformation(
                $"Before EnsureUserId - GET Payment/Index with {HttpContext.Session.GetString("txStatus")}");
            if (EnsureUserId()) return new EmptyResult();

            _logger.LogInformation(
                $"After EnsureUserId -Inside GET Payment/Index with {HttpContext.Session.GetString("error")}");

            // Transfer Session to ViewData for the view
            ViewData["txStatus"] = HttpContext.Session.GetString("txStatus");
            ViewData["error"] = HttpContext.Session.GetString("error");
            // ViewData["FoodPurchaseStatus"] = HttpContext.Session.GetString("FoodPurchaseStatus");
            // ViewData["PurchasedFoodId"] = HttpContext.Session.GetString("PurchasedFoodId");
            //
            // Clear session data after reading
            HttpContext.Session.Remove("txStatus");
            HttpContext.Session.Remove("error");
            // HttpContext.Session.Remove("FoodPurchaseStatus");
            // HttpContext.Session.Remove("PurchasedFoodId");
            //
            return View();
        }

        // POST: Payment/MakePayment
        [HttpPost]
        // [ValidateAntiForgeryToken]
        public async Task<IActionResult> MakePayment(string petId, string pettype)
        {
            if (EnsureUserId()) return new EmptyResult();
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
                // Create tracing span for Payment API operation
                using (var activity = Activity.Current?.Source?.StartActivity("Calling Payment API"))
                {
                    if (activity != null)
                    {
                        activity.SetTag("pet.id", petId);
                        activity.SetTag("pet.type", pettype);
                    }

                    var userId = ViewBag.UserId?.ToString() ?? HttpContext.Session.GetString("userId");

                    using var httpClient = _httpClientFactory.CreateClient();

                    await httpClient.PostAsync(
                        $"{_configuration["paymentapiurl"]}?petId={petId}&petType={pettype}&userId={userId}",
                        null);
                }

                //Increase purchase metric count
                PetAdoptionCount.Inc();
                HttpContext.Session.SetString("txStatus", "success");
                return RedirectToAction("Index", new { userId = ViewBag.UserId });
            }
            catch (Exception ex)
            {
                HttpContext.Session.SetString("txStatus", "failure");
                HttpContext.Session.SetString("error", ex.Message);

                // Log the exception
                _logger.LogError(ex, $"Error in MakePayment: {ex.Message}");

                return RedirectToAction("Index", new { userId = ViewBag.UserId });
            }
        }
    }
}