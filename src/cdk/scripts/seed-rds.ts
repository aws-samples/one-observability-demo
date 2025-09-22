#!/usr/bin/env ts-node

/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * RDS Aurora PostgreSQL Seeding Script for One Observability Workshop
 *
 * This script seeds the Aurora PostgreSQL database with sample data
 * required for the petlist-adoptions Python service to function properly.
 *
 * Usage:
 *   npm run rds:seed
 *   npm run rds:seed -- --dry-run
 *   npm run rds:seed -- --stack-name <STACK_NAME>
 */

import { RDSClient } from '@aws-sdk/client-rds';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

interface SeedOptions {
    stackName?: string;
    dryRun: boolean;
    region?: string;
}

interface DatabaseCredentials {
    username: string;
    password: string;
    host: string;
    port: number;
    dbname: string;
}

interface PetData {
    pettype: string;
    petid: string;
    availability: string;
    cuteness_rate: string;
    image: string;
    petcolor: string;
    price: string;
    description: string;
}

interface ThrottleError {
    name?: string;
    Code?: string;
    message?: string;
}

/**
 * Execute a function with exponential backoff retry logic for AWS API throttling
 */
async function throttlingBackOff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 5,
    baseDelay: number = 1000,
): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            const throttleError = error as ThrottleError;

            // Check if it's a throttling error
            const isThrottlingError =
                throttleError.name === 'ThrottlingException' ||
                throttleError.Code === 'Throttling' ||
                throttleError.name === 'TooManyRequestsException' ||
                throttleError.Code === 'TooManyRequests' ||
                (throttleError.message && throttleError.message.includes('Rate exceeded'));

            // If it's not a throttling error or we've exhausted retries, throw the error
            if (!isThrottlingError || attempt === maxRetries) {
                throw error;
            }

            // Calculate delay with exponential backoff and jitter
            const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;

            console.log(
                `   ⏳ Throttling detected, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
            );

            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    throw lastError!;
}

export class RDSSeeder {
    private rds: RDSClient;
    private secretsManager: SecretsManagerClient;
    private ssm: SSMClient;
    private region: string;

    constructor(region: string = process.env.AWS_REGION || 'us-east-1') {
        const clientConfig = { region };
        this.region = region;

        this.rds = new RDSClient(clientConfig);
        this.secretsManager = new SecretsManagerClient(clientConfig);
        this.ssm = new SSMClient(clientConfig);
    }

    /**
     * Get database credentials from AWS Secrets Manager
     */
    private async getDatabaseCredentials(): Promise<DatabaseCredentials> {
        try {
            // Get the RDS secret ARN from SSM Parameter Store
            const parameterName = `/${process.env.STACK_NAME || 'OneObservabilityWorkshop'}/rdssecretarn`;
            const parameterCommand = new GetParameterCommand({
                Name: parameterName,
            });

            const parameterResponse = await throttlingBackOff(() => this.ssm.send(parameterCommand));
            const secretArn = parameterResponse.Parameter?.Value;

            if (!secretArn) {
                throw new Error(`Could not find RDS secret ARN in parameter: ${parameterName}`);
            }

            // Get the secret value
            const secretCommand = new GetSecretValueCommand({
                SecretId: secretArn,
            });

            const secretResponse = await throttlingBackOff(() => this.secretsManager.send(secretCommand));
            const secretString = secretResponse.SecretString;

            if (!secretString) {
                throw new Error('Could not retrieve database credentials from secret');
            }

            const credentials = JSON.parse(secretString);

            return {
                username: credentials.username,
                password: credentials.password,
                host: credentials.host,
                port: credentials.port || 5432,
                dbname: credentials.dbname || 'adoptions',
            };
        } catch (error) {
            console.error('❌ Error retrieving database credentials:', error);
            throw error;
        }
    }

    /**
     * Create database connection
     */
    private async createDatabaseConnection(credentials: DatabaseCredentials): Promise<Client> {
        const client = new Client({
            host: credentials.host,
            port: credentials.port,
            database: credentials.dbname,
            user: credentials.username,
            password: credentials.password,
            ssl: {
                rejectUnauthorized: false, // For RDS SSL
            },
        });

        await client.connect();
        return client;
    }

    /**
     * Create database tables if they don't exist
     */
    private async createTables(client: Client, dryRun: boolean): Promise<void> {
        console.log('📋 Creating database tables...');

        const createTablesSQL = `
            -- Create pets table for adoption listings
            CREATE TABLE IF NOT EXISTS pets (
                id SERIAL PRIMARY KEY,
                petid VARCHAR(10) UNIQUE NOT NULL,
                pettype VARCHAR(50) NOT NULL,
                availability VARCHAR(10) NOT NULL DEFAULT 'yes',
                cuteness_rate INTEGER NOT NULL DEFAULT 5,
                image VARCHAR(100),
                petcolor VARCHAR(50),
                price DECIMAL(10,2) NOT NULL,
                description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            -- Create transactions table for tracking adoptions (as expected by Python app)
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                pet_id VARCHAR(10) NOT NULL,
                transaction_id VARCHAR(50) NOT NULL,
                adoption_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                adopter_name VARCHAR(255),
                adopter_email VARCHAR(255),
                status VARCHAR(20) DEFAULT 'completed',
                notes TEXT
            );

            -- Create indexes for better performance
            CREATE INDEX IF NOT EXISTS idx_pets_pettype ON pets(pettype);
            CREATE INDEX IF NOT EXISTS idx_pets_availability ON pets(availability);
            CREATE INDEX IF NOT EXISTS idx_pets_petid ON pets(petid);
            CREATE INDEX IF NOT EXISTS idx_transactions_pet_id ON transactions(pet_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
        `;

        if (dryRun) {
            console.log('   [DRY RUN] Would create tables with SQL:');
            console.log(createTablesSQL);
        } else {
            try {
                await client.query(createTablesSQL);
                console.log('   ✅ Database tables created successfully');
            } catch (error) {
                console.error('   ❌ Error creating tables:', error);
                throw error;
            }
        }
    }

    /**
     * Load pet data from seed file
     */
    private loadPetData(): PetData[] {
        try {
            const seedFilePath = join(__dirname, 'seed.json');
            const seedData = readFileSync(seedFilePath, 'utf8');
            return JSON.parse(seedData) as PetData[];
        } catch (error) {
            console.error('❌ Error loading seed data:', error);
            throw error;
        }
    }

    /**
     * Seed pets data
     */
    private async seedPetsData(client: Client, dryRun: boolean): Promise<number> {
        console.log('🐾 Seeding pets data...');

        const petData = this.loadPetData();
        let insertedCount = 0;

        // Clear existing data first
        if (!dryRun) {
            await client.query('DELETE FROM transactions');
            await client.query('DELETE FROM pets');
            console.log('   🧹 Cleared existing data');
        }

        const insertSQL = `
            INSERT INTO pets (petid, pettype, availability, cuteness_rate, image, petcolor, price, description)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (petid) DO UPDATE SET
                pettype = EXCLUDED.pettype,
                availability = EXCLUDED.availability,
                cuteness_rate = EXCLUDED.cuteness_rate,
                image = EXCLUDED.image,
                petcolor = EXCLUDED.petcolor,
                price = EXCLUDED.price,
                description = EXCLUDED.description,
                updated_at = CURRENT_TIMESTAMP
        `;

        for (const pet of petData) {
            if (dryRun) {
                console.log(`   [DRY RUN] Would insert pet: ${pet.petid} (${pet.pettype})`);
            } else {
                try {
                    await client.query(insertSQL, [
                        pet.petid,
                        pet.pettype,
                        pet.availability,
                        parseInt(pet.cuteness_rate),
                        pet.image,
                        pet.petcolor,
                        parseFloat(pet.price),
                        pet.description,
                    ]);
                    console.log(`   ✅ Inserted pet: ${pet.petid} (${pet.pettype})`);
                } catch (error) {
                    console.error(`   ❌ Error inserting pet ${pet.petid}:`, error);
                    continue;
                }
            }
            insertedCount++;
        }

        return insertedCount;
    }

    /**
     * Seed sample adoptions data
     */
    private async seedAdoptionsData(client: Client, dryRun: boolean): Promise<number> {
        console.log('📝 Seeding sample adoptions data...');

        const sampleAdoptions = [
            {
                petid: '001',
                adopter_name: 'John Smith',
                adopter_email: 'john.smith@example.com',
                status: 'completed',
                notes: 'Great match! Very happy with the adoption process.',
            },
            {
                petid: '016',
                adopter_name: 'Sarah Johnson',
                adopter_email: 'sarah.j@example.com',
                status: 'pending',
                notes: 'Waiting for home visit approval.',
            },
            {
                petid: '023',
                adopter_name: 'Mike Wilson',
                adopter_email: 'mike.wilson@example.com',
                status: 'completed',
                notes: 'Perfect companion for the family.',
            },
        ];

        let insertedCount = 0;

        const insertSQL = `
            INSERT INTO adoptions (pet_id, adopter_name, adopter_email, status, notes)
            SELECT p.id, $2, $3, $4, $5
            FROM pets p
            WHERE p.petid = $1
        `;

        for (const adoption of sampleAdoptions) {
            if (dryRun) {
                console.log(`   [DRY RUN] Would insert adoption for pet: ${adoption.petid}`);
            } else {
                try {
                    const result = await client.query(insertSQL, [
                        adoption.petid,
                        adoption.adopter_name,
                        adoption.adopter_email,
                        adoption.status,
                        adoption.notes,
                    ]);

                    if (result.rowCount && result.rowCount > 0) {
                        console.log(`   ✅ Inserted adoption for pet: ${adoption.petid}`);
                        insertedCount++;
                    } else {
                        console.log(`   ⚠️ Pet ${adoption.petid} not found, skipping adoption record`);
                    }
                } catch (error) {
                    console.error(`   ❌ Error inserting adoption for pet ${adoption.petid}:`, error);
                    continue;
                }
            }
        }

        return insertedCount;
    }

    /**
     * Verify seeded data
     */
    private async verifyData(client: Client): Promise<void> {
        console.log('🔍 Verifying seeded data...');

        try {
            const petsResult = await client.query('SELECT COUNT(*) as count FROM pets');
            const adoptionsResult = await client.query('SELECT COUNT(*) as count FROM adoptions');

            console.log(`   📊 Total pets: ${petsResult.rows[0].count}`);
            console.log(`   📊 Total adoptions: ${adoptionsResult.rows[0].count}`);

            // Show sample data
            const samplePets = await client.query('SELECT petid, pettype, petcolor, price FROM pets LIMIT 5');
            console.log('   📋 Sample pets:');
            samplePets.rows.forEach((pet) => {
                console.log(`      - ${pet.petid}: ${pet.pettype} (${pet.petcolor}) - $${pet.price}`);
            });
        } catch (error) {
            console.error('   ❌ Error verifying data:', error);
        }
    }

    /**
     * Main seeding process
     */
    async seed(options: SeedOptions): Promise<void> {
        console.log('🌱 Starting RDS Aurora PostgreSQL seeding process...\n');

        if (options.dryRun) {
            console.log('🔍 DRY RUN MODE - No actual changes will be made\n');
        }

        let client: Client | null = null;

        try {
            // Get database credentials
            console.log('🔐 Retrieving database credentials...');
            const credentials = await this.getDatabaseCredentials();
            console.log(`   ✅ Connected to database: ${credentials.host}:${credentials.port}/${credentials.dbname}`);

            // Create database connection
            console.log('🔌 Connecting to database...');
            client = await this.createDatabaseConnection(credentials);
            console.log('   ✅ Database connection established');

            // Create tables
            await this.createTables(client, options.dryRun);

            // Seed pets data
            const petsCount = await this.seedPetsData(client, options.dryRun);
            console.log(`   📊 Processed ${petsCount} pets`);

            // Seed adoptions data
            const adoptionsCount = await this.seedAdoptionsData(client, options.dryRun);
            console.log(`   📊 Processed ${adoptionsCount} adoptions`);

            // Verify data (only if not dry run)
            if (!options.dryRun) {
                await this.verifyData(client);
            }

            console.log('\n✅ RDS seeding completed successfully!');
        } catch (error) {
            console.error('\n❌ RDS seeding failed:', error);
            process.exit(1);
        } finally {
            if (client) {
                await client.end();
                console.log('🔌 Database connection closed');
            }
        }
    }
}

// CLI handling
async function main() {
    const args = process.argv.slice(2);

    const options: SeedOptions = {
        dryRun: args.includes('--dry-run'),
        region: process.env.AWS_REGION || 'us-east-1',
    };

    // Extract stack name if provided
    const stackNameIndex = args.indexOf('--stack-name');
    if (stackNameIndex !== -1 && stackNameIndex + 1 < args.length) {
        options.stackName = args[stackNameIndex + 1];
        process.env.STACK_NAME = options.stackName;
    }

    const seeder = new RDSSeeder(options.region);
    await seeder.seed(options);
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}