import logging
import os
import psycopg
import config
import repository
from flask import Flask, jsonify

# Setup flask app
app = Flask(__name__)

logging.basicConfig(level=os.getenv('LOG_LEVEL', 20), format='%(message)s')
logger = logging.getLogger()
cfg = config.fetch_config()
conn_params = config.get_rds_connection_parameters(cfg['rds_secret_arn'], cfg['region'])
db = psycopg.connect(**conn_params)

@app.route('/petadoptionshistory/api/home/transactions', methods=['GET'])
def transactions_get():
    transactions = repository.list_transaction_history(db)
    return jsonify(transactions)

@app.route('/petadoptionshistory/api/home/transactions', methods=['DELETE'])
def transactions_delete():
    repository.delete_transaction_history(db)
    return jsonify(success=True)

@app.route('/health/status')
def status_path():
    repository.check_alive(db)
    return jsonify(success=True)