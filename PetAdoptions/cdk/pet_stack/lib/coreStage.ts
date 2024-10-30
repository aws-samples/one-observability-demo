import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CoreStack } from "./stacks/core";
import { RepoStack } from "./stacks/repositories";
import * as fs from 'fs';
import path = require('path');



export class CoreStage extends Stage {
    constructor(scope: Construct, id: string, props: StageProps) {
        super(scope, id, props);

        const stackName = "WorkshopCore";
        const stack = new CoreStack(this, stackName, { 
            name: stackName,
            awsHostedWorkshop: true  // TODO: Read from context
        });

        const repoFolders = __dirname + "/../resources/microservices";

        const repositories = fs.readdirSync(repoFolders);


        const repoStacks = new RepoStack(this, "Repositories", {
            name: "Repositories",
            repositories: repositories,
            basePath: path.resolve(repoFolders)
        })

    }
}