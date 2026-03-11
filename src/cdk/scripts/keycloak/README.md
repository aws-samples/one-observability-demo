# Keycloak SAML Setup for Amazon Managed Grafana (AMG) on Amazon EKS

This project provides a script that deploys **Keycloak on Amazon EKS** and configures it as a **SAML Identity Provider (IdP)** for **Amazon Managed Grafana (AMG)**.

The script automates the setup required to:

- validate access to an existing EKS cluster
- locate an existing AMG workspace
- install the Amazon EBS CSI driver add-on if needed
- create a Kubernetes storage class for persistent volumes
- deploy Keycloak and PostgreSQL using Helm
- create a Keycloak realm for AMG
- create Keycloak users and roles for testing
- create the Keycloak SAML client for AMG
- update the AMG workspace to use Keycloak for SAML authentication

The result is a working SAML login flow where users sign in to AMG through Keycloak.

---

## What This Setup Builds

At a high level, the script builds this solution:

- **Amazon Managed Grafana** as the relying party / service provider
- **Keycloak** as the SAML identity provider
- **PostgreSQL** as the Keycloak persistence layer
- **Amazon EKS** as the runtime platform
- **AWS Load Balancer** created by the Kubernetes service to expose Keycloak
- **Persistent storage** backed by the EBS CSI driver

---

## Architecture Diagram

```text
                                      +--------------------------------------+
                                      |      Amazon Managed Grafana (AMG)    |
                                      |--------------------------------------|
                                      | Workspace                            |
                                      | Auth provider: SAML                  |
                                      +------------------+-------------------+
                                                         ^
                                                         |
                                              SAML assertion / ACS
                                                         |
                                                         |
+-------------------+       Browser access       +-------+--------------------+
|       User        | -------------------------> |        Keycloak Realm      |
|-------------------|                            |            "amg"           |
| Admin / Editor    | <------------------------- |----------------------------|
+-------------------+      login + redirect      | Users: admin, editor       |
                                                  | Roles: admin, editor       |
                                                  | SAML Client for AMG        |
                                                  +-------------+--------------+
                                                                |
                                                                | Realm, users,
                                                                | clients, mappings
                                                                v
                                                  +----------------------------+
                                                  |         PostgreSQL         |
                                                  |   Keycloak configuration   |
                                                  |         and data           |
                                                  +----------------------------+

    +---------------------------------------------------------------------------------------+
    |                                     Amazon EKS                                        |
    |---------------------------------------------------------------------------------------|
    |  Namespace: keycloak                                                                  |
    |                                                                                       |
    |   +---------------------------+      +---------------------------+                    |
    |   |      Keycloak Pod         |<---->|     PostgreSQL Pod        |                    |
    |   |   Bitnami Helm chart      |      |    Helm-managed DB        |                    |
    |   +-------------+-------------+      +---------------------------+                    |
    |                 |                                                                      |
    |                 | Kubernetes Service: type LoadBalancer                                |
    |                 v                                                                      |
    |          +---------------------------+                                                 |
    |          | AWS Load Balancer         |                                                 |
    |          | Keycloak public endpoint  |                                                 |
    |          +---------------------------+                                                 |
    +---------------------------------------------------------------------------------------+

    +---------------------------------------------------------------------------------------+
    |                                 Automation Script                                      |
    |---------------------------------------------------------------------------------------|
    | - validates tools and AWS resources                                                   |
    | - configures kubeconfig                                                               |
    | - installs EBS CSI add-on                                                             |
    | - deploys Keycloak + PostgreSQL                                                       |
    | - configures realm, users, and SAML client                                            |
    | - updates AMG SAML authentication                                                     |
    +---------------------------------------------------------------------------------------+
```

---

## Component Diagram

```text
Script
 ├── AWS CLI
 │    ├── EKS
 │    ├── Grafana
 │    ├── ELBv2
 │    └── IAM / STS
 ├── kubectl
 ├── helm
 └── eksctl

EKS Cluster
 └── Namespace: keycloak
      ├── StatefulSet: keycloak
      ├── StatefulSet / chart-managed PostgreSQL
      ├── Service: keycloak (LoadBalancer)
      ├── PVC: keycloak
      └── PVC: postgresql

Keycloak Realm: amg
 ├── Roles
 │    ├── admin
 │    └── editor
 ├── Users
 │    ├── admin
 │    └── editor
 └── SAML Client
      └── AMG workspace metadata / ACS URLs

AMG Workspace
 └── SAML configuration
      ├── IdP metadata URL
      ├── assertion attributes
      └── role mappings
```

---

## SAML Login Sequence Diagram

