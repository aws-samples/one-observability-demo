#!/usr/bin/env bash

if [ -z "$AWS_REGION" ]; then
	echo "error: environment variable AWS_REGION not set. Aborting."
	exit 1
fi

cd /tmp

# install helm
echo "Installing helm"
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
chmod 700 get_helm.sh
./get_helm.sh
rm get_helm.sh

# install awscurl
echo "install awscurl"
pip install awscurl

cd -
