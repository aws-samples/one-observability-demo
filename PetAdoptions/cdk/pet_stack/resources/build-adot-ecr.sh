#!/bin/bash

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
FROM public.ecr.aws/aws-observability/aws-otel-collector:latest
COPY config.yaml /etc/ecs/otel-config.yaml
CMD ["--config=/etc/ecs/otel-config.yaml"]
EOF

# Create config file
cat > config.yaml <<EOF
receivers:
  prometheus:
    config:
      global:
        scrape_interval: 15s
        scrape_timeout: 10s
      scrape_configs:
      - job_name: "app"
        static_configs:
        - targets: [ 0.0.0.0:80 ]
  awsecscontainermetrics:
    collection_interval: 20s

processors:
  filter:
    metrics:
      include:
        match_type: strict
        metric_names:
          - ecs.task.memory.utilized
          - ecs.task.memory.reserved
          - ecs.task.cpu.utilized
          - ecs.task.cpu.reserved
          - ecs.task.network.rate.rx
          - ecs.task.network.rate.tx
          - ecs.task.storage.read_bytes
          - ecs.task.storage.write_bytes

exporters:
  awsprometheusremotewrite:
    endpoint: https://aps-workspaces.eu-west-1.amazonaws.com/workspaces/$WORKSPACE_ID/api/v1/remote_write
    aws_auth:
      service: aps
      region: $REGION

  logging:
    loglevel: debug

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      exporters: [logging, awsprometheusremotewrite]
    metrics/ecs:
      receivers: [awsecscontainermetrics]
      processors: [filter]
      exporters: [logging, awsprometheusremotewrite]
EOF

# Build and push image
docker build . -t $image_name
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REPOSITORY_URI
docker tag "$image_name:latest" $ECR_REPOSITORY_URI
docker push $ECR_REPOSITORY_URI

cd -