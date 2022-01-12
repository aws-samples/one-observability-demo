#!/usr/bin/env python  # pylint: disable=C0103

"""Simple microservice to show Evidently features"""

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

    def put_metric(self, entity_id, value):
        """Puts metric into Evidently"""
        data = json.dumps({
                'userDetails': {'entityId': entity_id},
                'details': {'donation': value}
            })
        response = self.client.put_project_events(
            events=[{'timestamp': time.time(),
                     'data': data,
                     'type': 'aws.evidently.custom'}],
            project=self.project
        )
        logger.warning(_('response to put_metric call', response=response))


@app.route('/metric/<entity_id>/<value>')
def root_path(entity_id, value):
    """Base URL for our handler"""
    xray_recorder.begin_segment('petfood-metric')
    evidently = EvidentlyProject()
    project = evidently.project_exists()
    if not project:
        return json.dumps({'statusCode': 404, 'body': 'evidently project not found'})
    evidently.put_metric(str(entity_id), float(value))
    return json.dumps('ok')


@app.route('/status')
def status_path():
    """Used for health checks"""
    return json.dumps({'statusCode': 200, 'body': 'ok'})
