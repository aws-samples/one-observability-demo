import { Construct } from 'constructs';
import { WorkshopCanary, WorkshopCanaryProperties } from '../../../constructs/canary';
interface TrafficGeneratorCanaryProperties extends WorkshopCanaryProperties {
    urlParameterName: string;
}
export declare class TrafficGeneratorCanary extends WorkshopCanary {
    constructor(scope: Construct, id: string, properties: TrafficGeneratorCanaryProperties);
    createOutputs(): void;
    getEnvironmentVariables(properties: TrafficGeneratorCanaryProperties): {
        [key: string]: string;
    } | undefined;
}
export {};
