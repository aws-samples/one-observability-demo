using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using System;
using System.Threading.Tasks;

namespace PetSite.Middleware
{
    public class ErrorHandlingMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger<ErrorHandlingMiddleware> _logger;

        public ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
        {
            _next = next;
            _logger = logger;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            try
            {
                await _next(context);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "An unhandled exception occurred");
                
                // Preserve userId and exception message
                var userId = context.Request.Query["userId"].ToString();
                var errorMessage = Uri.EscapeDataString(ex.Message);
                
                var errorPath = $"/Home/Error?message={errorMessage}";
                if (!string.IsNullOrEmpty(userId))
                {
                    errorPath += $"&userId={userId}";
                }
                
                context.Response.Redirect(errorPath);
            }
        }
    }
}