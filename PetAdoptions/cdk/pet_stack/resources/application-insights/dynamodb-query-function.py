import os
import time
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
DYNAMODB_TABLE_NAME = os.environ['DYNAMODB_TABLE_NAME']

def lambda_handler(event, context):
    table = dynamodb.Table(DYNAMODB_TABLE_NAME)
    error_mode = event.get('error_mode')
    if error_mode == 'true':
        query_key = 'wrongKey'
    else:
        query_key = 'pettype'
    t_end = time.time() + 60 * 13
    while time.time() < t_end:
        try:
            response = table.query(
                KeyConditionExpression=Key(query_key).eq('puppy')
            )
            items = response['Items']
        except Exception as e:
            print("An exception occurred, but still continuing. The error is: ",e)
            items = "FunctionError"
            time.sleep(30)
    return {
        'statusCode': 200,
        'body': items
    }