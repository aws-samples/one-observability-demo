using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace PetSearch.Controllers
{
    public class HealthController : ControllerBase
    {
       [HttpGet("/health/status")]
        public string Status()
        {
            return "Alive";
        }
    }
}