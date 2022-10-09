using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace trafficgenerator
{
    public class Worker : BackgroundService
    {
        private readonly ILogger<Worker> _logger;
        
        private HttpClient _httpClient;
        private List<Pet> _allPets;
        private string _petSiteUrl;
        private string _petSearchUrl;

        public Worker(ILogger<Worker> logger, IConfiguration configuration)
        {
            _logger = logger;

            _httpClient = new HttpClient();
            _petSiteUrl = configuration["petsiteurl"];
            _petSearchUrl = configuration["searchapiurl"];
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    _logger.LogInformation("Worker running at: {time}", DateTimeOffset.Now);

                    await ThrowSomeTrafficIn();
                    await Task.Delay(20000, stoppingToken);
                }
                catch (Exception e)
                {
                    Console.WriteLine(e.Message);
                    _logger.LogCritical(e.Message);
                    await Task.Delay(100000, stoppingToken);
                }
            }
        }

        private async Task LoadPetData()
        {
          //  Console.WriteLine($"Search URL: {_petSearchUrl}");
          
          // Loads the Petdata from DynamoDB into memory
            _allPets = JsonSerializer.Deserialize<List<Pet>>(
                await _httpClient.GetStringAsync(_petSearchUrl));
        }

        private async Task ThrowSomeTrafficIn()
        {
            _logger.LogInformation("Synchronous Housekeeping call");
            // Performs housekeeping. Basically, reset the application data and gets ready for the execution cycle
            _httpClient.GetAsync(
                $"{_petSiteUrl}/housekeeping/").Wait();
            
            _logger.LogInformation("Starting Async LoadPetData");

            await LoadPetData();

            _logger.LogInformation($"Total number of pets - {_allPets.Count}");
            Random random = new Random();
            var loadSize = random.Next(5, _allPets.Count);

         //   Console.WriteLine($"PetSite URL: {_petSiteUrl}");

            if (loadSize > 20)
            {
                await _httpClient.DeleteAsync($"{_petSiteUrl}/pethistory/deletepetadoptionshistory");
                _logger.LogInformation("Deleted PetAdoptions History");
            }
            else
            {
                await _httpClient.GetAsync($"{_petSiteUrl}/pethistory");
            }

            
            for (int i = 0; i < loadSize; i++)
            {
                var currentPet = _allPets[random.Next(0, _allPets.Count - 1)];

             //   Console.WriteLine($"Searching: {_petSiteUrl}/?selectedPetType={currentPet.pettype}&selectedPetColor={currentPet.petcolor}");
                
             //Performs a search query   
             await _httpClient.GetAsync(
                    $"{_petSiteUrl}/?selectedPetType={currentPet.pettype}&selectedPetColor={currentPet.petcolor}");

             // Performs the "TakeMeHome" action on the current Pet in context  
             await _httpClient.PostAsync($"{_petSiteUrl}/Adoption/TakeMeHome",
                    new StringContent(
                        $"pettype={currentPet.pettype}&" +
                        $"petcolor={currentPet.petcolor}&" +
                        $"petid={currentPet.petid}",
                        Encoding.Default, "application/x-www-form-urlencoded"));

             // Completes adoption by making the payment
                await _httpClient.PostAsync($"{_petSiteUrl}/Payment/MakePayment",
                    new StringContent(
                        $"pettype={currentPet.pettype}&" +
                        $"petid={currentPet.petid}",
                        Encoding.Default, "application/x-www-form-urlencoded"));

                // Lists all adopted pets
                await _httpClient.GetAsync(
                    $"{_petSiteUrl}/PetListAdoptions");
            }


        }
    }
}