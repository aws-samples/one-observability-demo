#!/usr/bin/env bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

while true
do
    drill -s --benchmark benchmark.yaml
    sleep 1
done
