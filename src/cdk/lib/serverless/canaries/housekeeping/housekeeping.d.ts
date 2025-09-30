import { Construct } from 'constructs';
import { WorkshopCanary, WorkshopCanaryProperties } from '../../../constructs/canary';
interface HouseKeepingCanaryProperties extends WorkshopCanaryProperties {
    urlParameterName: string;
}
export declare class HouseKeepingCanary extends WorkshopCanary {
    constructor(scope: Construct, id: string, properties: HouseKeepingCanaryProperties);
    createOutputs(): void;
    getEnvironmentVariables(properties: HouseKeepingCanaryProperties): {
        [key: string]: string;
    } | undefined;
}
export {};
