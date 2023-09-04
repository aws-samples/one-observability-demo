#!/bin/bash

echo "This script sets up keycloak related resources for Amazon Managed Grafana SAML authentication."

export CLUSTER_NAME=PetSite
export WORKSPACE_NAME=demo-amg
export KEYCLOAK_NAMESPACE=keycloak
export KEYCLOAK_REALM_AMG=amg
export WORKSPACE_ID=$(aws grafana list-workspaces --query 'workspaces[?name==`'$WORKSPACE_NAME'`].id' --output text)

export WORKSPACE_STATUS=$(aws grafana describe-workspace --workspace-id $WORKSPACE_ID --query 'workspace.status' --output text)
while [ "$WORKSPACE_STATUS" != "ACTIVE" ]
do
  echo "Workspace status is '$WORKSPACE_STATUS'. Waiting for 10 seconds."
  sleep 10
  export WORKSPACE_STATUS=$(aws grafana describe-workspace --workspace-id $WORKSPACE_ID --query 'workspace.status' --output text)
done

export WORKSPACE_ENDPOINT=$(aws grafana describe-workspace --workspace-id $WORKSPACE_ID --query workspace.endpoint --output text)

IRSA=$(eksctl get iamserviceaccount --cluster PetSite --namespace kube-system --name ebs-csi-controller-sa -o json | jq -r '.[].metadata.name')

if [ -z "$IRSA" ]; then
  echo "IRSA for 'aws-ebs-csi-driver' will be created."
  eksctl create iamserviceaccount \
    --name ebs-csi-controller-sa \
    --namespace kube-system \
    --cluster $CLUSTER_NAME \
    --attach-policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy \
    --approve \
    --role-only \
    --role-name AmazonEKS_EBS_CSI_DriverRole
else
  echo "IRSA for 'aws-ebs-csi-driver' is already created."
fi

EBS_CSI_ADDON=$(aws eks list-addons --cluster-name $CLUSTER_NAME --query 'addons[?@==`aws-ebs-csi-driver`]' --output text)

if [ -z "$EBS_CSI_ADDON" ]; then
  echo "The addon 'aws-ebs-csi-driver' will be installed."
  eksctl create addon \
    --name aws-ebs-csi-driver \
    --cluster $CLUSTER_NAME \
    --service-account-role-arn arn:aws:iam::$ACCOUNT_ID:role/AmazonEKS_EBS_CSI_DriverRole \
    --force
  
  echo "Waiting for addon status to become 'ACTIVE'..."
  aws eks wait addon-active \
    --cluster-name $CLUSTER_NAME \
    --addon-name aws-ebs-csi-driver
else
  echo "The addon 'aws-ebs-csi-driver' is already installed."
fi

echo "Creating StorageClass..."
cat >storageclass.yaml <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-sc
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
EOF

kubectl apply -f storageclass.yaml

echo "Generating keycloak password..."
KEYCLOAK_PASSWORD=$(openssl rand -base64 8)

echo "Generating keycloak configuration..."
cat > keycloak_values.yaml <<EOF
global:
  storageClass: "ebs-sc"
image:
  registry: public.ecr.aws
  repository: bitnami/keycloak
  tag: 22.0.1-debian-11-r36
  debug: true
auth:
  adminUser: admin
  adminPassword: "$KEYCLOAK_PASSWORD"
