import boto3
import time
import string
import random
import json
import logging
from botocore.config import Config
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """Lambda handler for DynamoDB write capacity testing with detailed error logging"""
    # Extract parameters from event with defaults
    tag_key = event.get('tag_key', 'application')
    tag_value = event.get('tag_value', 'One Observability Workshop')
    table_name = event.get('table')
    iterations = event.get('iterations', 10)
    sleep_time = event.get('sleep', 1.0)
    target_wcu = event.get('wcu', 10)
    no_retries = event.get('no_retries', False)
    
    logger.info(f"Lambda invoked with parameters: tag_key={tag_key}, tag_value={tag_value}, iterations={iterations}")
    
    # Initialize clients
    dynamodb_client = boto3.client('dynamodb')
    
    # If table not specified, find it by tags
    if not table_name:
        logger.info(f"Searching for DynamoDB tables with tag {tag_key}={tag_value}")
        try:
            # List all DynamoDB tables
            paginator = dynamodb_client.get_paginator('list_tables')
            all_tables = []
            for page in paginator.paginate():
                all_tables.extend(page['TableNames'])
            
            logger.info(f"Found {len(all_tables)} total DynamoDB tables")
            
            # Check tags for each table
            matching_tables = []
            for table in all_tables:
                try:
                    table_arn = dynamodb_client.describe_table(TableName=table)['Table']['TableArn']
                    tags_response = dynamodb_client.list_tags_of_resource(ResourceArn=table_arn)
                    
                    for tag in tags_response.get('Tags', []):
                        if tag['Key'] == tag_key and tag['Value'] == tag_value:
                            matching_tables.append(table)
                            logger.info(f"Found matching table: {table}")
                            break
                except ClientError as e:
                    error_code = e.response['Error']['Code']
                    error_msg = e.response['Error']['Message']
                    logger.error(f"Permission error checking table {table}: {error_code} - {error_msg}")
                    logger.error(f"Full exception: {str(e)}")
                    
                    # Re-raise permission errors to increment Lambda Errors metric
                    if error_code in ['AccessDeniedException', 'UnauthorizedException']:
                        raise
                    continue
                except Exception as e:
                    logger.error(f"Unexpected error checking table {table}: {type(e).__name__} - {str(e)}")
                    continue
            
            if not matching_tables:
                logger.error(f"No tables found with tag {tag_key}={tag_value}")
                return {
                    'statusCode': 404,
                    'body': json.dumps({'error': f'No tables found with tag {tag_key}={tag_value}'})
                }
            
            if len(matching_tables) > 1:
                logger.error(f"Multiple tables found with tag {tag_key}={tag_value}: {matching_tables}")
                return {
                    'statusCode': 400,
                    'body': json.dumps({'error': f'Multiple tables found: {matching_tables}'})
                }
            
            table_name = matching_tables[0]
            logger.info(f"Using table: {table_name}")
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_msg = e.response['Error']['Message']
            logger.error(f"AWS SDK error during table discovery: {error_code} - {error_msg}")
            logger.error(f"Full exception: {str(e)}")
            
            # Re-raise permission errors to increment Lambda Errors metric
            if error_code in ['AccessDeniedException', 'UnauthorizedException']:
                raise
            
            return {
                'statusCode': 500,
                'body': json.dumps({
                    'error': 'Table discovery failed',
                    'error_code': error_code,
                    'error_message': error_msg
                })
            }
        except Exception as e:
            logger.error(f"Unexpected error during table discovery: {type(e).__name__} - {str(e)}")
            return {
                'statusCode': 500,
                'body': json.dumps({'error': f'Unexpected error: {str(e)}'})
            }
    
    # Configure DynamoDB resource
    if no_retries:
        custom_config = Config(retries={'max_attempts': 0})
        dynamodb = boto3.resource('dynamodb', config=custom_config)
        logger.info("AWS SDK retries have been disabled")
    else:
        dynamodb = boto3.resource('dynamodb')
        logger.info("Using default AWS SDK retry configuration")
    
    table = dynamodb.Table(table_name)
    
    # Verify table exists and get details
    try:
        table_description = table.meta.client.describe_table(TableName=table_name)
        logger.info(f"Connected to DynamoDB table: {table_name}")
        logger.info(f"Table status: {table_description['Table']['TableStatus']}")
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_msg = e.response['Error']['Message']
        logger.error(f"AWS SDK error describing table: {error_code} - {error_msg}")
        logger.error(f"Full exception: {str(e)}")
        
        # Re-raise permission errors to increment Lambda Errors metric
        if error_code in ['AccessDeniedException', 'UnauthorizedException']:
            raise
        
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Failed to describe table',
                'error_code': error_code,
                'error_message': error_msg
            })
        }
    except Exception as e:
        logger.error(f"Unexpected error describing table: {type(e).__name__} - {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': f'Unexpected error: {str(e)}'})
        }
    
    petid_counter = 30
    results = []
    
    def create_sized_item(wcu_size, pet_id):
        pettype = random.choice(['kitten', 'puppy', 'bunny'])
        cuteness_rate = random.choice([3, 4, 5])
        
        item = {
            "pettype": pettype,
            "petid": str(pet_id),
            "availability": "yes",
            "cuteness_rate": cuteness_rate,
            "description": f"Adorable {pettype} ready for adoption",
            "image": f"{pettype}{pet_id}",
            "petcolor": random.choice(['brown', 'white', 'black', 'grey']),
            "price": random.randint(45, 600),
            "timestamp": str(time.time())
        }
        
        base_size_bytes = len(json.dumps(item).encode('utf-8'))
        target_size_bytes = wcu_size * 1024
        padding_size = max(0, target_size_bytes - base_size_bytes)
        
        if padding_size > 0:
            padding = ''.join(random.choice(string.ascii_letters) for _ in range(padding_size))
            item["data"] = padding
        
        return item
    
    logger.info(f"Starting {iterations} writes of ~{target_wcu} WCUs to table {table_name}")
    
    # Perform writes
    for i in range(iterations):
        try:
            item = create_sized_item(target_wcu, petid_counter)
            petid_counter += 1
            
            start_time = time.time()
            response = table.put_item(Item=item, ReturnConsumedCapacity="TOTAL")
            end_time = time.time()
            
            consumed_wcu = response.get('ConsumedCapacity', {}).get('CapacityUnits', 'unknown')
            op_time = end_time - start_time
            
            result = {
                'iteration': i + 1,
                'pet_id': item['petid'],
                'pet_type': item['pettype'],
                'cuteness': item['cuteness_rate'],
                'consumed_wcu': consumed_wcu,
                'operation_time': round(op_time, 3)
            }
            results.append(result)
            
            logger.info(f"Write {i+1}/{iterations} complete - Pet ID: {item['petid']}, Type: {item['pettype']}, "
                       f"Cuteness: {item['cuteness_rate']} - Consumed {consumed_wcu} WCUs (took {op_time:.3f}s)")
            
            # Sleep between iterations (except last one)
            if i < iterations - 1 and sleep_time > 0:
                time.sleep(sleep_time)
                
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_msg = e.response['Error']['Message']
            logger.error(f"AWS SDK error on write iteration {i+1}: {error_code} - {error_msg}")
            logger.error(f"Full exception: {str(e)}")
            
            # Re-raise permission errors to increment Lambda Errors metric
            if error_code in ['AccessDeniedException', 'UnauthorizedException']:
                raise
            
            error_result = {
                'iteration': i + 1,
                'error': error_code,
                'error_message': error_msg
            }
            results.append(error_result)
            
        except Exception as e:
            logger.error(f"Unexpected error on write iteration {i+1}: {type(e).__name__} - {str(e)}")
            error_result = {
                'iteration': i + 1,
                'error': type(e).__name__,
                'error_message': str(e)
            }
            results.append(error_result)
    
    logger.info("All write attempts completed!")
    
    # Return summary
    successful_writes = [r for r in results if 'error' not in r]
    failed_writes = [r for r in results if 'error' in r]
    total_wcu = sum(r.get('consumed_wcu', 0) for r in successful_writes if isinstance(r.get('consumed_wcu'), (int, float)))
    
    logger.info(f"Summary: {len(successful_writes)} successful, {len(failed_writes)} failed, {total_wcu} total WCUs consumed")
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': 'All write attempts completed',
            'table_name': table_name,
            'total_iterations': iterations,
            'successful_writes': len(successful_writes),
            'failed_writes': len(failed_writes),
            'total_wcu_consumed': total_wcu,
            'results': results
        })
    }