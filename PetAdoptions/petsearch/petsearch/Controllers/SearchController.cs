using System;
using System.Text.Json;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.DocumentModel;
using Amazon.DynamoDBv2.Model;
using Amazon;

using Amazon.S3;
using Amazon.S3.Model;
using Amazon.XRay.Recorder.Handlers.AwsSdk;
using Amazon.XRay.Recorder.Core;
using System.Threading;

using System.Text;
using System.Net.Http;
using System.ComponentModel;

namespace PetSearch.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class SearchController : ControllerBase
    {
        private static IAmazonDynamoDB ddbClient;
        private static IAmazonS3 s3Client;

        private static IConfiguration _configuration;

        public SearchController(IConfiguration configuration)
        {
            _configuration = configuration;

            AWSSDKHandler.RegisterXRayForAllServices();
            ddbClient = new AmazonDynamoDBClient();
            AWSConfigsS3.UseSignatureVersion4 = true;
            s3Client = new AmazonS3Client();
        }

        private static Func<string, string, string> GetPetURL = (pettype, petid) =>
        {
            AWSSDKHandler.RegisterXRay<IAmazonS3>();

            string _urlString;

            string GetFolderName()
            {
                switch (pettype)
                {
                    case "bunny":
                        return "bunnies";
                    case "puppy":
                        return "puppies";
                    default:
                        return "kitten";
                }
            }

            try
            {
                if (new Random().Next(1, 10) == 4)
                    s3Client.EnsureBucketExistsAsync($"test-{_configuration["s3bucketname"]}");

                _urlString = s3Client.GetPreSignedURL(new GetPreSignedUrlRequest
                {
                    BucketName = _configuration["s3bucketname"],
                    Key = $"{GetFolderName()}/{petid}.jpg",
                    Expires = DateTime.Now.AddMinutes(5)
                });
            }
            catch (AmazonS3Exception e)
            {
                Console.WriteLine($"[{AWSXRayRecorder.Instance.GetEntity().TraceId}] - Error in accessing S3 bucket-{e.Message}");
                AWSXRayRecorder.Instance.AddException(e);
                throw e;
            }
            catch (Exception e)
            {
                Console.WriteLine($"[{AWSXRayRecorder.Instance.GetEntity().TraceId}] - Error-{e.Message}");
                AWSXRayRecorder.Instance.AddException(e);
                throw e;
            }
            return _urlString;
        };

        private Func<List<Dictionary<string, AttributeValue>>, string> BuildPets = (resultItems) =>
        {
            var Pets = new List<Pet>();

            resultItems.ForEach(item => Pets.Add(new Pet()
            {
                petid = item["petid"].S,
                availability = item["availability"].S,
                cuteness_rate = item["cuteness_rate"].S,
                petcolor = item["petcolor"].S,
                pettype = item["pettype"].S,
                price = item["price"].S,
                peturl = GetPetURL(item["pettype"].S, item["image"].S)
            }));

            AWSXRayRecorder.Instance.AddMetadata("Pets", System.Text.Json.JsonSerializer.Serialize(Pets));

            Console.WriteLine($"[{AWSXRayRecorder.Instance.GetEntity().TraceId}] - {JsonSerializer.Serialize(Pets)}");

            return JsonSerializer.Serialize(Pets);
        };

        // Usage - GET: /api/search?pettype=puppy&petcolor=brown&petid=001
        [HttpGet]
        public async Task<string> Get([FromQuery] SearchParams searchParams)
        {
            try
            {
                AWSXRayRecorder.Instance.BeginSubsegment("Scanning DynamoDB Table");

                ScanFilter scanFilter = new ScanFilter();

                if (!String.IsNullOrEmpty(searchParams.petcolor)) scanFilter.AddCondition("petcolor", ScanOperator.Equal, searchParams.petcolor);
                if (!String.IsNullOrEmpty(searchParams.pettype)) scanFilter.AddCondition("pettype", ScanOperator.Equal, searchParams.pettype);
                if (!String.IsNullOrEmpty(searchParams.petid)) scanFilter.AddCondition("petid", ScanOperator.Equal, searchParams.petid);

                var scanquery = new ScanRequest
                {
                    TableName = _configuration["dynamodbtablename"],
                    ScanFilter = scanFilter.ToConditions()
                };

                // This line is intentional. Delays searches 
                if (!String.IsNullOrEmpty(searchParams.pettype) && searchParams.pettype == "bunny") Thread.Sleep(3000);


                AWSXRayRecorder.Instance.AddAnnotation("Query", $"petcolor:{searchParams.petcolor}-pettype:{searchParams.pettype}-petid:{searchParams.petid}");
                Console.WriteLine($"[{AWSXRayRecorder.Instance.GetEntity().TraceId}] - {searchParams}");

                var response = await ddbClient.ScanAsync(scanquery);
                AWSXRayRecorder.Instance.EndSubsegment();
                return BuildPets(response.Items);
            }
            catch (Exception e)
            {
                return e.Message;
            }
        }
    }
}