initdbScripts:
  prep.sh: |
    #!/bin/bash
    cat > /tmp/disable_ssl.sh <<EOF
    #!/bin/bash
    while true; do
      STATUS=\\\$(curl -ifs http://localhost:8080/ | head -1)
      if [[ ! -z "\\\$STATUS" ]] && [[ "\\\$STATUS" == *"200"* ]]; then
        cd /opt/bitnami/keycloak/bin
        ./kcadm.sh config credentials --server http://localhost:8080/ --realm master --user admin --password "$KEYCLOAK_PASSWORD" --config /tmp/kcadm.config 
        ./kcadm.sh update realms/master -s sslRequired=NONE --config /tmp/kcadm.config
        break
      fi
      sleep 10
    done;
    EOF
    chmod +x /tmp/disable_ssl.sh
    nohup /tmp/disable_ssl.sh </dev/null >/dev/null 2>&1 &
    
keycloakConfigCli:
  enabled: true
  image:
    registry: public.ecr.aws
    repository: bitnami/keycloak-config-cli
    tag: 5.8.0-debian-11-r37
  command:
  - java
  - -jar
  - /opt/keycloak-config-cli.jar
  configuration:
    realm.json: |
      {
        "realm": "$KEYCLOAK_REALM_AMG",
        "enabled": true,
        "sslRequired": "none",
        "roles": {
          "realm": [
            {
              "name": "admin"
            },
            {
              "name": "editor"
            }
          ]
        },
        "users": [
          {
            "username": "admin",
            "email": "admin@keycloak",
            "enabled": true,
            "firstName": "Admin",
            "realmRoles": [
              "admin"
            ],
            "credentials": [
              {
                "type": "password",
                "value": "$KEYCLOAK_PASSWORD"
              }
            ]
          },
          {
            "username": "editor",
            "email": "editor@keycloak",
            "enabled": true,
            "firstName": "Editor",
            "realmRoles": [
              "editor"
            ],
            "credentials": [
              {
                "type": "password",
                "value": "$KEYCLOAK_PASSWORD"
              }
            ]
          }
        ],
        "clients": [
          {
            "clientId": "https://${WORKSPACE_ENDPOINT}/saml/metadata",
            "name": "amazon-managed-grafana",
            "enabled": true,
            "protocol": "saml",
            "adminUrl": "https://${WORKSPACE_ENDPOINT}/login/saml",
            "redirectUris": [
              "https://${WORKSPACE_ENDPOINT}/saml/acs"
            ],
            "attributes": {
              "saml.authnstatement": "true",
              "saml.server.signature": "true",
              "saml_name_id_format": "email",
              "saml_force_name_id_format": "true",
              "saml.assertion.signature": "true",
              "saml.client.signature": "false"
            },
            "defaultClientScopes": [],
            "protocolMappers": [
              {
                "name": "name",
                "protocol": "saml",
                "protocolMapper": "saml-user-property-mapper",
                "consentRequired": false,
                "config": {
                  "attribute.nameformat": "Unspecified",
                  "user.attribute": "firstName",
                  "attribute.name": "displayName"
                }
              },
              {
                "name": "email",
                "protocol": "saml",
                "protocolMapper": "saml-user-property-mapper",
                "consentRequired": false,
                "config": {
                  "attribute.nameformat": "Unspecified",
                  "user.attribute": "email",
                  "attribute.name": "mail"
                }
              },
              {
                "name": "role list",
                "protocol": "saml",
                "protocolMapper": "saml-role-list-mapper",
                "config": {
                  "single": "true",
                  "attribute.nameformat": "Unspecified",
                  "attribute.name": "role"
                }
              }
            ]
          }
        ]
      }
service:
  type: LoadBalancer
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: ip
  http:
    enabled: true
  ports:
    http: 80
EOF

echo "Adding bitnami repo..."
helm repo add bitnami https://charts.bitnami.com/bitnami

echo "Installing keycloak..."
helm install keycloak bitnami/keycloak \
  --create-namespace \
  --namespace $KEYCLOAK_NAMESPACE \
  -f keycloak_values.yaml

echo "Checking Target Group health..."

export LB_ARN=$(aws elbv2 describe-load-balancers --query 'LoadBalancers[?contains(LoadBalancerArn, `loadbalancer/net/k8s-keycloak-keycloak-`)].LoadBalancerArn' --output text)
export TARGET_GRP_ARN=$(aws elbv2 describe-target-groups --load-balancer-arn $LB_ARN --query 'TargetGroups[0].TargetGroupArn' --output text)
export TARGET_HEALTH=$(aws elbv2 describe-target-health --target-group-arn $TARGET_GRP_ARN --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text)

while [ "$TARGET_HEALTH" != "healthy" ]
do
  echo "Target health is $TARGET_HEALTH. Waiting 10 seconds."
  sleep 10
  export TARGET_HEALTH=$(aws elbv2 describe-target-health --target-group-arn $TARGET_GRP_ARN --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text)
done

echo "Target health is $TARGET_HEALTH."

ELB_HOSTNAME=$(kubectl get service/keycloak \
  -n $KEYCLOAK_NAMESPACE \
  --output go-template \
  --template='{{range .status.loadBalancer.ingress}}{{.hostname}}{{end}}')
export SAML_URL=http://$ELB_HOSTNAME/realms/$KEYCLOAK_REALM_AMG/protocol/saml/descriptor

echo "Generating workspace SAML configuration..."
cat >workspace-saml-auth-config.json <<EOF
{
    "authenticationProviders": [
        "SAML"
    ],
    "samlConfiguration": {
        "assertionAttributes": {
            "email": "mail",
            "login": "mail",
            "name": "displayName",
            "role": "role"
        },
        "idpMetadata": {
            "url": "${SAML_URL}"
        },
        "loginValidityDuration": 120,
        "roleValues": {
            "admin": [
                "admin"
            ],
            "editor": [
                "editor"
            ]
        }
    },
    "workspaceId": "${WORKSPACE_ID}"
}
EOF

echo "Updating workspace authentication..."
aws grafana update-workspace-authentication \
  --cli-input-json file://workspace-saml-auth-config.json

echo ""
echo "-------------------"
echo "Workspace endpoint: $(aws grafana describe-workspace --workspace-id $WORKSPACE_ID --query 'workspace.endpoint' --output text)"
echo "-------------------"
echo "Admin credentials"
echo "-------------------"
echo "username: admin"
echo "password: $KEYCLOAK_PASSWORD"
echo ""
echo "-------------------"
echo "Editor credentials"
echo "-------------------"
echo "username: editor"
echo "password: $KEYCLOAK_PASSWORD"
echo ""
echo "Setup done."