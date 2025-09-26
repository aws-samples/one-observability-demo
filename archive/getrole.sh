#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

currentRole=$(aws sts get-caller-identity --query Arn --output text)

if echo ${currentRole} | grep -q assumed-role; then
    assumedrolename=$(echo ${currentRole} | awk -F/ '{print $(NF-1)}')
    rolearn=$(aws iam get-role --role-name ${assumedrolename} --query Role.Arn --output text)
    echo ${rolearn}
    exit 0
elif echo ${currentRole} | grep -q user; then
    echo ${currentRole}
    exit 0
fi

exit 1