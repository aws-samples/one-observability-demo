import json

def lambda_handler(event, context):
    # TODO implement
    print(event)

    print('ProcessGreaterThan55 - Execution complete')
    return {
        'statusCode': 200,
        'body': json.dumps('ProcessGreaterThan55 - Execution complete')
    }
