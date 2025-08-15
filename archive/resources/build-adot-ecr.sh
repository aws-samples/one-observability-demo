#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

set -euxo pipefail

script_name=$0

function usage(){
    echo "Usage: ${script_name} AMP_WORKSPACE_ID ECR_REPOSITORY_URI REGION";
    return 1;
}

[ $# -ne 3 ] && usage
WORKSPACE_ID=$1
ECR_REPOSITORY_URI=$2
REGION=$3
image_name="${ECR_REPOSITORY_URI#*/}"

# Verify AMP workspace, ECR image and region
aws amp describe-workspace --workspace-id $WORKSPACE_ID --region $REGION > /dev/null
aws ecr describe-repositories --repository-names ${ECR_REPOSITORY_URI#*/} --region $REGION >/dev/null

# setup dockerfile
mkdir -p "/tmp/$image_name"
cd "/tmp/$image_name"
cat > Dockerfile <<EOF
FROM public.ecr.aws/aws-observability/aws-otel-collector:v0.21.0
COPY config.yaml /etc/ecs/otel-config.yaml
CMD ["--config=/etc/ecs/otel-config.yaml"]
EOF

# Create config file
cat > config.yaml <<EOF
extensions:
  sigv4auth:
    region: $REGION

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
  prometheus:
    config:
      global:
        scrape_interval: 15s
        scrape_timeout: 10s
      scrape_configs:
      - job_name: "test-prometheus-sample-app"
        static_configs:
        - targets: [ 0.0.0.0:80 ]
  awsecscontainermetrics:
    collection_interval: 15s

processors:
  resourcedetection:
    detectors:
      - env
      - system
      - ecs
      - ec2
  batch/traces:
    timeout: 1s
    send_batch_size: 50
  filter:
    metrics:
      include:
        match_type: strict
        metric_names:
          - ecs.task.memory.utilized
          - ecs.task.memory.reserved
          - ecs.task.memory.usage
          - ecs.task.cpu.utilized
          - ecs.task.cpu.reserved
          - ecs.task.cpu.usage.vcpu
          - ecs.task.network.rate.rx
          - ecs.task.network.rate.tx
          - ecs.task.storage.read_bytes
          - ecs.task.storage.write_bytes

  metricstransform:
    transforms:
      - include: ecs.task.memory.utilized
        action: update
        new_name: MemoryUtilized
      - include: ecs.task.memory.reserved
        action: update
        new_name: MemoryReserved
      - include: ecs.task.memory.usage
        action: update
        new_name: MemoryUsage
      - include: ecs.task.cpu.utilized
        action: update
        new_name: CpuUtilized
      - include: ecs.task.cpu.reserved
        action: update
        new_name: CpuReserved
      - include: ecs.task.cpu.usage.vcpu
        action: update
        new_name: CpuUsage
      - include: ecs.task.network.rate.rx
        action: update
        new_name: NetworkRxBytes
      - include: ecs.task.network.rate.tx
        action: update
        new_name: NetworkTxBytes
      - include: ecs.task.storage.read_bytes
        action: update
        new_name: StorageReadBytes
      - include: ecs.task.storage.write_bytes
        action: update
        new_name: StorageWriteBytes

  resource:
    attributes:
      - key: ClusterName
        from_attribute: aws.ecs.cluster.name
        action: insert
      - key: aws.ecs.cluster.name
        action: delete
      - key: ServiceName
        from_attribute: aws.ecs.service.name
        action: insert
      - key: aws.ecs.service.name
        action: delete
      - key: TaskId
        from_attribute: aws.ecs.task.id
        action: insert
      - key: aws.ecs.task.id
        action: delete
      - key: TaskDefinitionFamily
        from_attribute: aws.ecs.task.family
        action: insert
      - key: aws.ecs.task.family
        action: delete

exporters:
  awsxray:
  prometheusremotewrite:
    endpoint: "https://aps-workspaces.$REGION.amazonaws.com/workspaces/$WORKSPACE_ID/api/v1/remote_write"
    auth:
      authenticator: sigv4auth
  logging:
    loglevel: debug

service:
  extensions: [sigv4auth]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection, batch/traces]
      exporters: [awsxray]
    metrics:
      receivers: [prometheus]
      exporters: [logging, prometheusremotewrite]
    metrics/ecs:
      receivers: [awsecscontainermetrics]
      processors: [filter]
      exporters: [logging, prometheusremotewrite]
EOF

# Build and push image
docker build . -t $image_name
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REPOSITORY_URI
docker tag "$image_name:latest" $ECR_REPOSITORY_URI
docker push $ECR_REPOSITORY_URI

cd -
