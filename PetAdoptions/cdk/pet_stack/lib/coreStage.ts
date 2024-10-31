import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CoreStack } from "./stacks/core";
import { Vpc } from "aws-cdk-lib/aws-ec2";

export class CoreStage extends Stage {
    public readonly repoList = new Map<string, string>();
    public readonly vpc : Vpc;
    constructor(scope: Construct, id: string, props: StageProps) {
        super(scope, id, props);

        const stackName = "WorkshopCore";
        const coreStack = new CoreStack(this, stackName, { 
            name: stackName,
            awsHostedWorkshop: true  // TODO: Read from context
        });

        this.repoList = coreStack.repoList;
        this.vpc = coreStack.network.vpc;
    }
}