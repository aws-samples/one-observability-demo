import json

def lambda_handler(event, context):
    # TODO implement
    print(event)
    print('ProcessLessthan55 - Execution complete')
    return {
        'statusCode': 200,
        'body': json.dumps('ProcessLessthan55 - Execution complete')
    }
