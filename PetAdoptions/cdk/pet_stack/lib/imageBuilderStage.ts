import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ImageBuilderStack } from "./stacks/imageBuilder";

export class ImageBuilderStage extends Stage {
    public readonly repoList = new Map<string, string>();
    constructor(scope: Construct, id: string, props: StageProps) {
        super(scope, id, props);

        const stackName = "ImageBuilder";
        const coreStack = new ImageBuilderStack(this, stackName, { 
            env: { 
                account: props.env?.account,
                region:  props.env?.region
            },
        });

        this.repoList = coreStack.repoList;
    }
}