```text
User Browser            AMG Workspace                Keycloak                  PostgreSQL
     |                        |                          |                           |
     | Open workspace URL     |                          |                           |
     |----------------------->|                          |                           |
     |                        | Redirect to SAML IdP     |                           |
     |<-----------------------|                          |                           |
     | Go to Keycloak         |                          |                           |
     |------------------------------------------------->|                           |
     |                        |                          | Read realm/users/client   |
     |                        |                          |-------------------------->|
     |                        |                          |<--------------------------|
     | Sign in                |                          |                           |
     |------------------------------------------------->|                           |
     |                        |                          | Build SAML assertion      |
     |                        |                          |                           |
     | Browser posts SAML     |                          |                           |
     | assertion to AMG ACS   |                          |                           |
     |----------------------->|                          |                           |
     |                        | Validate assertion       |                           |
     |                        | map role / create session|                           |
     |                        |                          |                           |
     | Grafana dashboard      |                          |                           |
     |<-----------------------|                          |                           |
```

---

## Data Flows

### 1. Deployment and Control Flow

This is the flow when the script runs:

1. The script validates the required tools.
2. The script resolves AWS account and Region details.
3. The script checks that the EKS cluster exists.
4. The script updates kubeconfig to target the cluster.
5. The script finds the AMG workspace and waits until it is active.
6. The script installs the EBS CSI driver add-on if it is missing.
7. The script creates or verifies the storage class used by the Helm chart.
8. The script deploys Keycloak and PostgreSQL with Helm.
9. The script retrieves the generated Keycloak admin password from the Kubernetes secret.
10. The script copies a configuration script into the Keycloak pod.
11. Inside the Keycloak pod, `kcadm.sh` creates the realm, users, roles, and SAML client.
12. The script waits for the Keycloak load balancer to become healthy.
13. The script updates the AMG workspace authentication configuration with the Keycloak metadata URL and role mappings.

### 2. Authentication Runtime Flow

This is the flow after deployment:

1. The user opens the AMG workspace URL.
2. AMG redirects the browser to Keycloak because SAML is enabled.
3. Keycloak authenticates the user in the configured realm.
4. Keycloak sends the SAML assertion back to AMG.
5. AMG maps the SAML attributes:
   - `mail` → login/email
   - `displayName` → display name
   - `role` → workspace role
6. The user lands in AMG as either an Admin or Editor.

### 3. Persistence Flow

Keycloak stores the following in PostgreSQL:

- realms
- users
- credentials
- role mappings
- SAML client configuration
- protocol mapper configuration

Persistent volumes are backed by EBS through the EBS CSI driver.

---

## What the Script Configures

### EKS and Storage

The script ensures the cluster can support persistent storage for Keycloak and PostgreSQL.

It handles:

- EBS CSI add-on installation
- creation of the `ebs-sc` storage class

### Keycloak Deployment

Keycloak is installed using the Bitnami Helm chart. PostgreSQL is enabled within the chart configuration.

Typical Kubernetes resources created include:

- namespace
- StatefulSet / pod for Keycloak
- StatefulSet / pod for PostgreSQL
- LoadBalancer service for Keycloak
- persistent volume claims

### Keycloak Realm Model

By default, the script creates a realm named:

```text
amg
```

Inside this realm, it creates:

#### Roles
- `admin`
- `editor`

#### Users
- `admin`
- `editor`

These users are intended for SAML testing and initial verification.

### SAML Client for AMG

The script creates a SAML client using the AMG workspace endpoint.

Client ID pattern:

```text
https://<workspace-endpoint>/saml/metadata
```

Redirect URI pattern:

```text
https://<workspace-endpoint>/saml/acs
```

### AMG SAML Configuration

The script configures AMG to use Keycloak metadata and applies the SAML assertion mappings.

Expected mappings:

| AMG field | SAML attribute |
|---|---|
| Login | `mail` |
| Email | `mail` |
| Name | `displayName` |
| Role | `role` |

Role mapping:

| Keycloak role | AMG role |
|---|---|
| `admin` | Admin |
| `editor` | Editor |

---

## Prerequisites

Before you run the script, make sure you already have:

- an existing **Amazon EKS cluster**
- an existing **Amazon Managed Grafana workspace**
- permissions to manage:
  - EKS
  - IAM
  - ELBv2
  - Grafana
  - STS
- the following tools available in your shell:
  - `aws`
  - `kubectl`
  - `helm`
  - `jq`
  - `curl`
  - `openssl`
  - `tar`
  - `uname`

If `eksctl` is missing, the script installs it automatically.

---

## Script Inputs

The script accepts the following parameters:

