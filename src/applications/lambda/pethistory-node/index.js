/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

import AWS from 'aws-sdk';
import { Client } from 'pg';
import Joi from 'joi';

// Schema validation for SQS messages
const adoptionMessageSchema = Joi.object({
    transactionId: Joi.string().uuid().required(),
    petId: Joi.string().required(),
    petType: Joi.string().required(),
    userId: Joi.string().required(),
    adoptionDate: Joi.string().isoDate().required(),
    timestamp: Joi.string().isoDate().required()
});

// Environment variables
const { RDS_SECRET_ARN, AWS_REGION } = process.env;

// AWS clients
const secretsManager = new AWS.SecretsManager({ region: AWS_REGION });

/**
 * Lambda handler for processing adoption history messages from SQS
 */
export const handler = async (event) => {
    console.log('Processing adoption history messages:', JSON.stringify(event, undefined, 2));

    const results = [];
    const batchItemFailures = [];

    // Process each SQS record
    for (const record of event.Records) {
        try {
            const result = await processAdoptionMessage(record);
            results.push(result);
        } catch (error) {
            console.error('Failed to process record:', record.messageId, error);
            // Add to batch failures instead of throwing
            batchItemFailures.push({
                itemIdentifier: record.messageId
            });
        }
    }

    console.log(
        `Processed ${results.length} messages successfully, ${batchItemFailures.length} failed`
    );

    // Return batch failure information for SQS to handle partial failures
    return {
        batchItemFailures,
        processedCount: results.length,
        results
    };
};

/**
 * Process a single adoption history message from SQS
 */
async function processAdoptionMessage(record) {
    const messageId = record.messageId;
    // const receiptHandle = record.receiptHandle;

    console.log(`Processing message ${messageId}`);

    // Parse and validate message
    let adoptionData;
    try {
        adoptionData = JSON.parse(record.body);
        console.log('Parsed adoption data:', adoptionData);
    } catch (error) {
        console.error('Invalid JSON in message:', messageId, error);
        throw new Error(`Invalid JSON in message ${messageId}: ${error.message}`);
    }
    // Validate message schema
    const { error, value } = adoptionMessageSchema.validate(adoptionData);
    if (error) {
        console.error('Schema validation failed for message:', messageId, error.details);
        throw new Error(`Schema validation failed for message ${messageId}: ${error.message}`);
    }
    const validatedData = value;
    try {
        console.log(
            `Processing adoption - Transaction: ${validatedData.transactionId}, Pet: ${validatedData.petId}, User: ${validatedData.userId}`
        );
        // Write adoption history to database
        await writeAdoptionHistoryToDatabase(validatedData);

        console.log(
            `Successfully processed adoption for pet ${validatedData.petId} by user ${validatedData.userId}`
        );

        return {
            messageId: messageId,
            transactionId: validatedData.transactionId,
            status: 'success'
        };
    } catch (error) {
        console.error(`Failed to process adoption for pet ${validatedData.petId}:`, error);
        throw error;
    }
}

/**
 * Write adoption history record to PostgreSQL database
 */
async function writeAdoptionHistoryToDatabase(adoptionData) {
    let client;

    try {
        console.log(`Writing adoption history to database: ${adoptionData.transactionId}`);

        // Get database connection details from Secrets Manager
        const databaseConfig = await getDatabaseConfig();

        // Create database connection
        client = new Client({
            host: databaseConfig.host,
            port: databaseConfig.port,
            database: databaseConfig.dbname,
            user: databaseConfig.username,
            password: databaseConfig.password,
            ssl: false, // Adjust based on your RDS configuration
            connectionTimeoutMillis: 5000,
            query_timeout: 10_000
        });

        await client.connect();
        console.log('Connected to database successfully');

        // Optimistic approach: try to insert first
        const insertQuery = `
            INSERT INTO transaction_history (pet_id, transaction_id, adoption_date, user_id, created_at)
            VALUES ($1, $2, $3, $4, $5)
        `;

        const values = [
            adoptionData.petId,
            adoptionData.transactionId,
            new Date(adoptionData.adoptionDate),
            adoptionData.userId,
            new Date() // Current timestamp for history record
        ];

        const result = await client.query(insertQuery, values);
        console.log(
            `Successfully inserted adoption history record: ${adoptionData.transactionId}, rows affected: ${result.rowCount}`
        );
    } catch (error) {
        // Check if error is due to missing table (PostgreSQL error code 42P01)
        if (error.code === '42P01') {
            console.log('Table does not exist, creating transaction_history table...');
            await ensureTransactionHistoryTableExists(client);
            console.log('Table created, failing this attempt - SQS will retry the message');
            throw new Error('Table was created, message will be retried');
        } else {
            console.error('Database write failed:', error);
            throw new Error(`Database write failed: ${error.message}`);
        }
    } finally {
        if (client) {
            try {
                await client.end();
                console.log('Database connection closed');
            } catch (closeError) {
                console.error('Error closing database connection:', closeError);
            }
        }
    }
}

/**
 * Ensure the transaction_history table exists, create it if it doesn't
 */
async function ensureTransactionHistoryTableExists(client) {
    try {
        console.log('Checking if transaction_history table exists...');

        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS transaction_history (
                id SERIAL PRIMARY KEY,
                pet_id VARCHAR(255) NOT NULL,
                transaction_id VARCHAR(255) NOT NULL,
                adoption_date TIMESTAMP NOT NULL,
                user_id VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        await client.query(createTableQuery);
        console.log('transaction_history table is ready');

        // Create indexes for better performance if they don't exist
        const indexQueries = [
            'CREATE INDEX IF NOT EXISTS idx_transaction_history_pet_id ON transaction_history(pet_id)',
            'CREATE INDEX IF NOT EXISTS idx_transaction_history_user_id ON transaction_history(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_transaction_history_adoption_date ON transaction_history(adoption_date)',
            'CREATE INDEX IF NOT EXISTS idx_transaction_history_transaction_id ON transaction_history(transaction_id)'
        ];

        for (const indexQuery of indexQueries) {
            await client.query(indexQuery);
        }

        console.log('transaction_history table indexes are ready');
    } catch (error) {
        console.error('Error ensuring transaction_history table exists:', error);
        throw new Error(`Failed to ensure transaction_history table exists: ${error.message}`);
    }
}

/**
 * Get database configuration from AWS Secrets Manager
 */
async function getDatabaseConfig() {
    try {
        console.log('Retrieving database configuration from Secrets Manager');

        const result = await secretsManager
            .getSecretValue({
                SecretId: RDS_SECRET_ARN
            })
            .promise();

        const secret = JSON.parse(result.SecretString);
        console.log('Successfully retrieved database configuration');

        return {
            host: secret.host,
            port: secret.port,
            database: secret.dbname,
            username: secret.username,
            password: secret.password
        };
    } catch (error) {
        console.error('Failed to retrieve database configuration:', error);
        throw new Error(`Failed to retrieve database configuration: ${error.message}`);
    }
}
