import json
import logging
import os
import time
import boto3
from aws_xray_sdk.ext.flask.middleware import XRayMiddleware
from aws_xray_sdk.core import patch_all, xray_recorder
from flask import Flask, request

app = Flask(__name__)
xray_recorder.configure(service='petfood-metric')
patch_all()
XRayMiddleware(app, xray_recorder)

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

    @xray_recorder.capture('evidently_put_metric')
    def put_metric(self, entity_id, value):
        """Puts metric into Evidently"""
        data = json.dumps({
            'userDetails': {'entityId': entity_id},
            'details': {'donation': value}
        })
        response = self.client.put_project_events(
            events=[{
                'timestamp': time.time(),
                'data': data,
                'type': 'aws.evidently.custom'
            }],
            project=self.project
        )
        logger.warning("Response to put_metric call: %s", response)

@app.route('/metric/<entity_id>/<value>')
def root_path(entity_id, value):
    """Base URL for our handler"""
    logger.info("Raw request headers: %s", request.headers)
    xray_recorder.begin_segment('petfood-metric')
    evidently = EvidentlyProject()
    if not evidently.project_exists():
        xray_recorder.end_segment()
        return json.dumps({'statusCode': 404, 'body': 'Evidently project not found'})
    evidently.put_metric(entity_id, float(value))
    xray_recorder.end_segment()
    return json.dumps('ok')

@app.route('/status')
def status_path():
    """Used for health checks"""
    logger.info("Raw request headers: %s", request.headers)
    return json.dumps({'statusCode': 200, 'body': 'ok'})
