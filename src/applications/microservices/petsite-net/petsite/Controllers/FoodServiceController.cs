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
using PetSite.Configuration;

namespace PetSite.Controllers
{
    public class FoodServiceController : BaseController
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<FoodServiceController> _logger;
        private readonly ParameterRefreshManager _refreshManager;

        public FoodServiceController(IHttpClientFactory httpClientFactory, IConfiguration configuration,
            ILogger<FoodServiceController> logger, ParameterRefreshManager refreshManager)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
            _refreshManager = refreshManager;
        }

        [HttpGet]
        public async Task<IActionResult> Index([FromQuery] string userId, string petType)
        {
            if (EnsureUserId()) return new EmptyResult();

            ViewBag.PetType = petType;

            try
            {
                using var httpClient = _httpClientFactory.CreateClient();
                var foodApiUrl = await ParameterNames.GetParameterValueAsync(ParameterNames.FOOD_API_URL, _refreshManager);
                var url = UrlHelper.BuildUrl(foodApiUrl, null, ("pettype", petType));
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
                var cartApiUrl = await ParameterNames.GetParameterValueAsync(ParameterNames.CART_API_URL, _refreshManager);
                var addToCartUrl = UrlHelper.BuildUrl(cartApiUrl, new[] {  userId, "items" }, null);
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
                var cartApiUrl = await ParameterNames.GetParameterValueAsync(ParameterNames.CART_API_URL, _refreshManager);
                var getCartUrl = UrlHelper.BuildUrl(cartApiUrl, new[] { userId }, null);
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
