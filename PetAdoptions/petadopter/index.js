'use strict';

const AWS = require('aws-sdk');
const { Client } = require('pg');
const Joi = require('joi');
const https = require('https');

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
const {
    RDS_SECRET_ARN,
    UPDATE_ADOPTION_URL,
    AWS_REGION,
} = process.env;

// AWS clients
const secretsManager = new AWS.SecretsManager({ region: AWS_REGION });

/**
 * Lambda handler for processing adoption messages from SQS
 */
exports.handler = async (event, context) => {
    console.log('Processing adoption messages:', JSON.stringify(event, null, 2));
    
    const results = [];
    
    // Process each SQS record
    for (const record of event.Records) {
        try {
            const result = await processAdoptionMessage(record);
            results.push(result);
        } catch (error) {
            console.error('Failed to process record:', record.messageId, error);
            // Re-throw to trigger SQS retry mechanism
            throw error;
        }
    }
    
    console.log('Successfully processed', results.length, 'adoption messages');
    return {
        statusCode: 200,
        processedCount: results.length,
        results: results
    };
};

/**
 * Process a single adoption message from SQS
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
        console.log(`Processing adoption - Transaction: ${validatedData.transactionId}, Pet: ${validatedData.petId}, User: ${validatedData.userId}`);
        
        // Write adoption to database
        await writeAdoptionToDatabase(validatedData);
        
        // Update pet availability status
        await updatePetAvailability(validatedData);
        
        console.log(`Successfully processed adoption for pet ${validatedData.petId} by user ${validatedData.userId}`);
        
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
 * Write adoption record to PostgreSQL database
 */
async function writeAdoptionToDatabase(adoptionData) {
    let client;
    
    try {
        console.log(`Writing adoption to database: ${adoptionData.transactionId}`);
        
        // Get database connection details from Secrets Manager
        const dbConfig = await getDatabaseConfig();
        
        // Create database connection
        client = new Client({
            host: dbConfig.host,
            port: dbConfig.port,
            database: dbConfig.dbname,
            user: dbConfig.username,
            password: dbConfig.password,
            ssl: false, // Adjust based on your RDS configuration
            connectionTimeoutMillis: 5000,
            query_timeout: 10000
        });
        
        await client.connect();
        console.log('Connected to database successfully');
        
        // Insert adoption record
        const insertQuery = `
            INSERT INTO transactions (pet_id, transaction_id, adoption_date, user_id)
            VALUES ($1, $2, $3, $4)
        `;
        
        const values = [
            adoptionData.petId,
            adoptionData.transactionId,
            new Date(adoptionData.adoptionDate),
            adoptionData.userId
        ];
        
        const result = await client.query(insertQuery, values);
        console.log(`Successfully inserted adoption record: ${adoptionData.transactionId}, rows affected: ${result.rowCount}`);
        
    } catch (error) {
        console.error('Database write failed:', error);
        throw new Error(`Database write failed: ${error.message}`);
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
 * Update pet availability status by calling the pet status updater service
 */
async function updatePetAvailability(adoptionData) {
    try {
        const payload = {
            petid: adoptionData.petId,
            pettype: adoptionData.petType,
            // Don't include petavailability to set it to "no" (adopted)
        };
        
        const postData = JSON.stringify(payload);
        
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 5000
        };
        
        console.log(`Updating pet availability for ${adoptionData.petId} via ${UPDATE_ADOPTION_URL}`);
        
        await new Promise((resolve, reject) => {
            const req = https.request(UPDATE_ADOPTION_URL, options, (res) => {
                let responseBody = '';
                
                res.on('data', (chunk) => {
                    responseBody += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log(`Pet status updated successfully (${res.statusCode}):`, responseBody);
                        resolve(responseBody);
                    } else {
                        const error = new Error(`HTTP ${res.statusCode}: ${responseBody}`);
                        reject(error);
                    }
                });
            });
            
            req.on('error', (error) => {
                console.error('Pet status update failed:', error);
                reject(error);
            });
            
            req.on('timeout', () => {
                const error = new Error('Pet status update timeout');
                reject(error);
            });
            
            req.write(postData);
            req.end();
        });
        
        console.log(`Successfully updated pet ${adoptionData.petId} availability status`);
        
    } catch (error) {
        console.error('Failed to update pet availability:', error);
        // Don't throw here - we don't want to fail the entire adoption if pet status update fails
        // The adoption is already recorded in the database
        console.warn('Continuing despite pet status update failure - adoption is still recorded');
    }
}

/**
 * Get database configuration from AWS Secrets Manager
 */
async function getDatabaseConfig() {
    try {
        console.log('Retrieving database configuration from Secrets Manager');
        
        const result = await secretsManager.getSecretValue({
            SecretId: RDS_SECRET_ARN
        }).promise();
        
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