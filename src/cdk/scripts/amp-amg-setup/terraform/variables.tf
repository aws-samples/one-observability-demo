variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "devops-agent-eks"
}

variable "amp_alias" {
  description = "AMP workspace alias"
  type        = string
  default     = "demo-amp"
}

variable "scraper_alias" {
  description = "AMP managed scraper alias"
  type        = string
  default     = "demo-amp-scraper"
}

variable "amg_workspace_name" {
  description = "AMG workspace name"
  type        = string
  default     = "demo-amg"
}

variable "keycloak_namespace" {
  description = "Kubernetes namespace for Keycloak"
  type        = string
  default     = "keycloak"
}

variable "keycloak_realm" {
  description = "Keycloak realm name for AMG SAML"
  type        = string
  default     = "amg"
}

variable "keycloak_admin_user" {
  description = "Keycloak admin username"
  type        = string
  default     = "user"
}

variable "keycloak_chart_version" {
  description = "Bitnami Keycloak Helm chart version"
  type        = string
  default     = "24.2.3"
}

variable "dashboard_id" {
  description = "Grafana.com dashboard ID to import"
  type        = string
  default     = "3119"
}

variable "secrets_manager_name" {
  description = "Secrets Manager secret name for storing setup credentials"
  type        = string
  default     = "amp-amg-setup-credentials"
}
