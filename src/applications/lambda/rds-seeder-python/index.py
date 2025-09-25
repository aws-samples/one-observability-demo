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
        -- Create pets table for adoption listings
        CREATE TABLE IF NOT EXISTS pets (
            id SERIAL PRIMARY KEY,
            petid VARCHAR(10) UNIQUE NOT NULL,
            pettype VARCHAR(50) NOT NULL,
            availability VARCHAR(10) NOT NULL DEFAULT 'yes',
            cuteness_rate INTEGER NOT NULL DEFAULT 5,
            image VARCHAR(100),
            petcolor VARCHAR(50),
            price DECIMAL(10,2) NOT NULL,
            description TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

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

        -- Create indexes for better performance
        CREATE INDEX IF NOT EXISTS idx_pets_pettype ON pets(pettype);
        CREATE INDEX IF NOT EXISTS idx_pets_availability ON pets(availability);
        CREATE INDEX IF NOT EXISTS idx_pets_petid ON pets(petid);
        CREATE INDEX IF NOT EXISTS idx_transactions_pet_id ON transactions(pet_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
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


def load_pet_data():
    """
    Load pet data from seed.json file
    """
    try:
        # Get the directory of this script
        script_dir = os.path.dirname(os.path.abspath(__file__))
        seed_file_path = os.path.join(script_dir, "seed.json")

        with open(seed_file_path) as file:
            return json.load(file)
    except Exception as error:
        logger.error(f"Error loading seed data: {error}")
        raise


def seed_pets_data(connection):
    """
    Seed pets data into the database
    """
    logger.info("Seeding pets data...")

    pet_data = load_pet_data()
    inserted_count = 0

    # Clear existing data first
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM transactions")
        cursor.execute("DELETE FROM pets")
    connection.commit()
    logger.info("Cleared existing data")

    insert_sql = """
        INSERT INTO pets (petid, pettype, availability, cuteness_rate, image,
                         petcolor, price, description)
        VALUES (%(petid)s, %(pettype)s, %(availability)s, %(cuteness_rate)s,
                %(image)s, %(petcolor)s, %(price)s, %(description)s)
        ON CONFLICT (petid) DO UPDATE SET
            pettype = EXCLUDED.pettype,
            availability = EXCLUDED.availability,
            cuteness_rate = EXCLUDED.cuteness_rate,
            image = EXCLUDED.image,
            petcolor = EXCLUDED.petcolor,
            price = EXCLUDED.price,
            description = EXCLUDED.description,
            updated_at = CURRENT_TIMESTAMP
    """

    try:
        with connection.cursor() as cursor:
            for pet in pet_data:
                cursor.execute(
                    insert_sql,
                    {
                        "petid": pet["petid"],
                        "pettype": pet["pettype"],
                        "availability": pet["availability"],
                        "cuteness_rate": int(pet["cuteness_rate"]),
                        "image": pet["image"],
                        "petcolor": pet["petcolor"],
                        "price": float(pet["price"]),
                        "description": pet["description"],
                    },
                )
                inserted_count += 1
                logger.info(f"Inserted pet: {pet['petid']} ({pet['pettype']})")

        connection.commit()
        logger.info(f"Successfully inserted {inserted_count} pets")
        return inserted_count

    except Exception as error:
        logger.error(f"Error seeding pets data: {error}")
        connection.rollback()
        raise


def load_adoption_data():
    """
    Load adoption data from adoptions.json file
    """
    try:
        # Get the directory of this script
        script_dir = os.path.dirname(os.path.abspath(__file__))
        adoptions_file_path = os.path.join(script_dir, "adoptions.json")

        with open(adoptions_file_path) as file:
            return json.load(file)
    except Exception as error:
        logger.error(f"Error loading adoption data: {error}")
        raise


def seed_adoptions_data(connection):
    """
    Seed sample adoptions data
    """
    logger.info("Seeding sample adoptions data...")

    sample_adoptions = load_adoption_data()

    inserted_count = 0
    insert_sql = """
        INSERT INTO transactions (pet_id, transaction_id, adopter_name,
                                 adopter_email, status, notes)
        VALUES (%(pet_id)s, %(transaction_id)s, %(adopter_name)s,
                %(adopter_email)s, %(status)s, %(notes)s)
    """

    try:
        with connection.cursor() as cursor:
            for adoption in sample_adoptions:
                # Generate a unique transaction ID
                transaction_id = (
                    f"TXN-{adoption['petid']}-{int(time.time())}-"
                    f"{random.randint(1000, 9999)}"
                )

                cursor.execute(
                    insert_sql,
                    {
                        "pet_id": adoption["petid"],
                        "transaction_id": transaction_id,
                        "adopter_name": adoption["adopter_name"],
                        "adopter_email": adoption["adopter_email"],
                        "status": adoption["status"],
                        "notes": adoption["notes"],
                    },
                )
                inserted_count += 1
                logger.info(f"Inserted adoption for pet: {adoption['petid']}")

        connection.commit()
        logger.info(f"Successfully inserted {inserted_count} adoptions")
        return inserted_count

    except Exception as error:
        logger.error(f"Error seeding adoptions data: {error}")
        connection.rollback()
        raise


def verify_data(connection):
    """
    Verify seeded data
    """
    logger.info("Verifying seeded data...")

    try:
        with connection.cursor() as cursor:
            # Count pets
            cursor.execute("SELECT COUNT(*) as count FROM pets")
            pets_count = cursor.fetchone()["count"]

            # Count transactions
            cursor.execute("SELECT COUNT(*) as count FROM transactions")
            transactions_count = cursor.fetchone()["count"]

            logger.info(f"Total pets: {pets_count}")
            logger.info(f"Total transactions: {transactions_count}")

            # Show sample data
            cursor.execute("SELECT petid, pettype, petcolor, price FROM pets LIMIT 5")
            sample_pets = cursor.fetchall()

            logger.info("Sample pets:")
            for pet in sample_pets:
                logger.info(
                    f"  - {pet['petid']}: {pet['pettype']} "
                    f"({pet['petcolor']}) - ${pet['price']}",
                )

            # Convert Decimal objects to float for JSON serialization
            sample_pets_serializable = []
            for pet in sample_pets:
                pet_dict = dict(pet)
                # Convert Decimal to float
                if "price" in pet_dict and isinstance(pet_dict["price"], Decimal):
                    pet_dict["price"] = float(pet_dict["price"])
                sample_pets_serializable.append(pet_dict)

            return {
                "pets_count": pets_count,
                "transactions_count": transactions_count,
                "sample_pets": sample_pets_serializable,
            }

    except Exception as error:
        logger.error(f"Error verifying data: {error}")
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

            # Seed data
            pets_count = seed_pets_data(connection)
            adoptions_count = seed_adoptions_data(connection)

            # Verify data
            verification_results = verify_data(connection)

            logger.info("RDS seeding completed successfully!")

            return {
                "statusCode": 200,
                "body": json.dumps(
                    {
                        "message": "RDS seeding completed successfully",
                        "pets_seeded": pets_count,
                        "adoptions_seeded": adoptions_count,
                        "verification": verification_results,
                    },
                ),
            }

        finally:
            connection.close()
            logger.info("Database connection closed")

    except Exception as error:
        error_msg = f"RDS seeding failed: {str(error)}"
        logger.error(error_msg, exc_info=True)
        return {"statusCode": 500, "body": json.dumps({"error": error_msg})}
