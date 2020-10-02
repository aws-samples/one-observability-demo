import json
import boto3
from boto3.dynamodb.conditions import Key

ssm = boto3.client('ssm')
dynamodb = boto3.resource('dynamodb')

def lambda_handler(event, context):
   
    dynamodb_tablename = ssm.get_parameter(Name='/petstore/dynamodbtablename', WithDecryption=False)

    table = dynamodb.Table(dynamodb_tablename['Parameter']['Value'])

    response = table.query(
        KeyConditionExpression=Key('petid').eq(event['petid']) & Key('pettype').eq(event['pettype'])
    )
    
    response['Items'][0]['price'] = int(response['Items'][0]['price'])
    
    return {
        'statusCode': 200,
        'body': response['Items'][0]
    }
