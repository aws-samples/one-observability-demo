/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Bedrock Guardrail for the Waggle AI agents: content filters, PII anonymization, denied topics.
 *
 * @packageDocumentation
 */
import { CfnOutput } from 'aws-cdk-lib';
import { CfnGuardrail } from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { Utilities } from '../utils/utilities';

export interface WaggleAIGuardrailProperties {
    readonly ssmGuardrailIdParameterName: string;
    readonly ssmGuardrailVersionParameterName: string;
}

export class WaggleAIGuardrail extends Construct {
    public readonly guardrailId: string;
    public readonly guardrailVersion: string;

    constructor(scope: Construct, id: string, properties: WaggleAIGuardrailProperties) {
        super(scope, id);

        const guardrail = new CfnGuardrail(this, 'Guardrail', {
            name: 'WaggleAIGuardrail',
            description: 'Content safety + PII + topic guardrail for the Waggle AI agents',
            blockedInputMessaging: 'I can only help with pet care, food, and adoption questions.',
            blockedOutputsMessaging: "Sorry, I can't help with that — let's keep it about your pet.",
            contentPolicyConfig: {
                filtersConfig: [
                    { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
                    { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'VIOLENCE', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
                    { type: 'MISCONDUCT', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
                    // PROMPT_ATTACK off: delegation instructions and relayed tool results read as injections.
                    { type: 'PROMPT_ATTACK', inputStrength: 'NONE', outputStrength: 'NONE' },
                ],
            },
            sensitiveInformationPolicyConfig: {
                piiEntitiesConfig: [
                    { type: 'EMAIL', action: 'ANONYMIZE' },
                    { type: 'PHONE', action: 'ANONYMIZE' },
                    { type: 'ADDRESS', action: 'ANONYMIZE' },
                    { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
                ],
            },
            topicPolicyConfig: {
                topicsConfig: [
                    {
                        name: 'MedicalDosing',
                        // Deliberately narrow: wellness, vaccination, parasite prevention and nutrition stay allowed.
                        definition:
                            'Specific medication dose to administer (mg, ml, pill count) or prescription treatment. Excludes vaccination, parasite prevention (fleas/ticks/heartworm), deworming, and nutrition.',
                        type: 'DENY',
                        examples: [
                            'What dosage of ibuprofen can I give my dog?',
                            'How many mg of medication for my cat?',
                            'How many milliliters of this prescription should I give my puppy?',
                        ],
                    },
                ],
            },
        });

        this.guardrailId = guardrail.attrGuardrailId;
        this.guardrailVersion = guardrail.attrVersion;

        Utilities.createSsmParameters(
            this,
            PARAMETER_STORE_PREFIX,
            new Map([
                [properties.ssmGuardrailIdParameterName, this.guardrailId],
                [properties.ssmGuardrailVersionParameterName, this.guardrailVersion],
            ]),
        );

        new CfnOutput(this, 'WaggleAIGuardrailId', { value: this.guardrailId });
    }
}
