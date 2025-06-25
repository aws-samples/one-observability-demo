import json
import boto3
import aws_xray_sdk 
from botocore.client import Config
from aws_xray_sdk.core import xray_recorder
from aws_xray_sdk.core import patch_all

xray_recorder.configure(service='PetRecommender')

# Import lambda powertools via 3rd party Layer to get EMF libraries
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

# Setup EMF stuff
emfmetrics = Metrics(namespace="BedRock-ContextRetrieval", service="PetRecommender")
# @emfmetrics.log_metrics  # ensures metrics are flushed upon request completion/failure


bedrock_config = Config(connect_timeout=5000, read_timeout=5000, retries={'max_attempts': 0})
bedrock_client = boto3.client('bedrock-runtime')
bedrock_agent_client = boto3.client("bedrock-agent-runtime",
                              config=bedrock_config)
kb_id = "REPLACE_VALUE"
modelId = 'anthropic.claude-v2'
def retrieve_context(query):
       
    #Call bedrock retrieve API to fetch matching context from the knowledge base  
    retrieval = bedrock_agent_client.retrieve(
        knowledgeBaseId=kb_id,
        retrievalQuery= {
        'text': query
        },
        retrievalConfiguration= {
        'vectorSearchConfiguration': {
        'numberOfResults': 5
        }
        }
    )
    retrievalResults = retrieval['retrievalResults']
    contexts = []
    scores = []
    for retrievedResult in retrievalResults: 
        contexts.append(retrievedResult['content']['text'])
        scores.append(retrievedResult['score'])
    context_str = str(contexts)
    max_score = max(scores)
   # print(retrievalResults)
    emfmetrics.add_metric(name="ContextSimilarityScore_max", unit=MetricUnit.Percent, value=max_score)
    return context_str, max_score

def validate_prompt(input_text,max_score):
    #check if the user query is relevant
    if max_score < 0.0035:
        return False
    else:
        return True

def create_prompt(query, context):
    #provide instruction to the model
    instruction = "Human:You are a pet recommendation assistant, and provide recommendations to potential pet adopters based on their individual and family circumstances. Recommend no more than 3 pet options and clearly describe why a given option is a good fit for the user. <question> tags. Please specifically include the words - do not have enough information - in  your response only when you find 0 matching pets. Do not make up an answer. "
     #augment prompt with instructions, context and user query   
    prompt = instruction + " <context> " + context + " </context>" + "<question> " + query + " </question>" + " Assistant:"
    return prompt

def get_recommendation(prompt):
    #Define invoke_model API parameters
    body = json.dumps({
        "prompt": prompt,
        "max_tokens_to_sample": 3000,
        "temperature": 0.1,
        "top_p": 0.9,
    })
   # modelId = 'anthropic.claude-v2'
    accept = 'application/json'
    contentType = 'application/json'

    #call invoke_model api to get recommendation
    response_raw = bedrock_client.invoke_model(body=body, modelId=modelId, accept=accept, contentType=contentType)
    response_body = json.loads(response_raw.get('body').read())
    response = response_body.get('completion')
    return response

@emfmetrics.log_metrics
def lambda_handler(event,context):
    input_text = event.get('user_query')
    customer_id= event.get('customer_id')
    #Initialize X-ray
    patch_all()
    #retrieve context from knowledge base  
    segment = xray_recorder.begin_subsegment('retrieve_context')
    xray_recorder.put_annotation("kb_id",f"{kb_id}");
    xray_recorder.put_annotation("customer_id", f"{customer_id}");
    context, max_score = retrieve_context(input_text)
    xray_recorder.put_metadata(key='user_query', value=f"{input_text}");
    xray_recorder.put_metadata(key='context', value=context);
    segment = xray_recorder.end_subsegment()
    
    #Augment prompt with instructions and context
    segment = xray_recorder.begin_subsegment('create_prompt')
    prompt = create_prompt(input_text,context)
    segment = xray_recorder.end_subsegment()
    
    #check if user_query is valid
    if validate_prompt(input_text,max_score):
        #if valid query, get recommendation
        segment = xray_recorder.begin_subsegment('get_recommendation')
        xray_recorder.put_annotation("model_id",f"{modelId}");
        xray_recorder.put_annotation("customer_id", f"{customer_id}");
        xray_recorder.put_metadata(key='user_query', value=f"{input_text}");
        
        try:
            
            output_text = get_recommendation(prompt)
            xray_recorder.put_metadata(key='recommendation', value=f"{output_text}");
            print(output_text)
            response=  {
                'status_code':200,
                "headers": {
                "Content-Type": "application/json"
                },
                'body': output_text
            }
        except Exception as e:
            response = {
                'status_code': 500,
                'body':json.dumps({'error':str(e)})
            }
  
        segment = xray_recorder.end_subsegment()
    else : 
        #if invalid query, return error
        response = {
                'status_code':200,
                "headers": {
                "Content-Type": "application/json"
                },
                'body': "Invalid input, please describe your circumstances relevant to adopting a dog."
            }
        emfmetrics.add_metric(name='InvalidUserQuery', unit=MetricUnit.Count, value=1)
        emfmetrics.add_metadata(key='user_input', value=f"{input_text}")
        emfmetrics.add_metadata(key='customer_id', value=f"{customer_id}")
    
    return response
