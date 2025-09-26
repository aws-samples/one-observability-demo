import { Construct } from 'constructs';
import { WorkshopCanary, WorkshopCanaryProperties } from '../../../constructs/canary';

interface HouseKeepingCanaryProperties extends WorkshopCanaryProperties {
    urlParameterName: string;
}

export class HouseKeepingCanary extends WorkshopCanary {
    constructor(scope: Construct, id: string, properties: HouseKeepingCanaryProperties) {
        super(scope, id, properties);
    }
    createOutputs(): void {}
    getEnvironmentVariables(properties: HouseKeepingCanaryProperties): { [key: string]: string } | undefined {
        return {
            PETSITE_URL_PARAMETER_NAME: properties.urlParameterName,
        };
    }
}
