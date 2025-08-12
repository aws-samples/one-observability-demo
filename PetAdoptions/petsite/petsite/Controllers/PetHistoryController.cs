using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using System;
using System.Net.Http;
using System.Threading.Tasks;
using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Http;

namespace PetSite.Controllers;

public class PetHistoryController : Controller
{
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;
    private static string _pethistoryurl;
    
    public PetHistoryController(IConfiguration configuration, IHttpClientFactory httpClientFactory)
    {
        _configuration = configuration;
        _httpClientFactory = httpClientFactory;
        
        _pethistoryurl = _configuration["pethistoryurl"];
        //string _pethistoryurl = SystemsManagerConfigurationProviderWithReloadExtensions.GetConfiguration(_configuration,"pethistoryurl");
    }
    
    /// <summary>
    /// GET:/pethistory
    /// </summary>
    /// <returns></returns>
    [HttpGet]
    public async Task<IActionResult> Index()
    {
        // Add custom span attributes using Activity API
        var currentActivity = Activity.Current;
        if (currentActivity != null)
        {
            currentActivity.SetTag("operation", "GetPetAdoptionsHistory");
        }
        
        try
        {
            // Begin activity span to track GetPetAdoptionsHistory API call
            using (var activity = Activity.Current?.Source?.StartActivity("Calling GetPetAdoptionsHistory API"))
            {
                using var httpClient = _httpClientFactory.CreateClient();
                var userId = HttpContext.Session.GetString("userId") ?? "unknown";
                ViewData["pethistory"] = await httpClient.GetStringAsync($"{_pethistoryurl}/api/home/transactions?userId={userId}");
            }
        }
        catch (Exception e)
        {
            Console.WriteLine($"Error calling GetPetAdoptionsHistory: {e.Message}");
            throw;
        }
        
        return View();
    }

    /// <summary>
    /// DELETE:/deletepetadoptionshistory
    /// </summary>
    /// <returns></returns>
    [HttpDelete]
    public async Task<IActionResult> DeletePetAdoptionsHistory()
    {
        // Add custom span attributes using Activity API
        var currentActivity = Activity.Current;
        if (currentActivity != null)
        {
            currentActivity.SetTag("operation", "DeletePetAdoptionsHistory");
        }
        
        try
        {
            // Begin activity span to track DeletePetAdoptionsHistory API call
            using (var activity = Activity.Current?.Source?.StartActivity("Calling DeletePetAdoptionsHistory API"))
            {
                using var httpClient = _httpClientFactory.CreateClient();
                var userId = HttpContext.Session.GetString("userId") ?? "unknown";
                ViewData["pethistory"] = await httpClient.DeleteAsync($"{_pethistoryurl}/api/home/transactions?userId={userId}");
            }
        }
        catch (Exception e)
        {
            Console.WriteLine($"Error calling DeletePetAdoptionsHistory: {e.Message}");
            throw;
        }
        
        return View("Index");
    }
}
