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
        private readonly ParameterRefreshManager _refreshManager;

        public WaggleController(ILogger<WaggleController> logger, IHttpClientFactory httpClientFactory, IConfiguration configuration, ParameterRefreshManager refreshManager)
        {
            _logger = logger;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _refreshManager = refreshManager;
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
                if (string.IsNullOrEmpty(request.SessionId))
                {
                    request.SessionId = System.Guid.NewGuid().ToString();
                }

                using var httpClient = _httpClientFactory.CreateClient();
                var waggleApiUrl = await ParameterNames.GetParameterValueAsync(ParameterNames.PETFOOD_AGENT_RUNTIME_URL, _refreshManager);

                var payload = new
                {
                    message = request.Message,
                    session_id = request.SessionId
                };

                var json = JsonSerializer.Serialize(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var response = await httpClient.PostAsync(waggleApiUrl, content);
                var responseContent = await response.Content.ReadAsStringAsync();

                return Json(new ChatResponse
                {
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