| Parameter | Required | Default | Description |
|---|---:|---|---|
| `--cluster-name` | Yes |  | Name of the Amazon EKS cluster |
| `--workspace-name` | Yes |  | Name of the AMG workspace |
| `--keycloak-namespace` | No | `keycloak` | Namespace where Keycloak is deployed |
| `--keycloak-realm` | No | `amg` | Keycloak realm used for AMG |
| `--account-id` | No | auto-detected | AWS account ID |

---

## Example Usage

Set variables:

```bash
CLUSTER_NAME=PetSite
WORKSPACE_NAME=demo-amg
KEYCLOAK_NAMESPACE=keycloak
KEYCLOAK_REALM_AMG=amg
```

Run the script:

```bash
chmod +x keycloak-setup-better.sh

./keycloak-setup-better.sh \
  --cluster-name "$CLUSTER_NAME" \
  --workspace-name "$WORKSPACE_NAME" \
  --keycloak-namespace "$KEYCLOAK_NAMESPACE" \
  --keycloak-realm "$KEYCLOAK_REALM_AMG"
```

---

## CloudShell-Friendly Step-by-Step Deployment

If you are running this from AWS CloudShell, a simple flow is:

### 1. Set your variables

```bash
CLUSTER_NAME=PetSite
WORKSPACE_NAME=demo-amg
KEYCLOAK_NAMESPACE=keycloak
KEYCLOAK_REALM_AMG=amg
```

### 2. Download or copy the script

```bash
chmod +x keycloak-setup-better.sh
```

### 3. Run the script

```bash
./keycloak-setup-better.sh \
  --cluster-name "$CLUSTER_NAME" \
  --workspace-name "$WORKSPACE_NAME" \
  --keycloak-namespace "$KEYCLOAK_NAMESPACE" \
  --keycloak-realm "$KEYCLOAK_REALM_AMG"
```

### 4. Wait for completion

The script will:

- install missing infrastructure components if required
- deploy Keycloak
- configure the realm and users
- update AMG SAML authentication

### 5. Save the final output

At the end, the script prints:

- AMG workspace URL
- Keycloak master admin username and password
- Keycloak realm test user passwords
- SAML metadata URL

Save these values for testing.

---

## Example Output

The exact values will differ, but the output will look like this:

```text
-------------------
Workspace endpoint: https://<workspace-endpoint>/
-------------------

-------------------
Keycloak (master realm) admin console credentials
-------------------
username: user
password: <admin-password>

-------------------
Keycloak realm users (for SAML testing)
-------------------
realm: amg
admin  password: <generated-password>
editor password: <generated-password>

SAML metadata URL: http://<keycloak-lb-hostname>/realms/amg/protocol/saml/descriptor

Setup done.
```

---

## Testing the Login Flow

After the script completes:

1. Open the AMG workspace URL.
2. Choose **SAML login**.
3. Sign in with one of the realm users:
   - `admin`
   - `editor`
4. Verify the resulting AMG role.

---

## Operational Notes

### Re-running the Script

The script is designed to be re-runnable for most steps:

- it checks for existing AWS resources
- it checks for existing Kubernetes resources
- it upgrades the Helm release if Keycloak is already installed
- it updates AMG authentication only if the configuration differs

### Keycloak Pod Assumptions

The script expects the main Keycloak pod to be named:

```text
keycloak-0
```

That matches the current chart behavior in this setup.

### Password Behavior

- the Keycloak master admin password is read from the Kubernetes secret created by the chart
- the realm test user passwords are generated during script execution and printed at the end

### Metadata URL

The metadata URL used by AMG is derived from the load balancer hostname of the Keycloak service:

```text
http://<load-balancer-hostname>/realms/<realm>/protocol/saml/descriptor
```

---

## Troubleshooting

### Check pods

```bash
kubectl get pods -n keycloak
```

### Check Keycloak logs

```bash
kubectl logs -n keycloak keycloak-0
```

### Check services

```bash
kubectl get svc -n keycloak
kubectl describe svc keycloak -n keycloak
```

### Check load balancer hostname

```bash
kubectl get svc keycloak -n keycloak -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

### Inspect Keycloak manually

```bash
kubectl exec -n keycloak keycloak-0 -- bash
```

Inside the container, the admin CLI is:

```bash
/opt/bitnami/keycloak/bin/kcadm.sh
```

### Verify AMG authentication config

```bash
aws grafana describe-workspace-authentication --workspace-id <workspace-id>
```

---

## Repository Layout

```text
.
├── keycloak-setup-better.sh
└── README.md
```

---

## Summary

This script provides an automated, repeatable way to:

- deploy Keycloak on EKS
- persist Keycloak state in PostgreSQL
- create a dedicated realm for AMG
- configure SAML authentication between Keycloak and AMG
- test login with pre-created users and role mappings

It is a practical setup for enabling SAML-based access to Amazon Managed Grafana through Keycloak on Kubernetes.
