
import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Applications } from "./stacks/applications";

export class ApplicationsStage extends Stage {
    constructor(scope: Construct, id: string, props: StageProps) {
        super(scope, id, props);

        const stackName = "Applications";
        const stack = new Applications(this, stackName, { 
            env: { 
              account: props.env?.account,
              region:  props.env?.region
          }});
    }
}