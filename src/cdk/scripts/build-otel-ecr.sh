#!/bin/bash

# Minimal OTEL Collector for Prometheus scraping + ECS container metrics
# Usage: ./build-minimal-otel-with-ecs-metrics-ecr.sh AMP_WORKSPACE_ID ECR_REPOSITORY_URI REGION

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
FROM otel/opentelemetry-collector-contrib:latest
COPY config.yaml /etc/ecs/otel-config.yaml
CMD ["--config=/etc/ecs/otel-config.yaml"]
EOF

# Create minimal config file - Prometheus scraping + ECS container metrics
cat > config.yaml <<EOF
extensions:
  sigv4auth:
    region: $REGION
        
receivers:
  # Prometheus scraping
  prometheus:
    config:
      global:
        scrape_interval: 15s
        scrape_timeout: 10s
        external_labels:
          collector_id: "\${HOSTNAME}"
      scrape_configs:
      - job_name: "petfood-rs-prometheus"
        static_configs:
        - targets: [ "127.0.0.1:8080" ]
        metrics_path: "/metrics"
  
  # ECS container metrics
  awsecscontainermetrics:
    collection_interval: 15s

processors:
  resourcedetection:
    detectors:
      - env
      - ecs
    timeout: 2s
    override: false
  batch/metrics:
    timeout: 5s
    send_batch_size: 1024

exporters:
  # Send to AMP
  prometheusremotewrite:
    endpoint: "https://aps-workspaces.$REGION.amazonaws.com/workspaces/$WORKSPACE_ID/api/v1/remote_write"
    auth:
      authenticator: sigv4auth
    resource_to_telemetry_conversion:
      enabled: true
  # Debug logging
  debug:
    verbosity: detailed

service:
  extensions: [sigv4auth]
  pipelines:
    # Prometheus metrics pipeline
    metrics:
      receivers: [prometheus]
      processors: [resourcedetection, batch/metrics]
      exporters: [prometheusremotewrite, debug]
    
    # ECS container metrics pipeline
    metrics/ecs:
      receivers: [awsecscontainermetrics]
      processors: [resource]
      exporters: [prometheusremotewrite, debug]
EOF

# Build and push image
docker build . -t $image_name
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REPOSITORY_URI
docker tag "$image_name:latest" $ECR_REPOSITORY_URI
docker push $ECR_REPOSITORY_URI

cd -
