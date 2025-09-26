#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

set -e

CLUSTER_NAME="$1"

if [[ -z "$CLUSTER_NAME" ]]; then
    echo "Usage: $0 <cluster-name>"
    exit 1
fi

echo "Checking EKS cluster health for: $CLUSTER_NAME"

# Get all node groups for the cluster
NODEGROUPS=$(aws eks list-nodegroups --cluster-name "$CLUSTER_NAME" --query 'nodegroups' --output text)

if [[ -z "$NODEGROUPS" ]]; then
    echo "No node groups found for cluster $CLUSTER_NAME"
    exit 0
fi

for NODEGROUP in $NODEGROUPS; do
    echo "Checking node group: $NODEGROUP"

    # Check node group health
    HEALTH_ISSUES=$(aws eks describe-nodegroup --cluster-name "$CLUSTER_NAME" --nodegroup-name "$NODEGROUP" --query 'nodegroup.health.issues' --output json)

    if [[ "$HEALTH_ISSUES" != "[]" ]]; then
        echo "Health issues found in node group $NODEGROUP: $HEALTH_ISSUES"

        # Get the Auto Scaling Group name
        ASG_NAME=$(aws eks describe-nodegroup --cluster-name "$CLUSTER_NAME" --nodegroup-name "$NODEGROUP" --query 'nodegroup.resources.autoScalingGroups[0].name' --output text)

        if [[ -n "$ASG_NAME" && "$ASG_NAME" != "None" ]]; then
            echo "Starting instance refresh for ASG: $ASG_NAME"

            # Start instance refresh
            REFRESH_ID=$(aws autoscaling start-instance-refresh \
                --auto-scaling-group-name "$ASG_NAME" \
                --preferences '{"InstanceWarmup": 300, "MinHealthyPercentage": 50}' \
                --query 'InstanceRefreshId' --output text)

            echo "Instance refresh started with ID: $REFRESH_ID"

            # Wait for instance refresh to complete
            echo "Waiting for instance refresh to complete..."
            while true; do
                STATUS=$(aws autoscaling describe-instance-refreshes \
                    --auto-scaling-group-name "$ASG_NAME" \
                    --instance-refresh-ids "$REFRESH_ID" \
                    --query 'InstanceRefreshes[0].Status' --output text)

                echo "Instance refresh status: $STATUS"

                if [[ "$STATUS" == "Successful" ]]; then
                    echo "Instance refresh completed successfully"
                    break
                elif [[ "$STATUS" == "Failed" || "$STATUS" == "Cancelled" ]]; then
                    echo "Instance refresh failed with status: $STATUS"
                    exit 1
                fi

                sleep 30
            done

            # Re-check node group health after refresh
            echo "Re-checking node group health after refresh..."
            sleep 60  # Wait a bit for nodes to stabilize

            HEALTH_ISSUES_AFTER=$(aws eks describe-nodegroup --cluster-name "$CLUSTER_NAME" --nodegroup-name "$NODEGROUP" --query 'nodegroup.health.issues' --output json)

            if [[ "$HEALTH_ISSUES_AFTER" != "[]" ]]; then
                echo "Health issues still present after refresh: $HEALTH_ISSUES_AFTER"
                exit 1
            else
                echo "Node group $NODEGROUP is now healthy"
            fi
        else
            echo "Could not find Auto Scaling Group for node group $NODEGROUP"
            exit 1
        fi
    else
        echo "Node group $NODEGROUP is healthy"
    fi
done

echo "All node groups are healthy"