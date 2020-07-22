using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Amazon.XRay.Recorder.Core;
using Amazon.XRay.Recorder.Handlers.AwsSdk;
using Amazon.XRay.Recorder.Handlers.SqlServer;
using Amazon.XRay.Recorder.Handlers.System.Net;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

namespace PetListAdoptions.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AdoptionListController : Controller
    {
        private static IConfiguration _configuration;
        private static SqlConnection _sqlConnection = new SqlConnection();
        private static HttpClient httpClient;

        public AdoptionListController(IConfiguration configuration)
        {
            _configuration = configuration;
            httpClient = new HttpClient(new HttpClientXRayTracingHandler(new HttpClientHandler()));

            AWSSDKHandler.RegisterXRayForAllServices();
        }

        // GET
        [HttpGet]
        public async Task<IEnumerable<AdoptionItem>> Get()
        {
            List<AdoptionItem> adoptionItems = new List<AdoptionItem>();

            try
            {
                AWSXRayRecorder.Instance.BeginSubsegment("Fetching adoption list");

                _sqlConnection.ConnectionString = _configuration["rdsconnectionstring"];

                var sqlCommandText = $"SELECT TOP 25 * FROM [dbo].[transactions]";

                Console.WriteLine(
                    $"[{AWSXRayRecorder.Instance.TraceContext.GetEntity().RootSegment.TraceId}] - Fetching transaction data from RDS. {sqlCommandText}");

                AWSXRayRecorder.Instance.AddMetadata("Query", sqlCommandText);
                using (_sqlConnection)
                {
                    var command = new TraceableSqlCommand(sqlCommandText, _sqlConnection);

                    command.Connection.Open();

                    using (SqlDataReader reader = await command.ExecuteReaderAsync())
                    {
                        while (await reader.ReadAsync())
                        {
                            var petItem =
                                await httpClient.GetStringAsync(
                                    $"{_configuration["searchapiurl"]}&petid={reader.GetValue(1)}");
                            var adoptionItem = JsonSerializer.Deserialize<List<AdoptionItem>>(petItem).FirstOrDefault();

                            if (adoptionItem != null)
                            {
                                adoptionItem.transactionid = reader.GetValue(3).ToString();
                                adoptionItem.adoptiondate = reader.GetValue(2).ToString();
                            }

                            adoptionItems.Add(adoptionItem);
                        }
                    }
                }
            }
            catch (Exception e)
            {
                Console.WriteLine($"EXCEPTION - {e.Message}");
                AWSXRayRecorder.Instance.AddException(e);
            }
            finally
            {
                AWSXRayRecorder.Instance.EndSubsegment();
            }

            return adoptionItems;
        }
    }
}