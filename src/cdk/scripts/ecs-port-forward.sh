#!/bin/bash

set -e

# Get clusters
echo "Fetching ECS clusters..."
clusters=$(aws ecs list-clusters --query 'clusterArns[*]' --output text)
if [ -z "$clusters" ]; then
    echo "No ECS clusters found"
    exit 1
fi

# Select cluster
echo "Available clusters:"
select cluster in $clusters; do
    if [ -n "$cluster" ]; then
        cluster_name=$(basename "$cluster")
        break
    fi
done

# Get services
echo "Fetching services for cluster: $cluster_name"
services=$(aws ecs list-services --cluster "$cluster_name" --query 'serviceArns[*]' --output text)
if [ -z "$services" ]; then
    echo "No services found in cluster"
    exit 1
fi

# Select service
echo "Available services:"
select service in $services; do
    if [ -n "$service" ]; then
        service_name=$(basename "$service")
        break
    fi
done

# Get tasks
echo "Fetching tasks for service: $service_name"
tasks=$(aws ecs list-tasks --cluster "$cluster_name" --service-name "$service_name" --query 'taskArns[*]' --output text)
if [ -z "$tasks" ]; then
    echo "No running tasks found for service"
    exit 1
fi

# Select task
echo "Available tasks:"
select task in $tasks; do
    if [ -n "$task" ]; then
        task_id=$(basename "$task")
        break
    fi
done

# Get containers
echo "Fetching containers for task: $task_id"
containers=$(aws ecs describe-tasks --cluster "$cluster_name" --tasks "$task_id" --query 'tasks[0].containers[*].name' --output text)
if [ -z "$containers" ]; then
    echo "No containers found in task"
    exit 1
fi

# Select container
echo "Available containers:"
select container in $containers; do
    if [ -n "$container" ]; then
        break
    fi
done

# Get runtime ID
runtime_id=$(aws ecs describe-tasks --cluster "$cluster_name" --tasks "$task_id" --query "tasks[0].containers[?name=='$container'].runtimeId" --output text)

# Get ports
read -p "Local port (default 8080): " local_port
local_port=${local_port:-8080}

read -p "Remote port (default 80): " remote_port
remote_port=${remote_port:-80}

# Start port forwarding
echo "Starting port forwarding: localhost:$local_port -> $container:$remote_port"
echo "Target: ecs:${cluster_name}_${task_id}_${runtime_id}"

aws ssm start-session \
  --target "ecs:${cluster_name}_${task_id}_${runtime_id}" \
  --document-name AWS-StartPortForwardingSession \
  --parameters "{\"portNumber\":[\"$remote_port\"],\"localPortNumber\":[\"$local_port\"]}"