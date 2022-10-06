using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using System;
using System.Net.Http;
using System.Threading.Tasks;
using Amazon.XRay.Recorder.Core;
using Amazon.XRay.Recorder.Handlers.System.Net;
using Amazon.XRay.Recorder.Handlers.AwsSdk;
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
        AWSSDKHandler.RegisterXRayForAllServices();
        _configuration = configuration;
        _httpClient = new HttpClient(new HttpClientXRayTracingHandler(new HttpClientHandler()));
        
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
        AWSXRayRecorder.Instance.BeginSubsegment("Calling GetPetAdoptionsHistory");
        ViewData["pethistory"] = await _httpClient.GetStringAsync($"{_pethistoryurl}/api/home/transactions");
        AWSXRayRecorder.Instance.EndSubsegment();
        return View();
    }

    /// <summary>
    /// DELETE:/deletepetadoptionshistory
    /// </summary>
    /// <returns></returns>
    [HttpDelete]
    public async Task<IActionResult> DeletePetAdoptionsHistory()
    {
        AWSXRayRecorder.Instance.BeginSubsegment("Calling DeletePetAdoptionsHistory");
        ViewData["pethistory"] = await _httpClient.DeleteAsync($"{_pethistoryurl}/api/home/transactions");
        AWSXRayRecorder.Instance.EndSubsegment();
        return View("Index");
    }
    
}