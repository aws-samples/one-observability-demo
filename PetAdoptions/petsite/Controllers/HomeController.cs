﻿using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using PetSite.Models;
using Amazon.XRay.Recorder.Handlers.AwsSdk;
using System.Net.Http;
using Amazon.XRay.Recorder.Handlers.System.Net;
using Amazon.XRay.Recorder.Core;
using System.Text.Json;
using Amazon;
using PetSite.ViewModels;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.Extensions.Configuration;
using Prometheus;

namespace PetSite.Controllers
{
    public class HomeController : Controller
    {
        private readonly ILogger<HomeController> _logger;
        private static HttpClient _httpClient;
        private static Variety _variety = new Variety();

        private IConfiguration _configuration;

        //Prometheus metric to count the number of searches performed
        private static readonly Counter PetSearchCount =
            Metrics.CreateCounter("petsite_petsearches_total", "Count the number of searches performed");

        //Prometheus metric to count the number of puppy searches performed
        private static readonly Counter PuppySearchCount =
            Metrics.CreateCounter("petsite_pet_puppy_searches_total", "Count the number of puppy searches performed");

        //Prometheus metric to count the number of kitten searches performed
        private static readonly Counter KittenSearchCount =
            Metrics.CreateCounter("petsite_pet_kitten_searches_total", "Count the number of kitten searches performed");

        //Prometheus metric to count the number of bunny searches performed
        private static readonly Counter BunnySearchCount =
            Metrics.CreateCounter("petsite_pet_bunny_searches_total", "Count the number of bunny searches performed");

        private static readonly Gauge PetsWaitingForAdoption = Metrics
            .CreateGauge("petsite_pets_waiting_for_adoption", "Number of pets waiting for adoption.");

        public HomeController(ILogger<HomeController> logger, IConfiguration configuration)
        {
            AWSXRayRecorder.RegisterLogger(LoggingOptions.Console);
            _configuration = configuration;
            AWSSDKHandler.RegisterXRayForAllServices();

            _httpClient = new HttpClient(new HttpClientXRayTracingHandler(new HttpClientHandler()));
            _logger = logger;

            _variety.PetTypes = new List<SelectListItem>()
            {
                new SelectListItem() {Value = "all", Text = "All"},
                new SelectListItem() {Value = "puppy", Text = "Puppy"},
                new SelectListItem() {Value = "kitten", Text = "Kitten"},
                new SelectListItem() {Value = "bunny", Text = "Bunny"}
            };

            _variety.PetColors = new List<SelectListItem>()
            {
                new SelectListItem() {Value = "all", Text = "All"},
                new SelectListItem() {Value = "brown", Text = "Brown"},
                new SelectListItem() {Value = "black", Text = "Black"},
                new SelectListItem() {Value = "white", Text = "White"}
            };
        }

        private async Task<string> GetPetDetails(string pettype, string petcolor, string petid)
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
            //string searchapiurl = _configuration["searchapiurl"];
            string searchapiurl = SystemsManagerConfigurationProviderWithReloadExtensions.GetConfiguration(_configuration,"searchapiurl");
            return await _httpClient.GetStringAsync($"{searchapiurl}{searchUri}");
        }

        [HttpGet("housekeeping")]
        public async Task<IActionResult> HouseKeeping()
        {
             Console.WriteLine(
                $"[{AWSXRayRecorder.Instance.TraceContext.GetEntity().RootSegment.TraceId}][{AWSXRayRecorder.Instance.GetEntity().TraceId}] - In Housekeeping, trying to reset the app.");
                
            /*var result = await GetPetDetails(null, null, null);
            var Pets = JsonSerializer.Deserialize<List<Pet>>(result);

            var searchParams = new SearchParams();
            
            //string updateadoptionstatusurl = _configuration["updateadoptionstatusurl"];
            string updateadoptionstatusurl = SystemsManagerConfigurationProviderWithReloadExtensions.GetConfiguration(_configuration,"updateadoptionstatusurl");
                  

            foreach (var pet in Pets.Where(item => item.availability == "no"))
            {
                searchParams.pettype = pet.pettype;
                searchParams.petid = pet.petid;
                searchParams.petavailability = "yes";

                StringContent putData = new StringContent(JsonSerializer.Serialize(searchParams));
                await _httpClient.PutAsync(updateadoptionstatusurl, putData);
            }*/
            
            //string cleanupadoptionsurl = _configuration["cleanupadoptionsurl"];
            string cleanupadoptionsurl = SystemsManagerConfigurationProviderWithReloadExtensions.GetConfiguration(_configuration,"cleanupadoptionsurl");
            
            await _httpClient.PostAsync(cleanupadoptionsurl, null);

            return View();
        }

        [HttpGet]
        public async Task<IActionResult> Index(string selectedPetType, string selectedPetColor, string petid)
        {
            Console.WriteLine(
                $"AWS_XRAY_DAEMON_ADDRESS:- {Environment.GetEnvironmentVariable("AWS_XRAY_DAEMON_ADDRESS")}");
                

            AWSXRayRecorder.Instance.BeginSubsegment("Calling Search API");

            AWSXRayRecorder.Instance.AddMetadata("PetType", selectedPetType);
            AWSXRayRecorder.Instance.AddMetadata("PetId", petid);
            AWSXRayRecorder.Instance.AddMetadata("PetColor", selectedPetColor);

            
            Console.WriteLine(
                $"[{AWSXRayRecorder.Instance.TraceContext.GetEntity().RootSegment.TraceId}]- Search string - PetType:{selectedPetType} PetColor:{selectedPetColor} PetId:{petid}");
            
            // | SegmentId: [{AWSXRayRecorder.Instance.TraceContext.GetEntity().RootSegment.Id}
            string result;

            try
            {
                result = await GetPetDetails(selectedPetType, selectedPetColor, petid);
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

            var Pets = JsonSerializer.Deserialize<List<Pet>>(result);

            var PetDetails = new PetDetails()
            {
                Pets = Pets,
                Varieties = new Variety
                {
                    PetTypes = _variety.PetTypes,
                    PetColors = _variety.PetColors,
                    SelectedPetColor = selectedPetColor,
                    SelectedPetType = selectedPetType
                }
            };
            AWSXRayRecorder.Instance.AddMetadata("results", System.Text.Json.JsonSerializer.Serialize(PetDetails));
            Console.WriteLine(
                $" TraceId: [{AWSXRayRecorder.Instance.GetEntity().TraceId}] - {JsonSerializer.Serialize(PetDetails)}");

            // Sets the metric value to the number of pets available for adoption at the moment
            PetsWaitingForAdoption.Set(Pets.Where(pet => pet.availability == "yes").Count());

            return View(PetDetails);
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel {RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier});
        }
    }
}