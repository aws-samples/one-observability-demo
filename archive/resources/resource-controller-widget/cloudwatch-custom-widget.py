# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import json
import os

import boto3

ecs_client = boto3.client("ecs")
eks_client = boto3.client("eks")

EKS_CLUSTER_NAME = os.environ["EKS_CLUSTER_NAME"]
CONTROLER_LAMBDA_ARN = os.environ["CONTROLER_LAMBDA_ARN"]
ECS_CLUSTER_ARNS = os.environ["ECS_CLUSTER_ARNS"].split(",")


def get_current_status(number_of_tasks):
    """Function to return HTML tag based on number of tasks"""
    if number_of_tasks == 0:
        return 'checked="checked"'
    else:
        return ""


def get_current_count():
    """Get the current ECS and EKS node counts"""
    clusters = ecs_client.list_clusters()
    ecs_task_count = 0
    for cluster in clusters["clusterArns"]:
        if cluster in ECS_CLUSTER_ARNS:
            services = ecs_client.list_services(cluster=cluster)
            service_info = ecs_client.describe_services(
                cluster=cluster,
                services=services["serviceArns"],
            )
            for svc in service_info["services"]:
                ecs_task_count += svc["desiredCount"]
    eks_node_count = 0
    nodegroups = eks_client.list_nodegroups(clusterName=EKS_CLUSTER_NAME)
    for group in nodegroups["nodegroups"]:
        if EKS_CLUSTER_NAME.lower() + "nodegroup" in group.lower():
            node_group_info = eks_client.describe_nodegroup(
                clusterName=EKS_CLUSTER_NAME,
                nodegroupName=group,
            )
            eks_node_count = node_group_info["nodegroup"]["scalingConfig"][
                "desiredSize"
            ]
            break
    return ecs_task_count, eks_node_count


def generate_function_event(status):
    """Return Event content based on status"""
    return json.dumps({"Action": status})


def get_current_status_string(number_of_tasks):
    """Return text based on the status"""
    if number_of_tasks == 0:
        return (
            "Clicking on this button now will re-start the ECS tasks and "
            "nodes on the EKS cluster. The application will be functional "
            "again and monitoring data will be generated"
        )
    else:
        return (
            "Clicking on this button now will set the ECS task count and "
            "EKS Node count to ZERO, saving you money. The application will "
            "not be functional and hence no monitoring data will be generated "
            "until the services are enabled once again"
        )


def get_current_status_string_header(number_of_tasks):
    """Return text based on the status"""
    if number_of_tasks == 0:
        return "Start ECS Tasks and EKS nodes"
    else:
        return "Stop ECS Tasks and EKS nodes"


def generate_html(ecs_tasks, eks_nodes):
    """Function to generate HTML dynamically"""
    if ecs_tasks + eks_nodes == 0:
        status = "enable"
    else:
        status = "disable"
    toggle = """
    <!DOCTYPE html>
    <html>
    <center>
    <table>
    <tr>
    <th>
    <head>
        <title>toggle switch</title>
        <style>
            /* toggle in label designing */
            .toggle {
                position : relative ;
                display : inline-block;
                width : 70px;
                height : 26px;
                background-color: grey;
                border-radius: 50px;
            }
            /* After slide changes */
            .toggle:after {
                content: '';
                position: absolute;
                width: 22px;
                height: 22px;
                border-radius: 50%;
                background-color: #fff;
                top: 2px;
                left: 2px;
                transition:  all 0.5s;
            }
            /* Checkbox checked effect */
            .checkbox:checked + .toggle::after {
                left : calc(100% - 3px);
                transform: translateX(-100%);
            }
            /* Checkbox checked toggle label bg color */
            .checkbox:checked + .toggle {
                background-color: Orange;
            }
            /* Checkbox vanished */
            .checkbox {
                display : none;
            }
        </style>
    </head>
    """
    toggle += f"""
    <body>
        <center>
            <b>{get_current_status_string_header(ecs_tasks+eks_nodes)}:
            <input type="checkbox" id="switch" class="checkbox" "
            f"{get_current_status(ecs_tasks+eks_nodes)} />"
            <label for="switch" class="toggle">
            <p>&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp</p>
            <cwdb-action action="call" endpoint={str(CONTROLER_LAMBDA_ARN)} "
            f"display="widget" "
            f"confirmation="{get_current_status_string(ecs_tasks+eks_nodes)}" >"
                {generate_function_event(status)}
            </cwdb-action></b>
            </label>
        </center>
    </body>
    </th>
    <th>
    <body>
        <center>
            <p></p>
            <p>ECS Services Total Task Count: {ecs_tasks}</p>
            <p>EKS Nodegroup Node Count: {eks_nodes}</p>
        </center>
    </body>
    </th>
    </tr>
    </table>
    </center>
    </html>
    """
    return toggle


def lambda_handler(event, context):
    """Main function to rander the Custom Widget HTML"""
    ecs_tasks, eks_nodes = get_current_count()
    return generate_html(ecs_tasks, eks_nodes)
