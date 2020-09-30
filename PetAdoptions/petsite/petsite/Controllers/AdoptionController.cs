using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Amazon.XRay.Recorder.Core;
using Amazon.XRay.Recorder.Handlers.AwsSdk;
using Amazon.XRay.Recorder.Handlers.System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using PetSite.ViewModels;

namespace PetSite.Controllers
{
    public class AdoptionController : Controller
    {
        private static readonly HttpClient HttpClient = new HttpClient(new HttpClientXRayTracingHandler(new HttpClientHandler()));
        private static Variety _variety = new Variety();
        private static SystemsManagerConfigurationProviderWithReloadExtensions _configuration;

        private static string _searchApiurl;

        public AdoptionController(IConfiguration configuration)
        {
            _configuration = (SystemsManagerConfigurationProviderWithReloadExtensions)configuration;
            
            //_searchApiurl = _configuration["searchapiurl"];
            _searchApiurl = _configuration.GetConfiguration("searchapiurl");
           
            AWSSDKHandler.RegisterXRayForAllServices();
        }
        // GET: Adoption
        [HttpGet]
        public IActionResult Index([FromQuery] Pet pet)
        {
            return View(pet);
        }
        private async Task<string> GetPetDetails(SearchParams searchParams)
        {
            string searchString = string.Empty;

            if (!String.IsNullOrEmpty(searchParams.pettype) && searchParams.pettype != "all") searchString = $"pettype={searchParams.pettype}";
            if (!String.IsNullOrEmpty(searchParams.petcolor) && searchParams.petcolor != "all") searchString = $"&{searchString}&petcolor={searchParams.petcolor}";
            if (!String.IsNullOrEmpty(searchParams.petid) && searchParams.petid != "all") searchString = $"&{searchString}&petid={searchParams.petid}";

            return await HttpClient.GetStringAsync($"{_searchApiurl}{searchString}");
        }

        [HttpPost]
        public async Task<IActionResult> TakeMeHome([FromForm] SearchParams searchParams)
        {

             Console.WriteLine(
                $"[{AWSXRayRecorder.Instance.TraceContext.GetEntity().RootSegment.TraceId}][{AWSXRayRecorder.Instance.GetEntity().TraceId}] - Inside TakeMehome. Pet in context - PetId:{searchParams.petid}, PetType:{searchParams.pettype}, PetColor:{searchParams.petcolor}");
              

            AWSXRayRecorder.Instance.AddMetadata("PetType", searchParams.pettype);
            AWSXRayRecorder.Instance.AddMetadata("PetId", searchParams.petid);
            AWSXRayRecorder.Instance.AddMetadata("PetColor", searchParams.petcolor);
            
            //String traceId = TraceId.NewId(); // This function is present in : Amazon.XRay.Recorder.Core.Internal.Entities
            AWSXRayRecorder.Instance
                .BeginSubsegment("Calling Search API"); // custom traceId used while creating segment
            string result;

            try
            {
                result = await GetPetDetails(searchParams);
            }
            catch (Exception e)
            {
                AWSXRayRecorder.Instance.AddException(e);
                throw e;
            }
            finally
            {
                AWSXRayRecorder.Instance.EndSubsegment();
            }

            return View("Index", JsonSerializer.Deserialize<List<Pet>>(result).FirstOrDefault());
        }
    }
}