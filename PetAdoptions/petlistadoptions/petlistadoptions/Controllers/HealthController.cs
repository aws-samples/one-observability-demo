using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace PetListAdoptions.Controllers
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