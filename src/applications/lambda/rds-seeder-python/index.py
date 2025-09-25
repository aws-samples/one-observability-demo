# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os
import time
import random
import boto3
import psycopg2
from psycopg2.extras import RealDictCursor
from decimal import Decimal

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
ssm_client = boto3.client("ssm")
secrets_client = boto3.client("secretsmanager")


def exponential_backoff(func, max_retries=5, base_delay=1.0):
    """
    Execute a function with exponential backoff retry logic for AWS API throttling
    """
    last_error = None

    for attempt in range(max_retries + 1):
        try:
            return func()
        except Exception as error:
            last_error = error
            error_name = getattr(error, "__class__.__name__", "Unknown")
            error_code = getattr(error, "response", {}).get("Error", {}).get("Code", "")
            error_message = str(error)

            # Check if it's a throttling error
            is_throttling_error = (
                error_name in ["ThrottlingException", "TooManyRequestsException"]
                or error_code in ["Throttling", "TooManyRequests"]
                or "Rate exceeded" in error_message
            )

            # If it's not a throttling error or we've exhausted retries, raise the error
            if not is_throttling_error or attempt == max_retries:
                raise error

            # Calculate delay with exponential backoff and jitter
            delay = base_delay * (2**attempt) + random.random()
            logger.info(
                f"Throttling detected, retrying in {delay:.2f}s "
                f"(attempt {attempt + 1}/{max_retries + 1})",
            )
            time.sleep(delay)

    raise last_error


def get_database_credentials(secret_parameter_name):
    """
    Get database credentials from AWS Secrets Manager via SSM Parameter Store
    """
    try:
        # Get the RDS secret ARN from SSM Parameter Store
        logger.info(f"Getting secret ARN from parameter: {secret_parameter_name}")

        def get_parameter():
            return ssm_client.get_parameter(Name=secret_parameter_name)

        parameter_response = exponential_backoff(get_parameter)
        secret_arn = parameter_response["Parameter"]["Value"]

        if not secret_arn:
            raise ValueError(
                f"Could not find RDS secret ARN in parameter: {secret_parameter_name}",
            )

        # Get the secret value
        logger.info(f"Retrieving credentials from secret: {secret_arn}")

        def get_secret():
            return secrets_client.get_secret_value(SecretId=secret_arn)

        secret_response = exponential_backoff(get_secret)
        secret_string = secret_response["SecretString"]

        if not secret_string:
            raise ValueError("Could not retrieve database credentials from secret")

        credentials = json.loads(secret_string)

        return {
            "host": credentials["host"],
            "port": credentials.get("port", 5432),
            "database": credentials.get("dbname", "adoptions"),
            "user": credentials["username"],
            "password": credentials["password"],
        }

    except Exception as error:
        logger.error(f"Error retrieving database credentials: {error}")
        raise


def create_database_connection(credentials):
    """
    Create database connection with SSL
    """
    try:
        connection = psycopg2.connect(
            host=credentials["host"],
            port=credentials["port"],
            database=credentials["database"],
            user=credentials["user"],
            password=credentials["password"],
            sslmode="require",
            connect_timeout=30,
            cursor_factory=RealDictCursor,
        )

        logger.info(
            f"Connected to database: {credentials['host']}:"
            f"{credentials['port']}/{credentials['database']}",
        )
        return connection

    except Exception as error:
        logger.error(f"Error connecting to database: {error}")
        raise


def create_tables(connection):
    """
    Create database tables if they don't exist
    """
    logger.info("Creating database tables...")

    create_tables_sql = """
        -- Create transactions table for tracking adoptions
        CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY,
            pet_id VARCHAR(10) NOT NULL,
            transaction_id VARCHAR(50) NOT NULL,
            adoption_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            adopter_name VARCHAR(255),
            adopter_email VARCHAR(255),
            status VARCHAR(20) DEFAULT 'completed',
            notes TEXT
        );
    """

    try:
        with connection.cursor() as cursor:
            cursor.execute(create_tables_sql)
        connection.commit()
        logger.info("Database tables created successfully")
    except Exception as error:
        logger.error(f"Error creating tables: {error}")
        connection.rollback()
        raise

def lambda_handler(event, context):
    """
    Main Lambda handler for RDS seeding
    """
    logger.info(f"RDS Seeder Lambda started. Event: {json.dumps(event)}")

    try:
        # Get SSM parameter name from environment variable
        secret_parameter_name = os.environ.get("SECRET_PARAMETER_NAME")
        if not secret_parameter_name:
            error_msg = "SECRET_PARAMETER_NAME environment variable is required"
            logger.error(error_msg)
            return {"statusCode": 400, "body": json.dumps({"error": error_msg})}

        logger.info(f"Using secret parameter: {secret_parameter_name}")

        # Get database credentials
        logger.info("Retrieving database credentials...")
        credentials = get_database_credentials(secret_parameter_name)

        # Create database connection
        logger.info("Connecting to database...")
        connection = create_database_connection(credentials)

        try:
            # Create tables
            create_tables(connection)

            logger.info("RDS seeding completed successfully!")

            return {
                "statusCode": 200,
                "body": json.dumps(
                    {
                        "message": "RDS table created successfully",
                    },
                ),
            }

        finally:
            connection.close()
            logger.info("Database connection closed")

    except Exception as error:
        error_msg = f"RDS table creation failed: {str(error)}"
        logger.error(error_msg, exc_info=True)
        return {"statusCode": 500, "body": json.dumps({"error": error_msg})}
