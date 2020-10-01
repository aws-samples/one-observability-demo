using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Amazon.XRay.Recorder.Core;
using Amazon.XRay.Recorder.Handlers.AwsSdk;
using Amazon.XRay.Recorder.Handlers.System.Net;
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

        private static HttpClient _httpClient =
            new HttpClient(new HttpClientXRayTracingHandler(new HttpClientHandler()));

        private static AmazonSQSClient _sqsClient;
        private static IConfiguration _configuration;

        //Prometheus metric to count the number of Pets adopted
        private static readonly Counter PetAdoptionCount =
            Metrics.CreateCounter("petsite_petadoptions_total", "Count the number of Pets adopted");

        public PaymentController(IConfiguration configuration)
        {
            AWSSDKHandler.RegisterXRayForAllServices();
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
            AWSXRayRecorder.Instance.AddMetadata("PetType", pettype);
            AWSXRayRecorder.Instance.AddMetadata("PetId", petId);

            ViewData["txStatus"] = "success";

            try
            {
                AWSXRayRecorder.Instance.BeginSubsegment("Call Payment API");

                Console.WriteLine(
                    $"[{AWSXRayRecorder.Instance.TraceContext.GetEntity().RootSegment.TraceId}][{AWSXRayRecorder.Instance.GetEntity().TraceId}] - Inside MakePayment Action method - PetId:{petId} - PetType:{pettype}");

                AWSXRayRecorder.Instance.AddAnnotation("PetId", petId);
                AWSXRayRecorder.Instance.AddAnnotation("PetType", pettype);

                var result = await PostTransaction(petId, pettype);
                AWSXRayRecorder.Instance.EndSubsegment();

                AWSXRayRecorder.Instance.BeginSubsegment("Post Message to SQS");
                var messageResponse = PostMessageToSqs(petId, pettype).Result;
                AWSXRayRecorder.Instance.EndSubsegment();

                AWSXRayRecorder.Instance.BeginSubsegment("Send Notification");
                var snsResponse = SendNotification(petId).Result;
                AWSXRayRecorder.Instance.EndSubsegment();

                if ("bunny" == pettype) // Only call StepFunction for "bunny" pettype to reduce number of invocations
                {
                   // Console.WriteLine($"STEPLOG- PETTYPE- {pettype}");
                    //   AWSXRayRecorder.Instance.BeginSubsegment("Start Step Function");
                    var stepFunctionResult = StartStepFunctionExecution(petId, pettype).Result;
                    //Console.WriteLine($"STEPLOG - RESPONSE - {stepFunctionResult.HttpStatusCode}");
                    //    AWSXRayRecorder.Instance.EndSubsegment();
                }

                //Increase purchase metric count
                PetAdoptionCount.Inc();
                return View("Index");
            }
            catch (Exception ex)
            {
                ViewData["txStatus"] = "failure";
                ViewData["error"] = ex.Message;
                AWSXRayRecorder.Instance.AddException(ex);
                return View("Index");
            }
        }

        private async Task<HttpResponseMessage> PostTransaction(string petId, string pettype)
        {
            return await _httpClient.PostAsync($"{_configuration["paymentapiurl"]}?petId={petId}&petType={pettype}",
                null);
        }

        private async Task<SendMessageResponse> PostMessageToSqs(string petId, string petType)
        {
            AWSSDKHandler.RegisterXRay<IAmazonSQS>();

            return await _sqsClient.SendMessageAsync(new SendMessageRequest()
            {
                MessageBody = JsonSerializer.Serialize($"{petId}-{petType}"),
                QueueUrl = _configuration["queueurl"]
            });
        }

        private async Task<StartExecutionResponse> StartStepFunctionExecution(string petId, string petType)
        {
            /*
             
             // Code to invoke StepFunction through API Gateway
             var stepFunctionInputModel = new StepFunctionInputModel()
            {
                input = JsonSerializer.Serialize(new SearchParams() {petid = petId, pettype = petType}),
                name = $"{petType}-{petId}-{Guid.NewGuid()}",
                stateMachineArn = _configuration["petadoptionsstepfnarn"]
            };
            
            var content = new StringContent(
                JsonSerializer.Serialize(stepFunctionInputModel),
                Encoding.UTF8,
                "application/json");

            return await _httpClient.PostAsync(_configuration["petadoptionsstepfnurl"], content);
            
            */
           // Console.WriteLine($"STEPLOG -ARN - {_configuration["petadoptionsstepfnarn"]}");
            //Console.WriteLine($"STEPLOG - SERIALIZE - {JsonSerializer.Serialize(new SearchParams() {petid = petId, pettype = petType})}");
            AWSSDKHandler.RegisterXRay<IAmazonStepFunctions>();
            return await new AmazonStepFunctionsClient().StartExecutionAsync(new StartExecutionRequest()
            {
                Input = JsonSerializer.Serialize(new SearchParams() {petid = petId, pettype = petType}),
                Name = $"{petType}-{petId}-{Guid.NewGuid()}",
                StateMachineArn = _configuration["petadoptionsstepfnarn"]
            });
        }

        private async Task<PublishResponse> SendNotification(string petId)
        {
            AWSSDKHandler.RegisterXRay<IAmazonService>();

            var snsClient = new AmazonSimpleNotificationServiceClient();
            return await snsClient.PublishAsync(topicArn: _configuration["snsarn"],
                message: $"PetId {petId} was adopted on {DateTime.Now}");
        }
    }
}