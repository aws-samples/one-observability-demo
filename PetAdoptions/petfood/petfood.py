"""Simple microservice to show Evidently features"""

import json
import logging
import os
import random
import boto3
from datetime import datetime
from aws_xray_sdk.ext.flask.middleware import XRayMiddleware
from aws_xray_sdk.core import patch_all, xray_recorder
from flask import Flask, request


app = Flask(__name__)
xray_recorder.configure(service='petfood')
patch_all()
XRayMiddleware(app, xray_recorder)


class StructuredMessage:  # pylint: disable=R0903
    """Use to make JSON formatted logging work well for CWL"""
    def __init__(self, message, /, **kwargs):
        self.message = message
        self.kwargs = kwargs

    def __str__(self):
        return f'{self.message} - {self.kwargs}'


_ = StructuredMessage
logging.basicConfig(level=os.getenv('LOG_LEVEL', 20), format='%(message)s')
logger = logging.getLogger()


class EvidentlyProject:
    """Base for all Evidently interactions"""

    def __init__(self):
        self.client = boto3.client('evidently')
        self.project = os.getenv('EVIDENTLY_PROJECT', 'petfood')
        self.upsell_feature = 'petfood-upsell'
        self.upsell_text_feature = 'petfood-upsell-text'

    def project_exists(self):
        """Returns False if the project does not currently exist"""
        xray_recorder.begin_subsegment('evidently project_exists')
        try:
            response = self.client.get_project(project=self.project)
            logger.info(_('checking for evidently project', response=response))
            xray_recorder.end_subsegment()
            return True
        except self.client.exceptions.ResourceNotFoundException:
            logger.warning(_('evidently project not found'))
            xray_recorder.end_subsegment()
            return None

    def get_upsell_evaluation(self, entity_id):
        """Gets the feature evaluation for petfood-upsell"""
        xray_recorder.begin_subsegment('evidently ' + self.upsell_feature)
        try:
            response = self.client.evaluate_feature(
                entityId=entity_id,
                feature=self.upsell_feature,
                project=self.project
            )
            xray_recorder.end_subsegment()
            return {
                'feature_enabled': response['value']['boolValue'],
                'variation': response['variation']
            }
        except self.client.exceptions.ResourceNotFoundException:
            logger.warning(_('evidently feature ' + self.upsell_feature + ' not found for project'))
            xray_recorder.end_subsegment()
            return return_default()

    def get_upsell_text(self, entity_id):
        """Gets the feature evaluation for petfood-upsell-verbiage"""
        xray_recorder.begin_subsegment('evidently ' + self.upsell_text_feature)
        try:
            response = self.client.evaluate_feature(
                entityId=entity_id,
                feature=self.upsell_text_feature,
                project=self.project
            )
            logger.info(_('evidently ' + self.upsell_text_feature, response=response))
            xray_recorder.end_subsegment()
            return response['value']['stringValue']
        except self.client.exceptions.ResourceNotFoundException:
            logger.warning(_('evidently feature ' + self.upsell_text_feature + ' not found for project'))
            xray_recorder.end_subsegment()
            return 'Error getting upsell message - check that your feature exists in Evidently!'


def return_evidently_response(evidently):
    """Create a response using an Evidently project"""
    xray_recorder.begin_subsegment('return_evidently_response')
    logger.info(_('building evidently response'))
    entity_id = str(random.randint(1, 100))
    evaluation = evidently.get_upsell_evaluation(entity_id)
    logger.warning(_('response from feature evaluation', evaluation=evaluation))
    response = json.dumps(
        {
            'statusCode': 200,
            'message': evidently.get_upsell_text(entity_id),
            'variation': evaluation,
            'entityId': entity_id
        }
    )
    logger.warning(_('final response to request', response=response))
    xray_recorder.end_subsegment()
    return response


def return_default():
    """Returns the default response to the user"""
    xray_recorder.begin_subsegment('return_default_response')
    logger.warning(_('returning default response to the user'))
    text = json.dumps(
        {
            'message': 'Thank you for supporting our community!',
            'statusCode': 200
        }
    )
    xray_recorder.end_subsegment()
    return text


@app.route('/')
def root_path():
    """Base URL for our handler"""
    now = datetime.now()
    print(
        now.strftime('%Y-%m-%d %H:%M:%S.%s') +
        ' [none] AWS-XRAY-TRACE-ID: ' +
        request.headers['X-Amzn-Trace-Id'] +
        ' INFO - manual logging of X-Ray trace ID'
    )
    logger.info(_('raw request headers', headers=request.headers))
    segment = xray_recorder.begin_segment('petfood')
    evidently = EvidentlyProject()
    project = evidently.project_exists()
    # xray_recorder.end_segment()
    if not project:
        return return_default()
    else:
        return return_evidently_response(evidently)


@app.route('/status')
def status_path():
    """Used for health checks"""
    logger.info(_('raw request headers', headers=request.headers))
    return json.dumps({'statusCode': 200, 'body': 'ok'})
