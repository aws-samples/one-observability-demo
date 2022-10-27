import logging
import os
import psycopg2
import config
import repository
from flask import Flask, jsonify

# OTLP Tracing
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource, get_aggregated_resources

# Exporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# Propagation
from opentelemetry.propagate import set_global_textmap
from opentelemetry.propagators.aws import AwsXRayPropagator

# AWS X-Ray ID Generator
from opentelemetry.sdk.extension.aws.trace import AwsXRayIdGenerator

# Resource detector
from opentelemetry.sdk.extension.aws.resource.eks import AwsEksResourceDetector

# Instrumentation
from opentelemetry.instrumentation.botocore import BotocoreInstrumentor
from opentelemetry.instrumentation.psycopg2 import Psycopg2Instrumentor
from opentelemetry.instrumentation.flask import FlaskInstrumentor

# Instrumentation
BotocoreInstrumentor().instrument()
Psycopg2Instrumentor().instrument()

# Setup flask app
app = Flask(__name__)
FlaskInstrumentor().instrument_app(app)

logging.basicConfig(level=os.getenv('LOG_LEVEL', 20), format='%(message)s')
logger = logging.getLogger()
cfg = config.fetch_config()
conn_params = config.get_rds_connection_parameters(cfg['rds_secret_arn'], cfg['region'])
db = psycopg2.connect(**conn_params)

# Setup AWS X-Ray propagator
set_global_textmap(AwsXRayPropagator())

# Setup AWS EKS resource detector
resource = get_aggregated_resources(
    [
        AwsEksResourceDetector(),
    ]
)

# Setup tracer provider with the X-Ray ID generator
tracer_provider = TracerProvider(resource=resource, id_generator=AwsXRayIdGenerator())
processor = BatchSpanProcessor(OTLPSpanExporter())
tracer_provider.add_span_processor(processor)

# Sets the global default tracer provider
trace.set_tracer_provider(tracer_provider)

# Creates a tracer from the global tracer provider
tracer = trace.get_tracer(__name__)

@app.route('/petadoptionshistory/api/home/transactions', methods=['GET'])
def transactions_get():
    with tracer.start_as_current_span("transactions_get") as transactions_span:
        transactions = repository.list_transaction_history(db)
        return jsonify(transactions)

@app.route('/petadoptionshistory/api/home/transactions', methods=['DELETE'])
def transactions_delete():
    with tracer.start_as_current_span("transactions_delete") as transactions_span:
        repository.delete_transaction_history(db)
        return jsonify(success=True)

@app.route('/health/status')
def status_path():
    return jsonify(success=True)