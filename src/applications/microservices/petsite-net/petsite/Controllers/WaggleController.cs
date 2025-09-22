using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using PetSite.Configuration;

namespace PetSite.Controllers
{
    public class WaggleController : BaseController
    {
        private readonly ILogger<WaggleController> _logger;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;


        public WaggleController(ILogger<WaggleController> logger, IHttpClientFactory httpClientFactory,IConfiguration configuration)
        {
            _logger = logger;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
        }

        public IActionResult Index(string userId)
        {
            if (EnsureUserId()) return new EmptyResult();
            return View();
        }

        [HttpPost]
        public async Task<IActionResult> SendMessage([FromBody] ChatRequest request)
        {
            try
            {
                // Generate SessionId if not provided
                if (string.IsNullOrEmpty(request.SessionId))
                {
                    request.SessionId = System.Guid.NewGuid().ToString();
                }

                using var httpClient = _httpClientFactory.CreateClient();
                
                // TEMP - Remove this once the Parameter name is available via CDK
                var waggleApiUrl = _configuration.GetValue<string>("waggleapiurl");

                //var waggleApiUrl = ParameterNames.GetParameterValue(ParameterNames.WAGGLE_API_URL, _configuration);

                var payload = new
                {
                    message = request.Message,
                    session_id = request.SessionId
                };

                var json = JsonSerializer.Serialize(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var response = await httpClient.PostAsync(waggleApiUrl, content);
                var responseContent = await response.Content.ReadAsStringAsync();

                //var apiResponse = JsonSerializer.Deserialize<dynamic>(responseContent);
                
                return Json(new ChatResponse
                {
                    //Message = apiResponse.GetProperty("message").GetString(),
                    Message = responseContent,
                    SessionId = request.SessionId,
                    Success = true
                });
            }
            catch (System.Exception ex)
            {
                _logger.LogError(ex, "Error sending message to Waggle AI");
                return Json(new ChatResponse
                {
                    Message = "Sorry, I'm having trouble connecting right now. Please try again later.",
                    Success = false
                });
            }
        }
    }

    public class ChatRequest
    {
        public string Message { get; set; }
        public string UserId { get; set; }
        public string SessionId { get; set; }
    }

    public class ChatResponse
    {
        public string Message { get; set; }
        public string SessionId { get; set; }
        public bool Success { get; set; }
    }
}