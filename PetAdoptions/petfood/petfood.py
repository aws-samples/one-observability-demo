import json
import logging
import os
import random
import boto3
from aws_xray_sdk.ext.flask.middleware import XRayMiddleware
from aws_xray_sdk.core import patch_all, xray_recorder
from flask import Flask, request

app = Flask(__name__)
plugins = ('EC2Plugin',)
xray_recorder.configure(plugins=plugins, service='petfood')
patch_all()
XRayMiddleware(app, xray_recorder)
xray_recorder.begin_segment('petfood')

logging.basicConfig(
    level=os.getenv('LOG_LEVEL', logging.INFO),
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

class EvidentlyProject:
    """Base for all Evidently interactions"""

    def __init__(self):
        self.client = boto3.client('evidently')
        self.project = os.getenv('EVIDENTLY_PROJECT', 'petfood')
        self.upsell_feature = 'petfood-upsell'
        self.upsell_text_feature = 'petfood-upsell-text'

    @xray_recorder.capture('evidently_project_exists')
    def project_exists(self):
        """Returns False if the project does not currently exist"""
        try:
            self.client.get_project(project=self.project)
            logger.info("Evidently project '%s' found", self.project)
            return True
        except self.client.exceptions.ResourceNotFoundException:
            logger.warning("Evidently project '%s' not found", self.project)
            return False

    @xray_recorder.capture('evidently_get_upsell_evaluation')
    def get_upsell_evaluation(self, entity_id):
        """Gets the feature evaluation for petfood-upsell"""
        try:
            response = self.client.evaluate_feature(
                entityId=entity_id,
                feature=self.upsell_feature,
                project=self.project
            )
            return {
                'feature_enabled': response['value']['boolValue'],
                'variation': response['variation']
            }
        except self.client.exceptions.ResourceNotFoundException:
            logger.warning("Evidently feature '%s' not found for project '%s'", self.upsell_feature, self.project)
            return return_default()

    @xray_recorder.capture('evidently_get_upsell_text')
    def get_upsell_text(self, entity_id):
        """Gets the feature evaluation for petfood-upsell-verbiage"""
        try:
            response = self.client.evaluate_feature(
                entityId=entity_id,
                feature=self.upsell_text_feature,
                project=self.project
            )
            logger.info("Evidently feature '%s': %s", self.upsell_text_feature, response['value']['stringValue'])
            return response['value']['stringValue']
        except self.client.exceptions.ResourceNotFoundException:
            logger.warning("Evidently feature '%s' not found for project '%s'", self.upsell_text_feature, self.project)
            return 'Error getting upsell message - check that your feature exists in Evidently!'

@xray_recorder.capture('return_evidently_response')
def return_evidently_response(evidently):
    """Create a response using an Evidently project"""
    logger.info("Building Evidently response")
    entity_id = str(random.randint(1, 100))
    evaluation = evidently.get_upsell_evaluation(entity_id)
    logger.warning("Response from feature evaluation: %s", evaluation)
    return json.dumps({
        'statusCode': 200,
        'message': evidently.get_upsell_text(entity_id),
        'variation': evaluation,
        'entityId': entity_id
    })

@xray_recorder.capture('return_default_response')
def return_default():
    """Returns the default response to the user"""
    logger.warning("Returning default response to the user")
    return json.dumps({
        'message': 'Thank you for supporting our community!',
        'statusCode': 200
    })

@app.route('/')
def root_path():
    """Base URL for our handler"""
    logger.info("Raw request headers: %s", request.headers)
    evidently = EvidentlyProject()
    if not evidently.project_exists():
        return return_default()
    else:
        return return_evidently_response(evidently)

@app.route('/status')
def status_path():
    """Used for health checks"""
    logger.info("Raw request headers: %s", request.headers)
    return json.dumps({'statusCode': 200, 'body': 'ok'})
