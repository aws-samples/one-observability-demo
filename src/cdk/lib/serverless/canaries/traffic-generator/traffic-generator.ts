/**
 * Traffic Generator Canary construct.
 *
 * CloudWatch Synthetics canary that simulates user traffic to the pet adoption
 * site on a schedule, providing outside-in availability monitoring and
 * generating baseline traffic for observability dashboards.
 *
 * @packageDocumentation
 */
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
