using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Http;
using PetSite.Models;

namespace PetSite.Controllers
{
    public class FoodServiceController : BaseController
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<FoodServiceController> _logger;

        public FoodServiceController(IHttpClientFactory httpClientFactory, IConfiguration configuration, ILogger<FoodServiceController> logger)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> GetFoods()
        {
            if (EnsureUserId()) return new EmptyResult();

            try
            {
                using var httpClient = _httpClientFactory.CreateClient();
                var foodApiUrl = _configuration["FOOD_API_URL"] ?? "https://api.example.com/foods";
                var userId = ViewBag.UserId?.ToString() ?? HttpContext.Session.GetString("userId");
                var separator = foodApiUrl.Contains("?") ? "&" : "?";
                var response = await httpClient.GetAsync($"{foodApiUrl}{separator}userId={userId}");
                response.EnsureSuccessStatusCode();
                
                var jsonContent = await response.Content.ReadAsStringAsync();
                var foodResponse = JsonSerializer.Deserialize<FoodResponse>(jsonContent);
                
                return Json(foodResponse?.foods ?? new List<Food>());
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching food data");
                return Json(new List<Food>());
            }
        }

        [HttpPost]
        public async Task<IActionResult> BuyFood(string foodId)
        {
            if (EnsureUserId()) return new EmptyResult();

            try
            {
                using var httpClient = _httpClientFactory.CreateClient();
                var purchaseApiUrl = _configuration["FOOD_PURCHASE_API_URL"] ?? "https://api.example.com/purchase";
                var userId = ViewBag.UserId?.ToString() ?? HttpContext.Session.GetString("userId");
                var response = await httpClient.PostAsync($"{purchaseApiUrl}?foodId={foodId}&userId={userId}", null);
                response.EnsureSuccessStatusCode();
                
                TempData["FoodPurchaseStatus"] = "success";
                TempData["PurchasedFoodId"] = foodId;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error purchasing food");
                TempData["FoodPurchaseStatus"] = "error";
            }

            return RedirectToAction("Index", "Payment", new { userId = ViewBag.UserId });
        }
    }
}