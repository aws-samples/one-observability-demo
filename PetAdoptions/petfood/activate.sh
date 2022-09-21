#!/bin/bash


deploy () {
    cd $HOME/environment/workshopfiles/one-observability-demo/PetAdoptions/${service}
    echo In directory `pwd`
    echo "Startng deployment of ${service}"

    if [ ! "`aws ecr describe-repositories --repository-names ${service}`" ] ; then
        echo ${service} repository not found, creating...
        aws ecr create-repository --repository-name ${service}
    else
        echo ${service} repository found, skipping creation
    fi

    aws ecr get-login-password | docker login --username AWS --password-stdin `aws ecr describe-repositories --repository-names ${service} | jq .repositories[0].repositoryUri | sed "s/\"//g"`

    docker build -t ${service}:1 .
    docker tag ${service}:1 `aws ecr describe-repositories --repository-names ${service} | jq .repositories[0].repositoryUri | sed "s/\"//g"`:1
    docker push `aws ecr describe-repositories --repository-names ${service} | jq .repositories[0].repositoryUri | sed "s/\"//g"`:1

    sed -i "s/DEPLOYMENTACCOUNT/${ACCOUNT_ID}/g" deployment.yaml
    sed -i "s/DEPLOYMENTREGION/${AWS_REGION}/g" deployment.yaml
    kubectl apply -f deployment.yaml
}


permissions () {
    echo Attaching IAM policy to EKS nodes

    echo Fetching EC2 instance profile
    profile=`aws ec2 describe-instances --filters "Name=tag-key,Values=eks:cluster-name" "Name=tag-value,Values=PetSite" | jq -r .Reservations[].Instances[].IamInstanceProfile.Arn | head -n 1 | cut -f 2 -d '/'`
    echo Found instance profile: ${profile}

    role=`aws iam get-instance-profile --instance-profile-name ${profile} | jq -r .InstanceProfile.Roles[].RoleName`
    echo Found role: ${role}

    if [ ! "`aws iam get-role-policy --role-name ${role} --policy-name evidently`" ] ; then
        echo Attaching new Evidently policy to role
        aws iam put-role-policy --role-name ${role} --policy-name evidently --policy-document file://$HOME/environment/workshopfiles/one-observability-demo/PetAdoptions/${service}/policy.json
    else
        echo Role has an Evidently policy already
    fi
}


service="petfood"
deploy

service="petfood-metric"
deploy

permissions
