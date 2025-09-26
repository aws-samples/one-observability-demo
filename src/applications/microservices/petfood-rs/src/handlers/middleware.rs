use axum::{
    body::Body,
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{Json, Response},
};
use serde_json::{json, Value};
use tracing::{error, warn};

/// Request validation middleware
pub async fn request_validation_middleware(
    request: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, Json<Value>)> {
    // Validate content type for POST/PUT requests
    validate_content_type(&request)?;

    // Validate request size
    validate_request_size(&request)?;

    // Continue with the request
    let response = next.run(request).await;
    Ok(response)
}

/// Validate content type for requests with body
fn validate_content_type(request: &Request<Body>) -> Result<(), (StatusCode, Json<Value>)> {
    let method = request.method();

    // Only validate content type for requests that should have a body
    if method == "POST" || method == "PUT" || method == "PATCH" {
        let headers = request.headers();

        if let Some(content_type) = headers.get("content-type") {
            let content_type_str = content_type.to_str().unwrap_or("");

            // Check if it's JSON
            if !content_type_str.starts_with("application/json") {
                warn!("Invalid content type: {}", content_type_str);
                return Err((
                    StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    Json(json!({
                        "error": "Unsupported media type",
                        "message": "Content-Type must be application/json",
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                    })),
                ));
            }
        } else {
            warn!("Missing content type header");
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Missing content type",
                    "message": "Content-Type header is required for requests with body",
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })),
            ));
        }
    }

    Ok(())
}

/// Validate request size
fn validate_request_size(request: &Request<Body>) -> Result<(), (StatusCode, Json<Value>)> {
    const MAX_REQUEST_SIZE: u64 = 1024 * 1024; // 1MB

    if let Some(content_length) = request.headers().get("content-length") {
        if let Ok(length_str) = content_length.to_str() {
            if let Ok(length) = length_str.parse::<u64>() {
                if length > MAX_REQUEST_SIZE {
                    error!("Request too large: {} bytes", length);
                    return Err((
                        StatusCode::PAYLOAD_TOO_LARGE,
                        Json(json!({
                            "error": "Request too large",
                            "message": format!("Request size {} bytes exceeds maximum of {} bytes", length, MAX_REQUEST_SIZE),
                            "timestamp": chrono::Utc::now().to_rfc3339(),
                        })),
                    ));
                }
            }
        }
    }

    Ok(())
}

/// CORS middleware for handling cross-origin requests
pub async fn cors_middleware(request: Request<Body>, next: Next) -> Response {
    let response = next.run(request).await;

    let mut response = response;
    let headers = response.headers_mut();

    // Add CORS headers
    headers.insert("Access-Control-Allow-Origin", "*".parse().unwrap());
    headers.insert(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS".parse().unwrap(),
    );
    headers.insert(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization".parse().unwrap(),
    );
    headers.insert("Access-Control-Max-Age", "86400".parse().unwrap());

    response
}

/// Rate limiting middleware (basic implementation)
pub async fn rate_limiting_middleware(
    request: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, Json<Value>)> {
    // For now, this is a placeholder implementation
    // In a real application, you would implement proper rate limiting
    // using a distributed cache like Redis or an in-memory store

    // Extract client IP or user ID for rate limiting
    let client_id = extract_client_identifier(&request);

    // Check rate limit (placeholder logic)
    if is_rate_limited(&client_id) {
        warn!("Rate limit exceeded for client: {}", client_id);
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "error": "Rate limit exceeded",
                "message": "Too many requests. Please try again later.",
                "retry_after": 60,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            })),
        ));
    }

    // Continue with the request
    Ok(next.run(request).await)
}

/// Extract client identifier for rate limiting
fn extract_client_identifier(request: &Request<Body>) -> String {
    // Try to get client IP from headers
    if let Some(forwarded_for) = request.headers().get("x-forwarded-for") {
        if let Ok(ip) = forwarded_for.to_str() {
            return ip.split(',').next().unwrap_or("unknown").trim().to_string();
        }
    }

    if let Some(real_ip) = request.headers().get("x-real-ip") {
        if let Ok(ip) = real_ip.to_str() {
            return ip.to_string();
        }
    }

    // Fallback to connection info (not available in this context)
    "unknown".to_string()
}

/// Check if client is rate limited (placeholder implementation)
fn is_rate_limited(_client_id: &str) -> bool {
    // Placeholder: always allow requests
    // In a real implementation, you would check against a rate limiting store
    false
}

/// Security headers middleware
pub async fn security_headers_middleware(request: Request<Body>, next: Next) -> Response {
    let response = next.run(request).await;

    let mut response = response;
    let headers = response.headers_mut();

    // Add security headers
    headers.insert("X-Content-Type-Options", "nosniff".parse().unwrap());
    headers.insert("X-Frame-Options", "DENY".parse().unwrap());
    headers.insert("X-XSS-Protection", "1; mode=block".parse().unwrap());
    headers.insert(
        "Referrer-Policy",
        "strict-origin-when-cross-origin".parse().unwrap(),
    );
    headers.insert(
        "Content-Security-Policy",
        "default-src 'self'".parse().unwrap(),
    );

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Method, Request};

    #[test]
    fn test_extract_client_identifier() {
        let mut request = Request::builder()
            .method(Method::GET)
            .uri("/test")
            .body(Body::empty())
            .unwrap();

        // Test with X-Forwarded-For header
        request
            .headers_mut()
            .insert("x-forwarded-for", "192.168.1.1, 10.0.0.1".parse().unwrap());

        let client_id = extract_client_identifier(&request);
        assert_eq!(client_id, "192.168.1.1");
    }

    #[test]
    fn test_extract_client_identifier_real_ip() {
        let mut request = Request::builder()
            .method(Method::GET)
            .uri("/test")
            .body(Body::empty())
            .unwrap();

        // Test with X-Real-IP header
        request
            .headers_mut()
            .insert("x-real-ip", "203.0.113.1".parse().unwrap());

        let client_id = extract_client_identifier(&request);
        assert_eq!(client_id, "203.0.113.1");
    }

    #[test]
    fn test_extract_client_identifier_unknown() {
        let request = Request::builder()
            .method(Method::GET)
            .uri("/test")
            .body(Body::empty())
            .unwrap();

        let client_id = extract_client_identifier(&request);
        assert_eq!(client_id, "unknown");
    }
}
