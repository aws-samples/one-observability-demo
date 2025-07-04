#!/bin/bash

echo ---------------------------------------------------------------------------------------------
echo This script destroys the resources created in the workshop
echo ---------------------------------------------------------------------------------------------

# Parse command line arguments
FORCE_CLEANUP=false
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--force)
            FORCE_CLEANUP=true
            echo "🚨 Force cleanup mode enabled - will delete dangling resources tagged with Workshop=true"
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [-f|--force] [-h|--help]"
            echo "  -f, --force    Enable force cleanup of dangling resources (use with caution)"
            echo "  -h, --help     Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

if [ -z "$AWS_REGION" ]; then
	echo "Fatal: environment variable AWS_REGION not set. Aborting."
	exit 1
fi

# Function to check if stack deletion failed
check_stack_deletion_status() {
    local stack_name=$1
    local status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --query 'Stacks[0].StackStatus' --output text 2>/dev/null)

    if [[ "$status" == "DELETE_FAILED" ]]; then
        echo "⚠️  Stack $stack_name deletion failed. Status: $status"
        return 1
    elif [[ "$status" == "DELETE_COMPLETE" ]] || [[ -z "$status" ]]; then
        echo "✅ Stack $stack_name deleted successfully or doesn't exist"
        return 0
    else
        echo "ℹ️  Stack $stack_name status: $status"
        return 0
    fi
}

# Function to force delete EKS cluster
force_delete_eks_cluster() {
    echo "🔍 Checking for EKS clusters tagged with Workshop=true..."

    local clusters=$(aws eks list-clusters --query 'clusters[]' --output text)

    for cluster in $clusters; do
        local tags=$(aws eks list-tags-for-resource --resource-arn "arn:aws:eks:$AWS_REGION:$(aws sts get-caller-identity --query Account --output text):cluster/$cluster" --query 'tags.Workshop' --output text 2>/dev/null)

        if [[ "$tags" == "true" ]]; then
            echo "🗑️  Force deleting EKS cluster: $cluster"

            # Delete node groups first
            local nodegroups=$(aws eks list-nodegroups --cluster-name "$cluster" --query 'nodegroups[]' --output text 2>/dev/null)
            for ng in $nodegroups; do
                echo "   Deleting node group: $ng"
                aws eks delete-nodegroup --cluster-name "$cluster" --nodegroup-name "$ng" 2>/dev/null
            done

            # Wait for node groups to be deleted
            for ng in $nodegroups; do
                echo "   Waiting for node group $ng to be deleted..."
                aws eks wait nodegroup-deleted --cluster-name "$cluster" --nodegroup-name "$ng" 2>/dev/null
            done

            # Delete the cluster
            aws eks delete-cluster --name "$cluster"
            echo "   Waiting for cluster $cluster to be deleted..."
            aws eks wait cluster-deleted --name "$cluster"
            echo "✅ EKS cluster $cluster deleted"
        fi
    done
}

