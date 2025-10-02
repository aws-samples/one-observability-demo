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
from datetime import datetime

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


def generate_fake_user_data(user_id):
    """
    Generate fake user data
    """
    first_names = [
        "Catherine",
        "Javier",
        "Alex",
        "Frank",
        "Mark",
        "Fatiha",
        "Purva",
        "Selim",
        "Jane",
        "Alan",
        "Mohamed",
        "Maria",
        "Ahmed",
        "Sofia",
        "Liam",
        "Emma",
        "Noah",
        "Olivia",
        "Ethan",
        "Aiden",
    ]

    last_names = [
        "Banks",
        "Marley",
        "Konan",
        "Lopez",
        "Gonzales",
        "Levine",
        "Fofana",
        "Hernan",
        "Zheng",
        "Chergui",
        "Courrege",
        "Blue",
        "Green",
        "Wood",
        "Smith",
        "Johnson",
        "Williams",
        "Brown",
        "Jones",
        "Garcia",
        "Miller",
        "Davis",
        "Rodriguez",
        "Martinez",
        "Hernandez",
        "Wilson",
        "Anderson",
        "Thomas",
    ]

    addresses = [
        "8 Rue de la Pompe, 75116 Paris",
        "174 Quai de Jemmapes, 75010 Paris, France",
        "60 Holborn Viaduct, London, EC1A 2FD",
        "3333 Piedmont Road NE, Atlanta, GA 30305",
        "2121 7th Ave, Seattle WA, 98121",
        "2021 7th Ave, Seattle WA, 98121",
        "31 place des Corolles, 92400 Courbevoie",
        "120 Avenue de Versailles, 75016 Paris",
        "1 Rue de la Paix, 75002 Paris",
        "1000 6th Ave, Seattle WA, 98121",
        "400 1st Ave, Seattle WA, 98101",
    ]

    # Fake credit cards (not real cards - from PayPal Braintree testing docs)
    fake_credit_cards = [
        "4217651111111119",
        "4500600000000061",
        "4005519200000004",
        "4012000077777777",
        "4012000033330026",
        "2223000048400011",
        "6304000000000000",
    ]

    # Use user_id as seed for consistent fake data per user
    random.seed(user_id)

    first_name = random.choice(first_names)
    last_name = random.choice(last_names)
    full_name = f"{first_name} {last_name}"

    # Generate email from name
    email = f"{first_name.lower()}.{last_name.lower()}@example.com"
    address = random.choice(addresses)
    credit_card = random.choice(fake_credit_cards)

    return {
        "user_id": user_id,
        "full_name": full_name,
        "email": email,
        "address": address,
        "credit_card": credit_card,
    }


def create_or_update_user(connection, user_data):
    """
    Create or update user in the database
    """
    try:
        with connection.cursor() as cursor:
            # Check if user already exists
            cursor.execute(
                "SELECT user_id FROM users WHERE user_id = %s", (user_data["user_id"],),
            )

            existing_user = cursor.fetchone()

            if existing_user:
                logger.info(
                    f"User {user_data['user_id']} already exists, skipping creation",
                )
                return False

            # Insert new user
            insert_sql = """
                INSERT INTO users (user_id, full_name, email, address, created_at)
                VALUES (%s, %s, %s, %s, %s)
            """

            cursor.execute(
                insert_sql,
                (
                    user_data["user_id"],
                    user_data["full_name"],
                    user_data["email"],
                    user_data["address"],
                    datetime.now(datetime.timezone.utc),
                ),
            )

            connection.commit()
            return True

    except Exception as error:
        logger.error(f"Error creating user {user_data['user_id']}: {error}")
        connection.rollback()
        raise


def process_sqs_message(message_body, connection):
    """
    Process a single SQS message and create user
    """
    try:
        # Parse the SQS message
        adoption_data = json.loads(message_body)
        user_id = adoption_data.get("userId")

        if not user_id:
            logger.error(f"No userId found in message: {message_body}")
            return False

        logger.info(f"Processing user creation for userId: {user_id}")

        # Generate fake user data
        user_data = generate_fake_user_data(user_id)

        # Log customer information for CloudWatch data protection demo
        logger.info(
            json.dumps(
                {
                    "PetId": adoption_data.get("petId", ""),
                    "PetType": adoption_data.get("petType", ""),
                    "UserID": user_id,
                    "caller": "user-creator-lambda",
                    "customer": {
                        "FullName": user_data["full_name"],
                        "Address": user_data["address"],
                        "CreditCard": user_data["credit_card"],
                        "Email": user_data["email"],
                    },
                    "method": "ProcessUserCreation",
                    "transactionId": adoption_data.get("transactionId", ""),
                    "timestamp": datetime.now(datetime.timezone.utc)
                    .isoformat()
                    .replace("+00:00", "Z"),
                },
            ),
        )

        # Create user in database
        created = create_or_update_user(connection, user_data)

        if created:
            logger.info(f"Successfully created user {user_id}")
        else:
            logger.info(f"User {user_id} already existed")

        return True

    except json.JSONDecodeError as error:
        logger.error(f"Invalid JSON in message body: {error}")
        return False
    except Exception as error:
        logger.error(f"Error processing message: {error}")
        return False


def lambda_handler(event, context):
    """
    Main Lambda handler for processing SQS messages and creating users
    """
    logger.info(
        f"User Creator Lambda started. Processing {len(event.get('Records', []))} messages",
    )

    try:
        # Get SSM parameter name from environment variable
        secret_parameter_name = os.environ.get("SECRET_PARAMETER_NAME")
        if not secret_parameter_name:
            error_msg = "SECRET_PARAMETER_NAME environment variable is required"
            logger.error(error_msg)
            raise ValueError(error_msg)

        logger.info(f"Using secret parameter: {secret_parameter_name}")

        # Get database credentials
        credentials = get_database_credentials(secret_parameter_name)

        # Create database connection
        connection = create_database_connection(credentials)

        try:
            processed_count = 0
            failed_count = 0

            # Process each SQS message
            for record in event.get("Records", []):
                message_body = record.get("body", "")

                if process_sqs_message(message_body, connection):
                    processed_count += 1
                else:
                    failed_count += 1

            logger.info(
                f"Processing complete. Processed: {processed_count}, "
                f"Failed: {failed_count}",
            )

            return {
                "statusCode": 200,
                "body": json.dumps(
                    {
                        "message": "User creation processing completed",
                        "processed": processed_count,
                        "failed": failed_count,
                    },
                ),
            }

        finally:
            connection.close()
            logger.info("Database connection closed")

    except Exception as error:
        error_msg = f"User creation processing failed: {str(error)}"
        logger.error(error_msg, exc_info=True)
        return {"statusCode": 500, "body": json.dumps({"error": error_msg})}
