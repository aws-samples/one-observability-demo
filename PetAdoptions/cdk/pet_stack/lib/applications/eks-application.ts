import * as iam from 'aws-cdk-lib/aws-iam';
import * as eks from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs'

export interface EksApplicationProps {
    cluster:                eks.ICluster,
    app_trustRelationship:  iam.PolicyStatement,
    kubernetesManifestPath: string,
    region:                 string,
    imageUri:               string,
}

export abstract class EksApplication extends Construct {
    constructor(scope: Construct, id: string, props: EksApplicationProps) {
        super(scope, id);
    }
}