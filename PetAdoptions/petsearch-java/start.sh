#!/bin/sh

# Start CloudWatch agent in background (if available)
if [ -f "/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl" ]; then
    echo "Starting CloudWatch agent..."
    /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/etc/cwagentconfig/amazon-cloudwatch-agent.json &
    /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent &
else
    echo "CloudWatch agent not found, skipping..."
fi

# Start the Java application with OpenTelemetry instrumentation
echo "Starting Java application with OpenTelemetry instrumentation..."
java -jar /app/app.jar 