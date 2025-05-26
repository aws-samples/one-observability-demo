using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Amazon.SQS;
using Amazon.SQS.Model;
using System.Text.Json.Serialization;
using System.Text.Json;
using Amazon;
using Amazon.Runtime;
using Amazon.SimpleNotificationService;
using Amazon.SimpleNotificationService.Model;
using Amazon.StepFunctions;
using Amazon.StepFunctions.Model;
using Microsoft.Extensions.Configuration;
using PetSite.Models;
using Prometheus;
using Newtonsoft;

namespace PetSite.Controllers
{
    public class PaymentController : Controller
    {
        private static string _txStatus = String.Empty;

        private static HttpClient _httpClient = new HttpClient();
        private static AmazonSQSClient _sqsClient;
        private static IConfiguration _configuration;

        //Prometheus metric to count the number of Pets adopted
        private static readonly Counter PetAdoptionCount =
            Metrics.CreateCounter("petsite_petadoptions_total", "Count the number of Pets adopted");

        public PaymentController(IConfiguration configuration)
        {
            _configuration = configuration;
            _sqsClient = new AmazonSQSClient(Amazon.Util.EC2InstanceMetadata.Region);
        }

        // GET: Payment
        [HttpGet]
        private ActionResult Index()
        {
            return View();
        }

        // POST: Payment/MakePayment
        [HttpPost]
        // [ValidateAntiForgeryToken]
        public async Task<IActionResult> MakePayment(string petId, string pettype)
        {
            // Add custom span attributes using Activity API
            var currentActivity = Activity.Current;
            if (currentActivity != null)
            {
                currentActivity.SetTag("pet.id", petId);
                currentActivity.SetTag("pet.type", pettype);
                
                Console.WriteLine($"Inside MakePayment Action method - PetId:{petId} - PetType:{pettype}");
            }

            ViewData["txStatus"] = "success";

            try
            {
                // Create a new activity for the Payment API call
                using (var activity = new Activity("Call Payment API").Start())
                {
                    if (activity != null)
                    {
                        activity.SetTag("pet.id", petId);
                        activity.SetTag("pet.type", pettype);
                    }
                    
                    var result = await PostTransaction(petId, pettype);
                }

                // Create a new activity for SQS message
                using (var activity = new Activity("Post Message to SQS").Start())
                {
                    if (activity != null)
                    {
                        activity.SetTag("pet.id", petId);
                        activity.SetTag("pet.type", pettype);
                    }
                    
                    var messageResponse = await PostMessageToSqs(petId, pettype);
                }

                // Create a new activity for SNS notification
                using (var activity = new Activity("Send Notification").Start())
                {
                    if (activity != null)
                    {
                        activity.SetTag("pet.id", petId);
                        activity.SetTag("pet.type", pettype);
                    }
                    
                    var snsResponse = await SendNotification(petId);
                }

                if ("bunny" == pettype) // Only call StepFunction for "bunny" pettype to reduce number of invocations
                {
                    // Create a new activity for Step Function execution
                    using (var activity = new Activity("Start Step Function").Start())
                    {
                        if (activity != null)
                        {
                            activity.SetTag("pet.id", petId);
                            activity.SetTag("pet.type", pettype);
                        }
                        
                        var stepFunctionResult = await StartStepFunctionExecution(petId, pettype);
                    }
                }

                //Increase purchase metric count
                PetAdoptionCount.Inc();
                return View("Index");
            }
            catch (Exception ex)
            {
                ViewData["txStatus"] = "failure";
                ViewData["error"] = ex.Message;
                
                // Log the exception
                Console.WriteLine($"Error in MakePayment: {ex.Message}");
                
                return View("Index");
            }
        }

        private async Task<HttpResponseMessage> PostTransaction(string petId, string pettype)
        {
            return await _httpClient.PostAsync($"{SystemsManagerConfigurationProviderWithReloadExtensions.GetConfiguration(_configuration,"paymentapiurl")}?petId={petId}&petType={pettype}",
                null);
        }

        private async Task<SendMessageResponse> PostMessageToSqs(string petId, string petType)
        {
            return await _sqsClient.SendMessageAsync(new SendMessageRequest()
            {
                MessageBody = JsonSerializer.Serialize($"{petId}-{petType}"),
                QueueUrl = SystemsManagerConfigurationProviderWithReloadExtensions.GetConfiguration(_configuration,"queueurl")
            });
        }

        private async Task<StartExecutionResponse> StartStepFunctionExecution(string petId, string petType)
        {
            return await new AmazonStepFunctionsClient().StartExecutionAsync(new StartExecutionRequest()
            {
                Input = JsonSerializer.Serialize(new SearchParams() {petid = petId, pettype = petType}),
                Name = $"{petType}-{petId}-{Guid.NewGuid()}",
                StateMachineArn = SystemsManagerConfigurationProviderWithReloadExtensions.GetConfiguration(_configuration,"petadoptionsstepfnarn")
            });
        }

        private async Task<PublishResponse> SendNotification(string petId)
        {
            var snsClient = new AmazonSimpleNotificationServiceClient();
            return await snsClient.PublishAsync(topicArn: _configuration["snsarn"],
                message: $"PetId {petId} was adopted on {DateTime.Now}");
        }
    }
}
