#!/bin/bash


# Get the ELB URL
ELB=$(kubectl get service service-petsite -o json | jq -r '.status.loadBalancer.ingress[].hostname')
ELB="http://"$ELB

echo ----- Creating SSM Parameter -----

aws ssm put-parameter --name "/petstore/petsiteurl" --value $ELB --type "String"  --region $AWS_REGION --overwrite

echo ----- ✅ DONE --------
