using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using System;
using System.Net.Http;
using System.Threading.Tasks;
using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace PetSite.Controllers;

public class PetHistoryController : Controller
{
    private IConfiguration _configuration;
    private readonly ILogger<HomeController> _logger;
    private static HttpClient _httpClient;
    private static string _pethistoryurl;
    
    public PetHistoryController(IConfiguration configuration)
    {
        _configuration = configuration;
        _httpClient = new HttpClient();
        
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
            // Create a new activity for the API call
            using (var activity = new Activity("Calling GetPetAdoptionsHistory").Start())
            {
                ViewData["pethistory"] = await _httpClient.GetStringAsync($"{_pethistoryurl}/api/home/transactions");
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
            // Create a new activity for the API call
            using (var activity = new Activity("Calling DeletePetAdoptionsHistory").Start())
            {
                ViewData["pethistory"] = await _httpClient.DeleteAsync($"{_pethistoryurl}/api/home/transactions");
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
