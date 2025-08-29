const { S3Client, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize AWS clients
let s3Client, dynamoClient, documentClient;

function initializeClients() {
    if (!s3Client) {
        s3Client = new S3Client({ region: process.env.AWS_REGION });
        dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
        documentClient = DynamoDBDocumentClient.from(dynamoClient);
    }
    return { s3Client, docClient: documentClient };
}

// Configuration from environment variables
const CONFIG = {
    S3_BUCKET: process.env.S3_BUCKET_NAME || 'petfood-images',
    DYNAMODB_TABLE: process.env.DYNAMODB_TABLE_NAME || 'petfood-table',
    MAX_RETRIES: Number.parseInt(process.env.MAX_RETRIES || '3'),
    RETRY_DELAY_MS: Number.parseInt(process.env.RETRY_DELAY_MS || '1000')
};

/**
 * Check if an S3 object exists
 */
async function checkS3ObjectExists(bucket, key, s3ClientParameter = s3Client) {
    try {
        await s3ClientParameter.send(
            new HeadObjectCommand({
                Bucket: bucket,
                Key: key
            })
        );

        return true;
    } catch (error) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
            return false;
        }
        throw error;
    }
}

/**
 * Delete an S3 object
 */
async function deleteS3Object(bucket, key, s3ClientParameter = s3Client) {
    try {
        await s3ClientParameter.send(
            new DeleteObjectCommand({
                Bucket: bucket,
                Key: key
            })
        );

        console.log(`Successfully deleted S3 object: s3://${bucket}/${key}`);
        return true;
    } catch (error) {
        console.error(`Failed to delete S3 object s3://${bucket}/${key}:`, error.message);
        throw error;
    }
}

/**
 * Delete DynamoDB record for discontinued food item
 */
async function deleteDynamoDBRecord(foodId, documentClientParameter = documentClient) {
    try {
        const deleteParameters = {
            TableName: CONFIG.DYNAMODB_TABLE,
            Key: { id: foodId },
            ReturnValues: 'ALL_OLD'
        };

        const result = await documentClientParameter.send(new DeleteCommand(deleteParameters));

        console.log(`Successfully deleted DynamoDB record for food ${foodId}`);
        return result;
    } catch (error) {
        console.error(`Failed to delete DynamoDB record for food ${foodId}:`, error.message);
        throw error;
    }
}

/**
 * Retry logic with exponential backoff
 */
async function retryWithBackoff(
    operation,
    maxRetries = CONFIG.MAX_RETRIES,
    baseDelay = CONFIG.RETRY_DELAY_MS
) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            if (attempt === maxRetries) {
                break;
            }

            const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
            console.log(`Attempt ${attempt} failed, retrying in ${delay}ms:`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

/**
 * Process a single ItemDiscontinued event
 */
async function processCleanupEvent(event) {
    // Handle both EventBridge formats
    const eventDetail = event.detail || event.eventDetail;
    const eventType = event['detail-type'] || eventDetail?.event_type || eventDetail?.eventType;
    const foodId = eventDetail?.food_id || eventDetail?.foodId;

    const eventData = {
        eventType: eventType,
        foodId: foodId,
        status: eventDetail?.status,
        metadata: eventDetail?.metadata || {},
        timestamp: event.time || new Date().toISOString()
    };

    console.log(`Processing cleanup event for food ${eventData.foodId}`, {
        eventType: eventData.eventType,
        status: eventData.status,
        metadata: eventData.metadata
    });

    const cleanupSummary = {
        foodId: eventData.foodId,
        s3ImageDeleted: false,
        databaseRecordDeleted: false,
        postCleanupCompleted: false,
        errors: []
    };

    try {
        // Extract image path from metadata
        const imagePath = eventData.metadata.imagePath || eventData.metadata.image_path;

        if (imagePath) {
            console.log(`Checking S3 image: ${imagePath}`);

            // Check if image exists in S3
            const imageExists = await retryWithBackoff(async () => {
                return await checkS3ObjectExists(CONFIG.S3_BUCKET, imagePath);
            });

            if (imageExists) {
                // Delete the image from S3
                await retryWithBackoff(async () => {
                    return await deleteS3Object(CONFIG.S3_BUCKET, imagePath);
                });

                cleanupSummary.s3ImageDeleted = true;
                console.log(`Successfully deleted image: ${imagePath}`);
            } else {
                console.log(`Image not found in S3, skipping deletion: ${imagePath}`);
                cleanupSummary.s3ImageDeleted = false;
            }
        } else {
            console.log('No image path found in event metadata, skipping S3 cleanup');
        }

        // Delete DynamoDB record
        await retryWithBackoff(async () => {
            return await deleteDynamoDBRecord(eventData.foodId);
        });
        cleanupSummary.databaseRecordDeleted = true;

        console.log(
            `Cleanup processing completed successfully for food ${eventData.foodId}`,
            cleanupSummary
        );
        return cleanupSummary;
    } catch (error) {
        cleanupSummary.errors.push({
            message: error.message,
            timestamp: new Date().toISOString()
        });

        console.error(
            `Cleanup processing failed for food ${eventData.foodId}:`,
            error.message,
            cleanupSummary
        );
        throw error;
    }
}

/**
 * Main Lambda handler
 */
exports.handler = async (event, lambdaContext) => {
    // Initialize clients
    initializeClients();

    try {
        console.log('Cleanup processor Lambda invoked', {
            requestId: lambdaContext.requestId,
            eventSource: event.source,
            detailType: event['detail-type'],
            eventDetail: event.detail || event.eventDetail,
            fullEvent: event
        });

        // Validate event structure - handle both EventBridge formats
        const eventDetail = event.detail || event.eventDetail;
        const eventType = event['detail-type'] || eventDetail?.event_type || eventDetail?.eventType;
        const foodId = eventDetail?.food_id || eventDetail?.foodId;

        if (!eventDetail || !eventType || !foodId) {
            throw new Error(
                `Invalid event structure: missing required fields. Found eventType: ${eventType}, foodId: ${foodId}`
            );
        }

        // Process the cleanup event
        const result = await processCleanupEvent(event);
        const response = {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Cleanup processing completed successfully',
                foodId: foodId,
                cleanupSummary: result,
                requestId: lambdaContext.requestId,
                timestamp: new Date().toISOString()
            })
        };

        console.log('Cleanup processor completed successfully', response.body);
        return response;
    } catch (error) {
        console.error('Cleanup processor failed:', error.message, {
            requestId: lambdaContext.requestId,
            error: error.stack
        });

        // Re-throw the error to trigger Lambda retry mechanism
        throw error;
    }
};
