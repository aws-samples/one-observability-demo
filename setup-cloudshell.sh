#!/usr/bin/env bash

if [ -z "$AWS_REGION" ]; then
	echo "error: environment variable AWS_REGION not set. Aborting."
	exit 1
fi

function install_helm(){
	echo "Installing helm"
	curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
	chmod 700 get_helm.sh
	./get_helm.sh
	sudo mv $(which helm) $HOME/.local/bin/
	rm get_helm.sh
}

function install_eksctl(){
	echo "Installing eksctl"
	ARCH=amd64
	PLATFORM=$(uname -s)_$ARCH
	curl -sLO "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_$PLATFORM.tar.gz"
	curl -sL "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_checksums.txt" | grep $PLATFORM | sha256sum --check
	tar -xzf eksctl_$PLATFORM.tar.gz -C /tmp && rm eksctl_$PLATFORM.tar.gz
	sudo mv /tmp/eksctl $HOME/.local/bin/
}

function install_awscurl(){
	echo "Installing awscurl"
	pip install awscurl
}

mkdir -p $HOME/.local/bin
cd /tmp

# install helm
command -v helm >/dev/null 2>&1 ||
	{ install_helm; }

# install awscurl
command -v awscurl >/dev/null 2>&1 ||
	{ install_awscurl; }

# install eksctl
command -v eksctl >/dev/null 2>&1 ||
	{ install_eksctl; }

echo "All dependencies installed!"

cd -
