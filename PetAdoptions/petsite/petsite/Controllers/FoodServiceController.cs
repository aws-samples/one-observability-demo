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
using PetSite.Helpers;

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
                var userId = ViewBag.UserId?.ToString();
                var url = UrlHelper.BuildUrl(foodApiUrl, ("userId", userId));
                var response = await httpClient.GetAsync(url);
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
        public async Task<IActionResult> BuyFood(string foodId, string userId)
        {
            if (EnsureUserId()) return new EmptyResult();

            try
            {
                using var httpClient = _httpClientFactory.CreateClient();
                var purchaseApiUrl = _configuration["FOOD_PURCHASE_API_URL"] ?? "https://api.example.com/purchase";
               // var userId = ViewBag.UserId?.ToString();
                var url = UrlHelper.BuildUrl(purchaseApiUrl, ("foodId", foodId), ("userId", userId));
                var response = await httpClient.PostAsync(url, null);
                response.EnsureSuccessStatusCode();
                
                // Food purchase successful - could add ViewData or redirect with status
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error purchasing food");
                // Food purchase failed - could add ViewData or redirect with error
            }

            return RedirectToAction("Index", "Payment", new { userId = userId });
        }
    }
}