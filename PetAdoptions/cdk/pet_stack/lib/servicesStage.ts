import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Services } from "./services";

export class ServiceStage extends Stage {
    constructor(scope: Construct, id: string, props: StageProps) {
        super(scope, id, props);

        const stackName = "Services";
        const stack = new Services(this, stackName, { 
            env: { 
              account: props.env?.account,
              region:  props.env?.region
          }});
    }
}