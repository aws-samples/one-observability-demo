import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CoreStack } from "./stacks/core";

export class CoreStage extends Stage {
    public readonly repoList = new Map<string, string>();
    constructor(scope: Construct, id: string, props: StageProps) {
        super(scope, id, props);

        const stackName = "WorkshopCore";
        const coreStack = new CoreStack(this, stackName, { 
            env: { 
                account: props.env?.account,
                region:  props.env?.region
            },
        });

        this.repoList = coreStack.repoList;
    }
}