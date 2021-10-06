#!/bin/bash

set -ex 

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

rm -rf ./assets
mkdir -p assets

zip -r ./assets/SourceCode.zip . -x ".*" "*/.*" "*/obj/**" ".git/**" "*/node_modules/**" "*/cdk.out/*" "*/out/**" 