import logging
import os
import psycopg2
import config
import repository
from flask import Flask, jsonify

# Setup flask app
app = Flask(__name__)

logging.basicConfig(level=os.getenv('LOG_LEVEL', 20), format='%(message)s')
logger = logging.getLogger()
cfg = config.fetch_config()
conn_params = config.get_rds_connection_parameters(cfg['rds_secret_arn'], cfg['region'])
db = psycopg2.connect(**conn_params)

@app.route('/petadoptionhistory/api/home/transactions', methods=['GET'])
def transactions_get():
    transactions = repository.list_transaction_history(db)
    return jsonify(transactions)

@app.route('/petadoptionhistory/api/home/transactions', methods=['DELETE'])
def transactions_delete():
    repository.delete_transaction_history(db)
    return jsonify(success=True)

@app.route('/petadoptionhistory/health/status')
def status_path():
    return jsonify(success=True)