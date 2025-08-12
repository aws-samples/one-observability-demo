using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;

namespace PetSite.Controllers
{
    public class BaseController : Controller
    {
        private static readonly List<string> UserIds = new List<string>
        {
            "user001", "user002", "user003", "user004", "user005",
            "user006", "user007", "user008", "user009", "user010",
            "user011", "user012", "user013", "user014", "user015",
            "user016", "user017", "user018", "user019", "user020",
            "user021", "user022", "user023", "user024", "user025"
        };
        private static readonly Random Random = new Random();

        protected bool EnsureUserId()
        {
            string userId = Request.Query["userId"];
            
            if (string.IsNullOrEmpty(userId))
            {
                userId = HttpContext.Session.GetString("userId");
                if (string.IsNullOrEmpty(userId))
                {
                    userId = UserIds[Random.Next(UserIds.Count)];
                    HttpContext.Session.SetString("userId", userId);
                }
                
                var queryString = Request.QueryString.HasValue ? Request.QueryString.Value + "&userId=" + userId : "?userId=" + userId;
                Response.Redirect(Request.Path + queryString);
                return true; // Indicates redirect happened
            }
            
            HttpContext.Session.SetString("userId", userId);
            ViewBag.UserId = userId;
            
            // Add userId to OpenTelemetry trace context if not present
            var currentActivity = Activity.Current;
            if (currentActivity != null && !currentActivity.Tags.Any(tag => tag.Key == "userId"))
            {
                currentActivity.SetTag("userId", userId);
            }
            
            return false; // No redirect needed
        }
    }
}