#!/bin/bash

set -ex 

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

rm -f ./assets/*

cd ./pet_stack
zip -r ../assets/SourceCode.zip . -x "node_modules/**" "cdk.out/*" "out/*" "resources/aws-distro-for-opentelemetry-python-38-preview.zip" ".vscode/**"
cp resources/aws-distro-for-opentelemetry-python-38-preview.zip ../assets/
cp ../../petsupdater/function.zip ../assets/