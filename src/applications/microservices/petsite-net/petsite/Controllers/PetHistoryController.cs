using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using System;
using System.Net.Http;
using System.Threading.Tasks;
using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Http;
using PetSite.Helpers;
using PetSite.Configuration;

namespace PetSite.Controllers;

public class PetHistoryController : BaseController
{
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ParameterRefreshManager _refreshManager;

    public PetHistoryController(IConfiguration configuration, IHttpClientFactory httpClientFactory, ParameterRefreshManager refreshManager)
    {
        _configuration = configuration;
        _httpClientFactory = httpClientFactory;
        _refreshManager = refreshManager;
    }

    /// <summary>
    /// GET:/pethistory
    /// </summary>
    /// <returns></returns>
    [HttpGet]
    public async Task<IActionResult> Index()
    {
        if (EnsureUserId()) return new EmptyResult();
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
                var userId = ViewBag.UserId?.ToString() ?? "unknown";
                var pethistoryurl = await ParameterNames.GetParameterValueAsync(ParameterNames.PET_HISTORY_URL, _refreshManager);
                var url = UrlHelper.BuildUrl($"{pethistoryurl}/api/home/transactions", null, ("userId", userId));
                ViewData["pethistory"] = await httpClient.GetStringAsync(url);
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
        if (EnsureUserId()) return new EmptyResult();
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
                var userId = ViewBag.UserId?.ToString() ?? "unknown";
                var pethistoryurl = await ParameterNames.GetParameterValueAsync(ParameterNames.PET_HISTORY_URL, _refreshManager);
                var url = UrlHelper.BuildUrl($"{pethistoryurl}/api/home/transactions", null, ("userId", userId));
                ViewData["pethistory"] = await httpClient.DeleteAsync(url);
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
