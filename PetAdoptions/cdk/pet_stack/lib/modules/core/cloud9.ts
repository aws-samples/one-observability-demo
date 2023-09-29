import { Construct } from "constructs";
import * as cloudformation_include from "aws-cdk-lib/cloudformation-include";
import { CfnRole } from "aws-cdk-lib/aws-iam";

export interface Cloud9EnvironmentProps {
    name?: string;
    vpcId: string;
    subnetId: string;
    templateFile: string;
    cloud9OwnerArn?: string;
}

export class Cloud9Environment extends Construct {
    public readonly c9Role: CfnRole;
    constructor(scope: Construct, id: string, props: Cloud9EnvironmentProps) {
        super(scope, id);

        const template = new  cloudformation_include.CfnInclude(this, 'Cloud9Template', {
            templateFile: props.templateFile,
            parameters: {
                'CreateVPC': false,
                'Cloud9VPC': props.vpcId,
                'Cloud9Subnet': props.subnetId
            },
            preserveLogicalIds: false
        });

        if (props.name) {
            template.getParameter("EnvironmentName").default = props.name;
        }

        if (props.cloud9OwnerArn) {
            template.getParameter("Cloud9OwnerRole").default = props.cloud9OwnerArn.valueOf();
        }

        this.c9Role = template.getResource("C9Role") as CfnRole;

    }
}