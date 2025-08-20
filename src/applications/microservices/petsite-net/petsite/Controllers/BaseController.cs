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
        private static readonly Random Random = new Random();

        private static string GenerateUserId()
        {
            int randomNumber = Random.Next(1, 10000);
            return $"user{randomNumber:D4}";
        }

        protected bool EnsureUserId()
        {
            string userId = Request.Query["userId"].ToString();
            
            // Generate userId only on Home/Index if not provided
            if (string.IsNullOrEmpty(userId))
            {
                // Only generate on Home/Index, otherwise require userId
                if (ControllerContext.ActionDescriptor.ControllerName == "Home" && 
                    ControllerContext.ActionDescriptor.ActionName == "Index")
                {
                    userId = GenerateUserId();
                    
                    if (Request.Method == "GET")
                    {
                        var queryString = Request.QueryString.HasValue ? Request.QueryString.Value + "&userId=" + userId : "?userId=" + userId;
                        Response.Redirect(Request.Path + queryString);
                        return true;
                    }
                }
                else
                {
                    // Redirect to Home/Index if userId is missing on other pages
                    Response.Redirect("/Home/Index");
                    return true;
                }
            }
            
            // Set ViewBag and ViewData for all views
            ViewBag.UserId = userId;
            ViewData["UserId"] = userId;
            
            var currentActivity = Activity.Current;
            if (currentActivity != null && !currentActivity.Tags.Any(tag => tag.Key == "userId"))
            {
                currentActivity.SetTag("userId", userId);
            }
            
            return false;
        }
    }
}