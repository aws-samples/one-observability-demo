using System.Dynamic;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using PetSite.Configuration;
using Amazon.BedrockAgentCore;
using Amazon.BedrockAgentCore.Model;
using Microsoft.AspNetCore.Http.Timeouts;

namespace PetSite.Controllers
{
    public class WaggleController : BaseController
    {
        private readonly ILogger<WaggleController> _logger;
        private readonly IAmazonBedrockAgentCore _bedrockAgentCore;
        private readonly IConfiguration _configuration;

        public WaggleController(ILogger<WaggleController> logger, IAmazonBedrockAgentCore bedrockAgentCore,
            IConfiguration configuration)
        {
            _logger = logger;
            _bedrockAgentCore = bedrockAgentCore;
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
            var responseText = "";

            try
            {
                // Generate SessionId if not provided
                if (string.IsNullOrEmpty(request.SessionId))
                {
                    request.SessionId = System.Guid.NewGuid().ToString();
                }

                // Get Agent Runtime ARN from configuration
                var agentRuntimeArn =ParameterNames.GetParameterValue(ParameterNames.WAGGLE_AGENT_ARN, _configuration); 
                
                _logger.LogInformation($"Agent ARN: {agentRuntimeArn}");
                
                if (string.IsNullOrEmpty(agentRuntimeArn))
                {
                    _logger.LogError("BedrockAgentRuntimeArn not configured");
                    return Json(new ChatResponse
                    {
                        Message = "Agent configuration is missing. Please contact support.",
                        Success = false
                    });
                }

                // Create payload matching Python example structure
                var payload = new
                {
                    prompt = request.Message,
                    userId = request.UserId
                };

                // Create the invoke agent runtime request
                var payloadJson = JsonSerializer.Serialize(payload);
                var payloadBytes = System.Text.Encoding.UTF8.GetBytes(payloadJson);
                var payloadStream = new System.IO.MemoryStream(payloadBytes);

                var invokeRequest = new InvokeAgentRuntimeRequest
                {
                    AgentRuntimeArn = agentRuntimeArn,
                    RuntimeSessionId = request.SessionId,
                    Payload = payloadStream,
                    Qualifier = "DEFAULT"
                };
                
                _logger.LogInformation("Invoking agent runtime");
                
                // Invoke the Bedrock AgentCore
                var response = await _bedrockAgentCore.InvokeAgentRuntimeAsync(invokeRequest);

                _logger.LogInformation("Received response from agent runtime");

                // Process the response
                if (response.Response != null)
                {
                    using var reader = new System.IO.StreamReader(response.Response);
                    var responseBody = await reader.ReadToEndAsync();
                    
                    _logger.LogInformation($"Raw response body: {responseBody}");
                    
                    // Process Server-Sent Events (SSE) streaming response
                    if (responseBody.Contains("data: "))
                    {
                        var lines = responseBody.Split('\n');
                        var messageBuilder = new System.Text.StringBuilder();
                        
                        foreach (var line in lines)
                        {
                            if (line.StartsWith("data: "))
                            {
                                // Extract the content after "data: "
                                var content = line.Substring(6); // Remove "data: " prefix
                                
                                // Remove quotes if present
                                if (content.StartsWith("\"") && content.EndsWith("\""))
                                {
                                    content = content.Substring(1, content.Length - 2);
                                }
                                
                                messageBuilder.Append(content);
                            }
                        }
                        
                        responseText = messageBuilder.ToString();
                        _logger.LogInformation($"Processed SSE response: {responseText}");
                    }
                    else
                    {
                        // Try to parse as JSON if it's not SSE format
                        try
                        {
                            var responseData = JsonSerializer.Deserialize<JsonElement>(responseBody);
                            
                            // Try different possible response structures
                            if (responseData.TryGetProperty("response", out var responseProperty))
                            {
                                responseText = responseProperty.GetString() ?? responseBody;
                            }
                            else if (responseData.TryGetProperty("output", out var outputProperty))
                            {
                                responseText = outputProperty.GetString() ?? responseBody;
                            }
                            else if (responseData.TryGetProperty("message", out var messageProperty))
                            {
                                responseText = messageProperty.GetString() ?? responseBody;
                            }
                            else
                            {
                                responseText = responseBody;
                            }
                        }
                        catch (JsonException ex)
                        {
                            _logger.LogWarning($"Response is not valid JSON: {ex.Message}. Using raw response.");
                            responseText = responseBody;
                        }
                    }
                }
                else
                {
                    responseText = "No response received from agent.";
                }

                return Json(new ChatResponse
                {
                    Message = responseText,
                    SessionId = request.SessionId,
                    Success = true
                });
            }
            catch (System.Exception ex)
            {
                _logger.LogError(ex, $"Error invoking Bedrock agent for user: {request.UserId}");
                return Json(new ChatResponse
                {
                    Message = $"Sorry, I'm having trouble connecting right now. Please try again later.",
                    SessionId = request.SessionId,
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