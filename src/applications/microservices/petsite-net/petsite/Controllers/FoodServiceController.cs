using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
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

        public FoodServiceController(IHttpClientFactory httpClientFactory, IConfiguration configuration,
            ILogger<FoodServiceController> logger)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> Index([FromQuery] string userId, string petType)
        {
            if (EnsureUserId()) return new EmptyResult();

            ViewBag.PetType = petType;

            try
            {
                using var httpClient = _httpClientFactory.CreateClient();
                var foodApiUrl = _configuration["foodapiurl"];
                var url = UrlHelper.BuildUrl(foodApiUrl, new[]{"api","foods"}, ("pettype", petType));
                var response = await httpClient.GetAsync(url);
                response.EnsureSuccessStatusCode();

                var jsonContent = await response.Content.ReadAsStringAsync();
                var foodResponse = JsonSerializer.Deserialize<PetSite.ViewModels.FoodApiResponse>(jsonContent,
                    new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });

                return View(foodResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching food data from FoodService API");
                ViewBag.ErrorMessage = $"Unable to load food items at this time. Please try again later.\nError message: {ex.Message}";
                return View("Error", new PetSite.Models.ErrorViewModel { RequestId = System.Diagnostics.Activity.Current?.Id ?? HttpContext.TraceIdentifier });
            }

        }

        [HttpPost]
        public async Task<IActionResult> AddToCart(string foodId, string userId)
        {
            if (userId == null)
            {
                if (EnsureUserId()) return new EmptyResult();
            }

            try
            {
                using var httpClient = _httpClientFactory.CreateClient();

                // First API call - Add to cart
                var addToCartUrl = UrlHelper.BuildUrl(_configuration["foodapiurl"], new[] { "api", "cart", userId, "items" }, null);
                var cartData = new { food_id = foodId, quantity = 1 };
                var cartJson = JsonSerializer.Serialize(cartData);
                var cartContent = new StringContent(cartJson, Encoding.UTF8, "application/json");
                
                var cartResponse = await httpClient.PostAsync(addToCartUrl, cartContent);

                if (cartResponse.StatusCode == System.Net.HttpStatusCode.Created)
                {
                    var totalItems = await GetCartItemCountAsync(userId);
                    return Ok(new { success = true, totalItems });
                }

                return Ok(new { success = true, totalItems = 0 });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error adding item to cart");
                return BadRequest(ex.Message);
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
                var url = UrlHelper.BuildUrl(purchaseApiUrl, null, ("foodId", foodId), ("userId", userId));
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

        [HttpGet]
        public async Task<IActionResult> GetCartCount(string userId)
        {
            var totalItems = await GetCartItemCountAsync(userId);
            return Ok(new { totalItems });
        }

        private async Task<int> GetCartItemCountAsync(string userId)
        {
            try
            {
                using var httpClient = _httpClientFactory.CreateClient();
                var getCartUrl = UrlHelper.BuildUrl(_configuration["foodapiurl"], new[]{"api","cart",userId}, null);
                var getCartResponse = await httpClient.GetAsync(getCartUrl);

                if (getCartResponse.StatusCode == System.Net.HttpStatusCode.OK)
                {
                    var responseContent = await getCartResponse.Content.ReadAsStringAsync();
                    var cartInfo = JsonSerializer.Deserialize<JsonElement>(responseContent);

                    if (cartInfo.TryGetProperty("total_items", out var totalItems))
                    {
                        return totalItems.GetInt32();
                    }
                }

                return 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching cart count");
                return 0;
            }
        }
    }
}