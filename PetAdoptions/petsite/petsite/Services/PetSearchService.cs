using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Http;
using PetSite.Models;
using PetSite.ViewModels;
using Prometheus;

namespace PetSite.Services
{
    public interface IPetSearchService
    {
        Task<List<Pet>> GetPetDetails(string pettype, string petcolor, string petid);
    }

    public class PetSearchService : IPetSearchService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<PetSearchService> _logger;

        //Prometheus metrics
        private static readonly Counter PetSearchCount =
            Metrics.CreateCounter("petsite_petsearches_total", "Count the number of searches performed");
        private static readonly Counter PuppySearchCount =
            Metrics.CreateCounter("petsite_pet_puppy_searches_total", "Count the number of puppy searches performed");
        private static readonly Counter KittenSearchCount =
            Metrics.CreateCounter("petsite_pet_kitten_searches_total", "Count the number of kitten searches performed");
        private static readonly Counter BunnySearchCount =
            Metrics.CreateCounter("petsite_pet_bunny_searches_total", "Count the number of bunny searches performed");

        private readonly Microsoft.AspNetCore.Http.IHttpContextAccessor _httpContextAccessor;

        public PetSearchService(IHttpClientFactory httpClientFactory, IConfiguration configuration, ILogger<PetSearchService> logger, Microsoft.AspNetCore.Http.IHttpContextAccessor httpContextAccessor)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
            _httpContextAccessor = httpContextAccessor;
        }

        public async Task<List<Pet>> GetPetDetails(string pettype, string petcolor, string petid)
        {
            string searchUri = string.Empty;

            if (!String.IsNullOrEmpty(pettype) && pettype != "all") searchUri = $"pettype={pettype}";
            if (!String.IsNullOrEmpty(petcolor) && petcolor != "all") searchUri = $"&{searchUri}&petcolor={petcolor}";
            if (!String.IsNullOrEmpty(petid) && petid != "all") searchUri = $"&{searchUri}&petid={petid}";

            switch (pettype)
            {
                case "puppy":
                    PuppySearchCount.Inc();
                    PetSearchCount.Inc();
                    break;
                case "kitten":
                    KittenSearchCount.Inc();
                    PetSearchCount.Inc();
                    break;
                case "bunny":
                    BunnySearchCount.Inc();
                    PetSearchCount.Inc();
                    break;
            }
            
            string searchapiurl = _configuration["searchapiurl"];
            using var httpClient = _httpClientFactory.CreateClient();
            httpClient.Timeout = TimeSpan.FromSeconds(30);
            
            try
            {
                var userId = _httpContextAccessor.HttpContext?.Session.GetString("userId") ?? "unknown";
                var separator = string.IsNullOrEmpty(searchUri) ? "?" : "&";
                
                _logger.LogInformation($"Calling the PetSearch API with: {searchapiurl}{searchUri}{separator}userId={userId}");
                
                var response = await httpClient.GetAsync($"{searchapiurl}{searchUri}{separator}userId={userId}");
                if (!response.IsSuccessStatusCode)
                {
                    var responseContent = await response.Content.ReadAsStringAsync();
                    throw new HttpRequestException($"HTTP {(int)response.StatusCode} {response.StatusCode}: {response.ReasonPhrase}. Response: {responseContent}");
                }

                var jsonContent = await response.Content.ReadAsStringAsync();
                
                _logger.LogInformation($"PetSearch API responded with: {jsonContent}");
                
                if (string.IsNullOrEmpty(jsonContent))
                    return new List<Pet>();

                return JsonSerializer.Deserialize<List<Pet>>(jsonContent) ?? new List<Pet>();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Exception occurred while fetching pet details.");
                throw ex;
            }
        }
    }
}