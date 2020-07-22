#
# Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of this
# software and associated documentation files (the "Software"), to deal in the Software
# without restriction, including without limitation the rights to use, copy, modify,
# merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
# permit persons to whom the Software is furnished to do so.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
# INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
# PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
# HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
# OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
# SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
#

#title           envsetup.sh
#description     This script will setup the Cloud9 IDE with the prerequisite packages and code for the Observability workshop.
#author          Imaya Kumar Jagannathan (@ijaganna)
#contributors    @ijaganna
#date            2020-05-24
#version         0.1
#usage           curl -sSL https://raw.githubusercontent.com/awsimaya/PetAdoptions/master/envsetup.sh | bash -s stable
#==============================================================================

# Create a directory
foldername=workshopfiles
mkdir $foldername
cd $foldername

# Install jq
sudo yum -y -q install jq

# Update awscli
pip install --user --upgrade awscli

# Install awscli v2
curl -O "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" 
unzip -o awscli-exe-linux-x86_64.zip
sudo ./aws/install


# Install bash-completion
sudo yum install bash-completion -y -q

# Install kubectl 1.16.8
curl -o kubectl https://amazon-eks.s3.us-west-2.amazonaws.com/1.16.8/2020-04-16/bin/linux/amd64/kubectl
chmod +x kubectl && sudo mv kubectl /usr/local/bin/
echo "source <(kubectl completion bash)" >> ~/.bashrc

# Install Heptio Authenticator
curl -o aws-iam-authenticator https://amazon-eks.s3.us-west-2.amazonaws.com/1.16.8/2020-04-16/bin/linux/amd64/aws-iam-authenticator
chmod +x ./aws-iam-authenticator && sudo mv aws-iam-authenticator /usr/local/bin/

# Configure AWS CLI
# availability_zone=$(curl http://169.254.169.254/latest/meta-data/placement/availability-zone)
# export AWS_DEFAULT_REGION=${availability_zone}

# Install eksctl
curl --silent --location "https://github.com/weaveworks/eksctl/releases/download/latest_release/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C /tmp
sudo mv /tmp/eksctl /usr/local/bin

# Install docker compose
sudo curl -L "https://github.com/docker/compose/releases/download/1.23.1/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Upgrade npm
npm install -g npm

# Upgrade CDK version
npm i -g aws-cdk --force

# Download lab repository
git clone https://github.com/awsimaya/PetAdoptions