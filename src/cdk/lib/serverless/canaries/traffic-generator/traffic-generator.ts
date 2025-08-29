import { Construct } from 'constructs';
import { WorkshopCanary, WorkshopCanaryProperties } from '../../../constructs/canary';

interface TrafficGeneratorCanaryProperties extends WorkshopCanaryProperties {
    urlParameterName: string;
}

export class TrafficGeneratorCanary extends WorkshopCanary {
    constructor(scope: Construct, id: string, properties: TrafficGeneratorCanaryProperties) {
        super(scope, id, properties);
    }
    createOutputs(): void {}
    getEnvironmentVariables(properties: TrafficGeneratorCanaryProperties): { [key: string]: string } | undefined {
        return {
            PETSITE_URL_PARAMETER_NAME: properties.urlParameterName,
        };
    }
}
