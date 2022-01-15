using System;
using Microsoft.AspNetCore.Mvc;
using Amazon.XRay.Recorder.Handlers.AwsSdk;
using System.Net;
using Amazon.XRay.Recorder.Core;
using Microsoft.Extensions.Configuration;

// unused imports
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using PetSite.Models;
using System.Net.Http;
using System.Web;
using Amazon.XRay.Recorder.Handlers.System.Net;
using System.Text.Json;
using Amazon;
using PetSite.ViewModels;
using Microsoft.AspNetCore.Mvc.Rendering;

// todo: these need to use the proper x-ray-wrapped calls to petfood and petfood-metric

namespace PetSite.Controllers
{
    public class PetFoodController : Controller
    {
        
        public PetFoodController(IConfiguration configuration)
        
        {
            AWSSDKHandler.RegisterXRayForAllServices();
        }

        [HttpGet("/petfood")]
        public string PetFoodMethod()
        {
            AWSXRayRecorder.Instance.BeginSubsegment("Calling PetFood");
            Console.WriteLine($"[{AWSXRayRecorder.Instance.GetEntity().TraceId}][{AWSXRayRecorder.Instance.TraceContext.GetEntity().RootSegment.TraceId}] - Calling PetFood");

            WebClient client = new WebClient();
            string downloadString = client.DownloadString("http://petfood");
            
            AWSXRayRecorder.Instance.EndSubsegment();

            return downloadString;
        }

        ///stubbing with simple http client for now, needs to have params pulled from URL path still
        [HttpGet("/petfood-metric/{entityId}/{value}")]
        public string PetFoodMetric(string entityId, float value)
        {
            AWSXRayRecorder.Instance.BeginSubsegment("Calling PetFood metric");

            WebClient client = new WebClient();
            string downloadString = client.DownloadString("http://petfood-metric/metric/" + entityId + "/" + value.ToString());
            Console.WriteLine("Calling: " + "http://petfood-metric/metric/" + entityId + "/" + value.ToString());
            Console.WriteLine($"[{AWSXRayRecorder.Instance.GetEntity().TraceId}][{AWSXRayRecorder.Instance.TraceContext.GetEntity().RootSegment.TraceId}] - Calling PetFood metric");
            
            AWSXRayRecorder.Instance.EndSubsegment();
            
            return downloadString;
        }

    }
}