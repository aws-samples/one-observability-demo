output "amp_workspace_id" {
  description = "AMP workspace ID"
  value       = aws_prometheus_workspace.amp.id
}

output "amp_endpoint" {
  description = "AMP Prometheus endpoint"
  value       = aws_prometheus_workspace.amp.prometheus_endpoint
}

output "amp_arn" {
  description = "AMP workspace ARN"
  value       = aws_prometheus_workspace.amp.arn
}

output "scraper_id" {
  description = "Managed scraper ID"
  value       = aws_prometheus_scraper.eks.id
}

output "amg_workspace_id" {
  description = "AMG workspace ID"
  value       = aws_grafana_workspace.amg.id
}

output "amg_endpoint" {
  description = "AMG workspace URL"
  value       = "https://${aws_grafana_workspace.amg.endpoint}"
}

output "amg_role_arn" {
  description = "AMG IAM role ARN"
  value       = aws_iam_role.amg.arn
}

output "keycloak_cloudfront_url" {
  description = "Keycloak CloudFront HTTPS URL"
  value       = "https://${aws_cloudfront_distribution.keycloak.domain_name}"
}

output "keycloak_saml_url" {
  description = "Keycloak SAML descriptor URL (via CloudFront HTTPS)"
  value       = "https://${aws_cloudfront_distribution.keycloak.domain_name}/realms/${var.keycloak_realm}/protocol/saml/descriptor"
}

output "secrets_manager_name" {
  description = "Secrets Manager secret name storing setup credentials"
  value       = var.secrets_manager_name
}
