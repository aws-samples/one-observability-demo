# ECS Port Forwarding

## Overview

The `ecs-port-forward.sh` script enables port forwarding to ECS tasks using AWS Session Manager. This allows you to connect to services running inside ECS containers from your local machine.

## Prerequisites

- AWS CLI configured with appropriate credentials
- ECS tasks must have ECS Exec enabled
- Session Manager plugin installed (`session-manager-plugin`)

## Usage

```bash
./src/cdk/scripts/ecs-port-forward.sh
```

The script will prompt you to:
1. Select an ECS cluster
2. Select a service
3. Select a task
4. Select a container
5. Enter local port (default: 8080)
6. Enter remote port (default: 80)

## Example

```bash
$ ./src/cdk/scripts/ecs-port-forward.sh
Fetching ECS clusters...
Available clusters:
1) arn:aws:ecs:us-east-1:123456789012:cluster/my-cluster
#? 1
Fetching services for cluster: my-cluster
Available services:
1) arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service
#? 1
...
Local port (default 8080): 3000
Remote port (default 80): 8080
Starting port forwarding: localhost:3000 -> container:8080
```

Access your service at `http://localhost:3000`

## Troubleshooting

- Ensure ECS tasks have `enableExecuteCommand: true`
- Verify Session Manager permissions in your IAM role
- Check that the target port is listening in the container