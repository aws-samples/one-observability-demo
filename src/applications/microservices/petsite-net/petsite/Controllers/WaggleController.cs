using System.Dynamic;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using PetSite.Configuration;
using Amazon.BedrockAgentCore;
using Amazon.BedrockAgentCore.Model;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Http.Timeouts;

namespace PetSite.Controllers
{
    public class WaggleController : BaseController
    {
        private readonly ILogger<WaggleController> _logger;
        private readonly IAmazonBedrockAgentCore _bedrockAgentCore;
        private readonly IConfiguration _configuration;
        private readonly ParameterRefreshManager _refreshManager;

        // Limit concurrent Bedrock requests to prevent connection exhaustion
        private static readonly System.Threading.SemaphoreSlim _bedrockSemaphore = new System.Threading.SemaphoreSlim(2, 2);

        public WaggleController(ILogger<WaggleController> logger, IAmazonBedrockAgentCore bedrockAgentCore,
            IConfiguration configuration, ParameterRefreshManager refreshManager)
        {
            _logger = logger;
            _bedrockAgentCore = bedrockAgentCore;
            _configuration = configuration;
            _refreshManager = refreshManager;
        }

        public IActionResult Index(string userId)
        {
            if (EnsureUserId()) return new EmptyResult();
            return View();
        }

        // Streams the runtime's SSE frames to the browser as produced, so idle timeouts never trip.
        [HttpPost]
        public async Task SendMessage([FromBody] ChatRequest request)
        {
            // Generate SessionId if absent and return it via a header; the body is a raw token stream.
            if (string.IsNullOrEmpty(request.SessionId))
            {
                request.SessionId = System.Guid.NewGuid().ToString();
            }
            Response.Headers["X-Session-Id"] = request.SessionId;
            Response.ContentType = "text/plain; charset=utf-8";
            Response.Headers["Cache-Control"] = "no-cache";
            Response.Headers["X-Accel-Buffering"] = "no"; // discourage proxy buffering
            // Disable ASP.NET response buffering so writes flush to the client.
            HttpContext.Features
                .Get<Microsoft.AspNetCore.Http.Features.IHttpResponseBodyFeature>()
                ?.DisableBuffering();

            string agentRuntimeArn;
            try
            {
                agentRuntimeArn = await ParameterNames.GetParameterValueAsync(
                    ParameterNames.WAGGLE_AI_RUNTIME_ARN, _refreshManager);
            }
            catch (System.Exception ex)
            {
                _logger.LogError(ex, "Failed to resolve agent runtime ARN");
                agentRuntimeArn = null;
            }

            if (string.IsNullOrEmpty(agentRuntimeArn))
            {
                _logger.LogError("BedrockAgentRuntimeArn not configured");
                await Response.WriteAsync("Agent configuration is missing. Please contact support.");
                return;
            }

            // sessionId must be in the payload, not just RuntimeSessionId, or agent memory never persists.
            var payload = new { prompt = request.Message, userId = request.UserId, sessionId = request.SessionId };
            var payloadBytes = System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));

            await _bedrockSemaphore.WaitAsync();
            try
            {
                using (var payloadStream = new System.IO.MemoryStream(payloadBytes))
                {
                    var invokeRequest = new InvokeAgentRuntimeRequest
                    {
                        AgentRuntimeArn = agentRuntimeArn,
                        RuntimeSessionId = request.SessionId,
                        Payload = payloadStream,
                        Qualifier = "DEFAULT"
                    };

                    _logger.LogInformation("Invoking agent runtime (streaming)");
                    using (var response = await _bedrockAgentCore.InvokeAgentRuntimeAsync(invokeRequest))
                    {
                        if (response.Response == null)
                        {
                            await Response.WriteAsync("No response received from agent.");
                            return;
                        }

                        using (var reader = new System.IO.StreamReader(response.Response))
                        {
                            var wroteAny = false;
                            string line;
                            while ((line = await reader.ReadLineAsync()) != null)
                            {
                                if (!line.StartsWith("data:")) continue;

                                var content = line.Substring(5).TrimStart();
                                if (content.Length == 0) continue;

                                // Chunks arrive JSON-quoted (escaped newlines etc.); decode.
                                if (content.StartsWith("\""))
                                {
                                    try { content = JsonSerializer.Deserialize<string>(content) ?? ""; }
                                    catch (JsonException) { /* fall back to raw content */ }
                                }
                                if (content.Length == 0) continue;

                                await Response.WriteAsync(content);
                                await Response.Body.FlushAsync();
                                wroteAny = true;
                            }

                            if (!wroteAny)
                            {
                                await Response.WriteAsync("Sorry, I couldn't generate a response. Please try again.");
                            }
                        }
                    }
                }
            }
            catch (Amazon.BedrockAgentCore.Model.ServiceException ex)
            {
                _logger.LogWarning(ex, "Bedrock service error");
                await SafeAppendAsync("The service is currently busy. Please wait a moment and try again.");
            }
            catch (System.Exception ex)
            {
                _logger.LogError(ex, $"Error streaming Bedrock agent for user: {request.UserId}");
                await SafeAppendAsync("\n\n[Sorry, the connection was interrupted. Please try again.]");
            }
            finally
            {
                _bedrockSemaphore.Release();
                _logger.LogInformation("Released Bedrock connection slot");
            }
        }

        // Best-effort write of an error note; headers/tokens may already be sent.
        private async Task SafeAppendAsync(string text)
        {
            try { await Response.WriteAsync(text); await Response.Body.FlushAsync(); }
            catch { /* client gone / response complete */ }
        }
    }

    public class ChatRequest
    {
        public string Message { get; set; }
        public string UserId { get; set; }
        public string SessionId { get; set; }
    }

    // public class ChatMessage
    // {
    //     public string prompt {get; set;}
    //     public string userId { get; set; }
    // }

    public class ChatResponse
    {
        public string Message { get; set; }
        public string SessionId { get; set; }
        public bool Success { get; set; }
    }
}