# Function to force delete VPC and related resources
force_delete_vpc_resources() {
    echo "🔍 Checking for VPCs tagged with Workshop=true..."

    local vpcs=$(aws ec2 describe-vpcs --filters "Name=tag:Workshop,Values=true" --query 'Vpcs[].VpcId' --output text)

    for vpc in $vpcs; do
        echo "🗑️  Force deleting VPC and related resources: $vpc"

        # Delete NAT Gateways
        local nat_gateways=$(aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$vpc" --query 'NatGateways[?State==`available`].NatGatewayId' --output text)
        for nat in $nat_gateways; do
            echo "   Deleting NAT Gateway: $nat"
            aws ec2 delete-nat-gateway --nat-gateway-id "$nat"
        done

        # Wait for NAT Gateways to be deleted
        for nat in $nat_gateways; do
            echo "   Waiting for NAT Gateway $nat to be deleted..."
            aws ec2 wait nat-gateway-deleted --nat-gateway-ids "$nat" 2>/dev/null || true
        done

        # Delete Internet Gateway
        local igws=$(aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$vpc" --query 'InternetGateways[].InternetGatewayId' --output text)
        for igw in $igws; do
            echo "   Detaching and deleting Internet Gateway: $igw"
            aws ec2 detach-internet-gateway --internet-gateway-id "$igw" --vpc-id "$vpc" 2>/dev/null
            aws ec2 delete-internet-gateway --internet-gateway-id "$igw" 2>/dev/null
        done

        # Delete subnets
        local subnets=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpc" --query 'Subnets[].SubnetId' --output text)
        for subnet in $subnets; do
            echo "   Deleting subnet: $subnet"
            aws ec2 delete-subnet --subnet-id "$subnet" 2>/dev/null
        done

        # Delete route tables (except main)
        local route_tables=$(aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$vpc" --query 'RouteTables[?Associations[0].Main!=`true`].RouteTableId' --output text)
        for rt in $route_tables; do
            echo "   Deleting route table: $rt"
            aws ec2 delete-route-table --route-table-id "$rt" 2>/dev/null
        done

        # Delete security groups (except default)
        local security_groups=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$vpc" --query 'SecurityGroups[?GroupName!=`default`].GroupId' --output text)
        for sg in $security_groups; do
            echo "   Deleting security group: $sg"
            aws ec2 delete-security-group --group-id "$sg" 2>/dev/null
        done

        # Delete VPC
        echo "   Deleting VPC: $vpc"
        aws ec2 delete-vpc --vpc-id "$vpc" 2>/dev/null
        echo "✅ VPC $vpc and related resources deleted"
    done
}

# Function to delete other tagged resources
force_delete_other_resources() {
    echo "🔍 Checking for other resources tagged with Workshop=true..."

    # Delete Load Balancers
    local elbs=$(aws elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerArn' --output text)
    for elb_arn in $elbs; do
        local tags=$(aws elbv2 describe-tags --resource-arns "$elb_arn" --query 'TagDescriptions[0].Tags[?Key==`Workshop`].Value' --output text 2>/dev/null)
        if [[ "$tags" == "true" ]]; then
            echo "🗑️  Deleting Load Balancer: $elb_arn"
            aws elbv2 delete-load-balancer --load-balancer-arn "$elb_arn"
        fi
    done

    # Delete RDS instances
    local rds_instances=$(aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text)
    for db in $rds_instances; do
        local tags=$(aws rds list-tags-for-resource --resource-name "arn:aws:rds:$AWS_REGION:$(aws sts get-caller-identity --query Account --output text):db:$db" --query 'TagList[?Key==`Workshop`].Value' --output text 2>/dev/null)
        if [[ "$tags" == "true" ]]; then
            echo "🗑️  Deleting RDS instance: $db"
            aws rds delete-db-instance --db-instance-identifier "$db" --skip-final-snapshot --delete-automated-backups
        fi
    done
}

# Disable Contributor Insights
DDB_CONTRIB=$(aws ssm get-parameter --name '/petstore/dynamodbtablename' | jq .Parameter.Value -r)
aws dynamodb update-contributor-insights --table-name $DDB_CONTRIB --contributor-insights-action DISABLE

# Delete Network Flow Monitor
if aws networkflowmonitor get-monitor --monitor-name network-flow-monitor-demo >/dev/null 2>&1; then
    echo "Deleting network flow monitor..."
    aws networkflowmonitor delete-monitor --monitor-name network-flow-monitor-demo
else
    echo "Network flow monitor not found, skipping delete."
fi

echo STARTING SERVICES CLEANUP
echo -----------------------------

# Get the main stack name
STACK_NAME=$(aws ssm get-parameter --name '/petstore/stackname' --region $AWS_REGION | jq .Parameter.Value -r)
STACK_NAME_APP=$(aws ssm get-parameter --name '/eks/petsite/stackname' --region $AWS_REGION | jq .Parameter.Value -r)

# Set default name in case Parameters are gone (partial deletion)
if [ -z $STACK_NAME ]; then STACK_NAME="Services"; fi
if [ -z $STACK_NAME_APP ]; then STACK_NAME_APP="Applications"; fi
if [ -z $STACK_NAME_CODEPIPELINE ]; then STACK_NAME_CODEPIPELINE="Observability-Workshop"; fi

# Fix for CDK teardown issues
aws eks update-kubeconfig --name PetSite
kubectl delete -f https://raw.githubusercontent.com/aws-samples/one-observability-demo/main/PetAdoptions/cdk/pet_stack/resources/load_balancer/crds.yaml

#Deleting keycloak
kubectl delete namespace keycloak --force

# Sometimes the SqlSeeder doesn't get deleted cleanly. This helps clean up the environment completely including Sqlseeder
aws cloudformation delete-stack --stack-name $STACK_NAME_APP
aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME_APP

# Check if Applications stack deletion failed and force cleanup if needed
if ! check_stack_deletion_status "$STACK_NAME_APP"; then
    if [ "$FORCE_CLEANUP" = true ]; then
        echo "🚨 Applications stack deletion failed. Starting force cleanup..."
        force_delete_eks_cluster
        force_delete_vpc_resources
        force_delete_other_resources
    else
        echo "⚠️  Applications stack deletion failed. Use -f flag to enable force cleanup of dangling resources."
    fi
fi

aws cloudformation delete-stack --stack-name $STACK_NAME
aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME

# Check if Services stack deletion failed and force cleanup if needed
if ! check_stack_deletion_status "$STACK_NAME"; then
    if [ "$FORCE_CLEANUP" = true ]; then
        echo "🚨 Services stack deletion failed. Starting force cleanup..."
        force_delete_vpc_resources
        force_delete_other_resources
    else
        echo "⚠️  Services stack deletion failed. Use -f flag to enable force cleanup of dangling resources."
    fi
fi

aws cloudwatch delete-dashboards --dashboard-names "EKS_FluentBit_Dashboard"

# delete the code pipeline stack
aws cloudformation delete-stack --stack-name $STACK_NAME_CODEPIPELINE
aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME_CODEPIPELINE

# Check if CodePipeline stack deletion failed and force cleanup if needed
if ! check_stack_deletion_status "$STACK_NAME_CODEPIPELINE"; then
    if [ "$FORCE_CLEANUP" = true ]; then
        echo "🚨 CodePipeline stack deletion failed. Starting force cleanup..."
        force_delete_other_resources
    else
        echo "⚠️  CodePipeline stack deletion failed. Use -f flag to enable force cleanup of dangling resources."
    fi
fi

echo CDK BOOTSTRAP WAS NOT DELETED

echo ----- ✅ DONE --------