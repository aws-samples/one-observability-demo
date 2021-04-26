#!/bin/bash

set -ex 

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

rm -rf ./assets
mkdir -p assets

cd ./pet_stack
zip -r ../assets/SourceCode.zip . -x "node_modules/**" "cdk.out/*" "out/*" "resources/aws-distro-for-opentelemetry-python-38-preview.zip" "resources/function.zip" ".vscode/**"
cp resources/aws-distro-for-opentelemetry-python-38-preview.zip ../assets/
cp resources/function.zip ../assets/

cd ../../
zip -r cdk/assets/Microservices.zip . -x "cdk/**"
