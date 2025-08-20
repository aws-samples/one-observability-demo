using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text;
using System.Text.Json;
using PetSite.Helpers;
using PetSite.ViewModels;
using System;

namespace PetSite.Controllers
{
    public class CheckoutController : BaseController
    {
        private readonly ILogger<CheckoutController> _logger;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;

        public CheckoutController(ILogger<CheckoutController> logger, IHttpClientFactory httpClientFactory, IConfiguration configuration)
        {
            _logger = logger;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
        }

        [HttpGet]
        public async Task<ActionResult> Index([FromQuery] string userId)
        {
            if (EnsureUserId()) return new EmptyResult();

            try
            {
                using var httpClient = _httpClientFactory.CreateClient();
                var cartUrl = UrlHelper.BuildUrl(_configuration["foodapiurl"], new[]{"api","cart", userId}, null);
                var response = await httpClient.GetAsync(cartUrl);
                response.EnsureSuccessStatusCode();

                var jsonContent = await response.Content.ReadAsStringAsync();
                var cartData = JsonSerializer.Deserialize<CartResponse>(jsonContent, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                return View(cartData);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching cart data");
                ViewBag.ErrorMessage = $"Unable to load cart data at this time. Please try again later.\nError message: {ex.Message}";
                return View("Error", new PetSite.Models.ErrorViewModel { RequestId = System.Diagnostics.Activity.Current?.Id ?? HttpContext.TraceIdentifier });
            }
        }
        
        [HttpPost]
        public async Task<IActionResult> PayAndCheckOut([FromBody] JsonElement requestData)
        {
            string userId = string.Empty;
            try
            {
                userId = requestData.GetProperty("userId").GetString();
                
                using var httpClient = _httpClientFactory.CreateClient();
                var paymentUrl = UrlHelper.BuildUrl(_configuration["foodapiurl"], new[] { "api", "cart", userId, "checkout" }, null);
                var jsonContent = new StringContent(requestData.GetRawText(), Encoding.UTF8, "application/json");
                
                var response = await httpClient.PostAsync(paymentUrl, jsonContent);
                
                if (response.StatusCode == System.Net.HttpStatusCode.OK)
                {
                    var responseContent = await response.Content.ReadAsStringAsync();
                    var orderData = JsonSerializer.Deserialize<JsonElement>(responseContent);
                    
                    // Clear cart after successful payment
                    try
                    {
                        var clearCartUrl = UrlHelper.BuildUrl(_configuration["foodapiurl"], new[] { "api", "cart", userId }, null);
                        await httpClient.DeleteAsync(clearCartUrl);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to clear cart after successful payment");
                    }
                    
                    return Ok(new { 
                        success = true,
                        orderId = orderData.GetProperty("order_id").GetString(),
                        status = orderData.GetProperty("status").GetString(),
                        createdDate = DateTime.Parse(orderData.GetProperty("created_at").GetString()).ToString("MM/dd/yyyy"),
                        deliveryDate = DateTime.Parse(orderData.GetProperty("estimated_delivery").GetString()).ToString("MM/dd/yyyy")
                    });
                }

                return BadRequest($"Payment failed for user: {userId}. Failure reason:{response.ReasonPhrase}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Payment failed for user: {userId}");
                return BadRequest($"Payment processing failed. Please try again.\nError: {ex.Message}");
            }
        }
    }
}