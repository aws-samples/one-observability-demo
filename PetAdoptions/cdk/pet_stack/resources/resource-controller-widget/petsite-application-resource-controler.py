"""
This function will be triggered by Cloudwatch Custom Widget lambda function. You can also trigger it manually with below evetn.
To stop ECS and EKS resources: {'Action':'disable'}
To start ECS and EKS resources: {'Action':'enable'}
"""

import boto3
import time

ecs_client = boto3.client('ecs')
eks_client = boto3.client('eks')

EKS_CLUSTER_NAME = 'PetSite'

def set_ecs_desired_task_count_to_zero(cluster):
    """Function to set ECS Desired Tasks counts to 0 for all ECS Cluster Services"""
    services = ecs_client.list_services(
        cluster = cluster
        )
    for service in services['serviceArns']:
        update_response = ecs_client.update_service(
            cluster = cluster,
            service = service,
            desiredCount = 0)
    return 0

def set_ecs_desired_task_count_to_normal(cluster):
    """Function to set ECS Desired Tasks counts to 2 for all ECS Cluster Services except trafficgeneratorservice"""
    services = ecs_client.list_services(
        cluster = cluster
        )
    for service in services['serviceArns']:
        desired_count = 2
        if 'trafficgeneratorserviceecsservice' in service:
            desired_count = 1
        update_response = ecs_client.update_service(
            cluster = cluster,
            service = service,
            desiredCount = desired_count)
    return 0

def manageECSTasks(status):
    """Enable/Disable ECS Tasks"""
    clusters = ecs_client.list_clusters()
    for cluster in clusters['clusterArns']:
        if ("Services-PayForAdoption" in cluster) or ("Services-PetSearch" in cluster) or ("Services-PetListAdoptions" in cluster):
            if status == "enable":
                set_ecs_desired_task_count_to_normal(cluster)
            elif status == "disable":
                set_ecs_desired_task_count_to_zero(cluster)
    if status == "enable":
        return "ECS Tasks Count set back to Normal"
    else:
        return "ECS Tasks Count set to Zero"

def waitTillUpdateCompletes(update_response,nodegroup_name):
    """Waiter function to wait till EKS cluster accepts the update"""
    update_in_progress = True
    while update_in_progress:
        update_status = eks_client.describe_update(
            name = EKS_CLUSTER_NAME,
            updateId = update_response['update']['id'],
            nodegroupName = nodegroup_name
        )
        if update_status['update']['status'] == 'InProgress':
            time.sleep(5)
        else:
            update_in_progress = False

def setEKSNodeGroupCountToNormal(nodegroup_name):
    """Function to set EKS nodegroup node desired count to 2"""
    update_response = eks_client.update_nodegroup_config(
        clusterName='PetSite',
        nodegroupName=nodegroup_name,
        scalingConfig={
            'minSize': 2,
            'desiredSize': 2
        },
    )
    waitTillUpdateCompletes(update_response,nodegroup_name)

def setEKSNodeGroupCountToZero(nodegroup_name):
    """Function to set EKS nodegroup node desired count to 0"""
    update_response = eks_client.update_nodegroup_config(
        clusterName=EKS_CLUSTER_NAME,
        nodegroupName=nodegroup_name,
        scalingConfig={
            'minSize': 0,
            'desiredSize': 0
        },
    )
    waitTillUpdateCompletes(update_response,nodegroup_name)

def manageEKSNodes(status):
    """Enable/Disable the EKS nodegroup Count"""
    nodegroups = eks_client.list_nodegroups(
        clusterName=EKS_CLUSTER_NAME)
    for group in nodegroups['nodegroups']:
        if 'petsiteNodegroup' in group:
            nodegroup_name = group
            break
    if status == "enable":
        setEKSNodeGroupCountToNormal(nodegroup_name)
        return "EKS Nodegroup Count set back to Normal"
    elif status == "disable":
        setEKSNodeGroupCountToZero(nodegroup_name)
        return "EKS Nodegroup Count set to Zero"


def lambda_handler(event, context):
    """Main function to control ECS and EKS resources"""
    output1 = manageECSTasks(event['Action'])
    output2 = manageEKSNodes(event['Action'])
    return output1 + ', '+ output2
