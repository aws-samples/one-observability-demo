# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import json
import logging
import os
import time
from contextlib import contextmanager
from typing import Any
from typing import Dict
from typing import List
from typing import Optional

import boto3
import psycopg2
import requests
from fastapi import FastAPI
from fastapi import HTTPException
from prometheus_client import CONTENT_TYPE_LATEST
from prometheus_client import Counter
from prometheus_client import generate_latest
from prometheus_client import Histogram
from pydantic import BaseModel

# OpenTelemetry imports
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.psycopg2 import Psycopg2Instrumentor

# from opentelemetry.instrumentation.boto3sqs import Boto3SqsInstrumentor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize OpenTelemetry tracer
tracer = trace.get_tracer(__name__)

# Prometheus metrics
REQUEST_COUNT = Counter(
    "petlistadoptions_requests_total",
    "Number of requests received",
    ["endpoint", "error"],
)
REQUEST_LATENCY = Histogram(
    "petlistadoptions_requests_latency_seconds",
    "Request durations in seconds",
    ["endpoint", "error"],
)


# Pydantic models for type safety
class Adoption(BaseModel):
    transactionid: Optional[str] = None
    adoptiondate: Optional[str] = None
    availability: Optional[str] = None
    cuteness_rate: Optional[str] = None
    petcolor: Optional[str] = None
    petid: Optional[str] = None
    pettype: Optional[str] = None
    peturl: Optional[str] = None
    price: Optional[str] = None
    # User information from database join
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    name_length: Optional[int] = None
    email_lower: Optional[str] = None


class HealthResponse(BaseModel):
    status: str


# Create FastAPI app
app = FastAPI(
    title="Pet List Adoptions Service",
    description="Service for listing pet adoptions with enrichment from pet search",
    version="1.0.0",
)

# Instrument OpenTelemetry
FastAPIInstrumentor.instrument_app(app)
RequestsInstrumentor().instrument()
Psycopg2Instrumentor().instrument()
# Boto3SqsInstrumentor().instrument()


class DatabaseConfig:
    """Database configuration from AWS Secrets Manager"""  # pragma: allowlist secret

    def __init__(
        self,
        engine: str,
        host: str,
        username: str,
        password: str,
        dbname: str,
        port: int,
    ):
        self.engine = engine
        self.host = host
        self.username = username
        self.password = password
        self.dbname = dbname
        self.port = port


class PetAdoptionsService:
    """Main service class following Python best practices"""

    def __init__(self):
        self.pet_search_url = os.getenv("APP_PET_SEARCH_URL")
        self.rds_secret_arn = os.getenv(
            "APP_RDS_SECRET_ARN",
        )  # pragma: allowlist secret

        # If not set via env vars, try to get from Parameter Store
        if not self.pet_search_url or not self.rds_secret_arn:
            self._fetch_from_parameter_store()

    def _fetch_from_parameter_store(self):
        """Fetch configuration from AWS Parameter Store"""
        with tracer.start_as_current_span("fetch_parameter_store_config") as span:
            try:
                span.set_attribute("config.parameter_count", 2)
                span.set_attribute(
                    "config.parameters",
                    ["/petstore/rdssecretarn", "/petstore/searchapiurl"],
                )

                ssm = boto3.client("ssm")
                response = ssm.get_parameters(
                    Names=["/petstore/rdssecretarn", "/petstore/searchapiurl"],
                )

                for param in response["Parameters"]:
                    if param["Name"] == "/petstore/rdssecretarn":
                        self.rds_secret_arn = param["Value"]
                        span.set_attribute(
                            "config.rds_secret_arn",
                            param["Value"],
                        )  # pragma: allowlist secret
                    elif param["Name"] == "/petstore/searchapiurl":
                        self.pet_search_url = param["Value"]
                        span.set_attribute("config.pet_search_url", param["Value"])

                span.set_attribute("config.success", True)
                span.set_attribute(
                    "config.retrieved_count",
                    len(response["Parameters"]),
                )

            except Exception as e:
                span.record_exception(e)
                span.set_attribute("config.success", False)
                span.set_attribute("config.error", str(e))
                logger.error(f"Failed to fetch from Parameter Store: {e}")

    def _get_database_connection_string(self) -> str:
        """Get database connection string from AWS Secrets Manager"""  # pragma: allowlist secret  # noqa: E501
        with tracer.start_as_current_span("get_database_connection_string") as span:
            try:
                span.set_attribute(
                    "db.secret_arn",
                    self.rds_secret_arn,
                )  # pragma: allowlist secret
                span.set_attribute(
                    "db.is_local",
                    self.rds_secret_arn == "local-secret",
                )  # pragma: allowlist secret

                # Check if this is a local test setup
                if self.rds_secret_arn == "local-secret":  # pragma: allowlist secret
                    # Read from local file for testing
                    with open(
                        "/app/local-secret.json",
                    ) as f:  # pragma: allowlist secret
                        secret_data = json.loads(f.read())
                    span.set_attribute("db.source", "local_file")
                else:
                    # Use AWS Secrets Manager
                    secrets = boto3.client("secretsmanager")  # pragma: allowlist secret
                    response = secrets.get_secret_value(
                        SecretId=self.rds_secret_arn,
                    )  # pragma: allowlist secret
                    secret_data = json.loads(
                        response["SecretString"],
                    )  # pragma: allowlist secret
                    span.set_attribute(
                        "db.source",
                        "aws_secrets_manager",
                    )  # pragma: allowlist secret

                # Build connection string for psycopg2
                connection_string = (
                    f"postgresql://{secret_data['username']}:"
                    f"{secret_data['password']}@{secret_data['host']}:"
                    f"{secret_data.get('port', 5432)}/{secret_data['dbname']}"
                )

                # Trace connection details (without sensitive data)
                span.set_attribute("db.host", secret_data["host"])
                span.set_attribute("db.port", secret_data.get("port", 5432))
                span.set_attribute("db.database", secret_data["dbname"])
                span.set_attribute("db.username", secret_data["username"])
                span.set_attribute("db.connection_success", True)

                logger.info(
                    f"Generated connection string for host: {secret_data['host']}",
                )
                return connection_string

            except Exception as e:
                span.record_exception(e)
                span.set_attribute("db.connection_success", False)
                span.set_attribute("db.error", str(e))
                logger.error(f"Failed to get database connection string: {e}")
                raise

    @contextmanager
    def _get_database_connection(self):
        """Context manager for database connections"""
        connection_string = self._get_database_connection_string()
        conn = psycopg2.connect(connection_string)
        try:
            yield conn
        finally:
            conn.close()

    def _get_latest_adoptions(self) -> List[Dict[str, Any]]:
        """
        Get latest adoptions from database with user information -
        intentionally slow for observability workshop
        """
        logger.info("Starting to fetch latest adoptions from database")
        with tracer.start_as_current_span("get_latest_adoptions") as span:
            with self._get_database_connection() as conn:
                logger.info("Database connection established for adoptions query")
                with conn.cursor() as cursor:
                    # Intentionally inefficient query for observability demo:
                    # - Uses old-style JOIN syntax (comma-separated tables)
                    # - No proper indexes on the join condition
                    # - Function calls without indexes (LOWER, LENGTH)
                    # - ORDER BY with function calls
                    slow_query = """
                    SELECT
                        t.pet_id,
                        t.transaction_id,
                        t.adoption_date,
                        t.user_id,
                        u.full_name,
                        u.email,
                        LENGTH(u.full_name) as name_length,
                        LOWER(u.email) as email_lower
                    FROM transactions t, users u
                    WHERE t.user_id = u.user_id
                        AND t.status = 'completed'
                    ORDER BY t.adoption_date DESC, LENGTH(u.full_name) DESC
                    LIMIT 25
                    """

                    span.set_attribute("db.query.type", "adoption_list")
                    span.set_attribute("db.query.limit", 25)
                    span.set_attribute("db.query.optimization", "intentionally_slow")
                    span.set_attribute(
                        "db.query.features",
                        ["old_join_syntax", "function_calls", "no_indexes"],
                    )

                    logger.info(
                        "Executing adoption list query with user join - query limit: 25 rows",  # noqa: E501
                    )
                    logger.debug(
                        "Query details - type: adoption_list, optimization: intentionally_slow, features: old_join_syntax, function_calls, no_indexes",  # noqa: E501
                    )
                    start_time = time.time()
                    cursor.execute(slow_query)
                    rows = cursor.fetchall()
                    query_duration = time.time() - start_time

                    # Trace query performance
                    span.set_attribute("db.query.duration_ms", query_duration * 1000)
                    span.set_attribute("db.query.rows_returned", len(rows))
                    span.set_attribute("db.query.success", True)

                    logger.info(
                        f"Adoption list query completed in {query_duration:.2f}s, "
                        f"returned {len(rows)} rows",
                    )

                    # Log details of each adoption record for comprehensive tracing
                    for idx, row in enumerate(rows):
                        logger.info(
                            f"Adoption {idx+1}: pet_id='{row[0]}', transaction_id='{row[1]}', "  # noqa: E501
                            f"adoption_date='{row[2]}', user_id='{row[3]}', user_name='{row[4]}', "  # noqa: E501
                            f"user_email='{row[5]}', name_length={row[6]}, email_lower='{row[7]}'",  # noqa: E501
                        )

                    return [
                        {
                            "pet_id": row[0],
                            "transaction_id": row[1],
                            "adoption_date": row[2].isoformat() if row[2] else None,
                            "user_id": row[3],
                            "user_name": row[4],
                            "user_email": row[5],
                            "name_length": row[6],
                            "email_lower": row[7],
                        }
                        for row in rows
                    ]

    def _search_pet_info(self, pet_id: str) -> List[Dict[str, Any]]:
        """Search for pet information by pet_id"""
        url = f"{self.pet_search_url}petid={pet_id}"
        logger.info(f"Searching for pet information - pet_id: '{pet_id}', url: {url}")

        with tracer.start_as_current_span("search_pet_info") as span:
            try:
                span.set_attribute("pet_search.pet_id", pet_id)
                span.set_attribute("pet_search.url", url)
                span.set_attribute("pet_search.timeout", 30)
                logger.debug(
                    f"Pet search request initiated - pet_id: '{pet_id}', timeout: 30s",
                )

                start_time = time.time()
                logger.debug(
                    f"Making HTTP GET request to pet search service for pet_id: '{pet_id}'",  # noqa: E501
                )
                response = requests.get(url, timeout=30)
                request_duration = time.time() - start_time

                span.set_attribute("pet_search.duration_ms", request_duration * 1000)
                span.set_attribute("pet_search.status_code", response.status_code)
                span.set_attribute("pet_search.success", True)

                logger.info(
                    f"Pet search HTTP response received - pet_id: '{pet_id}', status_code: {response.status_code}, duration: {request_duration:.2f}s",  # noqa: E501
                )

                response.raise_for_status()
                pet_data = response.json()
                logger.debug(
                    f"Pet search response parsed - pet_id: '{pet_id}', data_type: {type(pet_data)}, data_length: {len(pet_data) if isinstance(pet_data, list) else 'N/A'}",  # noqa: E501
                )

                span.set_attribute("pet_search.pets_found", len(pet_data))
                logger.info(
                    f"Pet search completed successfully - pet_id: '{pet_id}', pets_found: {len(pet_data)}",  # noqa: E501
                )

                if pet_data:
                    # Trace first pet's details for context
                    first_pet = pet_data[0]
                    span.set_attribute(
                        "pet_search.first_pet.id",
                        first_pet.get("petid", ""),
                    )
                    span.set_attribute(
                        "pet_search.first_pet.type",
                        first_pet.get("pettype", ""),
                    )
                    span.set_attribute(
                        "pet_search.first_pet.availability",
                        first_pet.get("availability", ""),
                    )

                    logger.info(
                        f"First pet details for pet_id '{pet_id}': petid='{first_pet.get('petid', '')}', pettype='{first_pet.get('pettype', '')}', availability='{first_pet.get('availability', '')}'",  # noqa: E501
                    )

                    # Log details of all pets found
                    for idx, pet in enumerate(pet_data):
                        logger.info(
                            f"Pet {idx+1} for pet_id '{pet_id}': petid='{pet.get('petid', '')}', pettype='{pet.get('pettype', '')}', petcolor='{pet.get('petcolor', '')}', availability='{pet.get('availability', '')}', cuteness_rate='{pet.get('cuteness_rate', '')}', price='{pet.get('price', '')}'",  # noqa: E501
                        )
                else:
                    logger.warning(f"No pets found for pet_id: '{pet_id}'")

                return pet_data

            except Exception as e:
                span.record_exception(e)
                span.set_attribute("pet_search.success", False)
                span.set_attribute("pet_search.error", str(e))
                span.set_attribute(
                    "pet_search.duration_ms",
                    (time.time() - start_time) * 1000,
                )
                logger.error(f"Failed to search pet {pet_id} - url: {url}, error: {e}")
                logger.debug(
                    f"Pet search error details - pet_id: '{pet_id}', exception_type: {type(e).__name__}, exception_message: {str(e)}",  # noqa: E501
                )
                return []

    def health_check(self) -> str:
        """Health check endpoint"""
        with tracer.start_as_current_span("health_check") as span:
            span.set_attribute("health.status", "alive")
            span.set_attribute("health.timestamp", time.time())
            return "alive"

    def list_adoptions(self) -> List[Adoption]:
        """List adoptions with pet information"""
        start_time = time.time()
        logger.info("Starting list_adoptions operation")

        with tracer.start_as_current_span("list_adoptions") as span:
            try:
                # Get adoptions from database
                logger.info("Fetching adoptions from database")
                adoptions = self._get_latest_adoptions()

                # Add adoption count to trace
                span.set_attribute("adoption.count", len(adoptions))
                logger.info(f"Retrieved {len(adoptions)} adoptions from database")

                # Enrich with pet information
                enriched_adoptions = []
                logger.info(
                    f"Starting to enrich {len(adoptions)} adoptions with pet information",  # noqa: E501
                )

                for idx, adoption in enumerate(adoptions):
                    logger.info(
                        f"Processing adoption {idx+1}/{len(adoptions)} - transaction_id: '{adoption['transaction_id']}', user_id: '{adoption['user_id']}', pet_id: '{adoption['pet_id']}'",  # noqa: E501
                    )

                    with tracer.start_as_current_span(
                        f"process_adoption_{idx}",
                    ) as adoption_span:
                        # Trace adoption data
                        adoption_span.set_attribute(
                            "adoption.transaction_id",
                            adoption["transaction_id"],
                        )
                        adoption_span.set_attribute(
                            "adoption.user_id",
                            adoption["user_id"],
                        )
                        adoption_span.set_attribute(
                            "adoption.user_name",
                            adoption["user_name"],
                        )
                        adoption_span.set_attribute(
                            "adoption.user_email",
                            adoption["user_email"],
                        )
                        adoption_span.set_attribute(
                            "adoption.name_length",
                            adoption["name_length"],
                        )
                        adoption_span.set_attribute(
                            "adoption.email_lower",
                            adoption["email_lower"],
                        )
                        adoption_span.set_attribute(
                            "adoption.adoption_date",
                            str(adoption["adoption_date"]),
                        )

                        logger.debug(
                            f"Searching for pet info - adoption {idx+1}, pet_id: '{adoption['pet_id']}', user_id: '{adoption['user_id']}'",  # noqa: E501
                        )
                        pet_info = self._search_pet_info(adoption["pet_id"])

                        logger.info(
                            f"Found {len(pet_info)} pets for adoption {idx+1}, pet_id: '{adoption['pet_id']}', user_id: '{adoption['user_id']}'",  # noqa: E501
                        )

                        for pet_idx, pet in enumerate(pet_info):
                            logger.info(
                                f"Enriching pet {pet_idx+1}/{len(pet_info)} for adoption {idx+1} - user_id: '{adoption['user_id']}', pet_id: '{pet.get('petid', '')}', pettype: '{pet.get('pettype', '')}'",  # noqa: E501
                            )

                            with tracer.start_as_current_span(
                                f"enrich_pet_{pet_idx}",
                            ) as pet_span:
                                # Trace pet data
                                pet_span.set_attribute(
                                    "pet.petid",
                                    pet.get("petid", ""),
                                )
                                pet_span.set_attribute(
                                    "pet.pettype",
                                    pet.get("pettype", ""),
                                )
                                pet_span.set_attribute(
                                    "pet.petcolor",
                                    pet.get("petcolor", ""),
                                )
                                pet_span.set_attribute(
                                    "pet.availability",
                                    pet.get("availability", ""),
                                )
                                pet_span.set_attribute(
                                    "pet.cuteness_rate",
                                    pet.get("cuteness_rate", ""),
                                )
                                pet_span.set_attribute(
                                    "pet.price",
                                    pet.get("price", ""),
                                )
                                pet_span.set_attribute(
                                    "pet.peturl",
                                    pet.get("peturl", ""),
                                )

                                enriched_adoption = Adoption(
                                    transactionid=adoption["transaction_id"],
                                    adoptiondate=adoption["adoption_date"],
                                    availability=pet.get("availability", ""),
                                    cuteness_rate=pet.get("cuteness_rate", ""),
                                    petcolor=pet.get("petcolor", ""),
                                    petid=pet.get("petid", ""),
                                    pettype=pet.get("pettype", ""),
                                    peturl=pet.get("peturl", ""),
                                    price=pet.get("price", ""),
                                    # Include user information from database
                                    user_id=adoption["user_id"],
                                    user_name=adoption["user_name"],
                                    user_email=adoption["user_email"],
                                    name_length=adoption["name_length"],
                                    email_lower=adoption["email_lower"],
                                )
                                enriched_adoptions.append(enriched_adoption)
                                logger.debug(
                                    f"Successfully enriched adoption {idx+1}, pet {pet_idx+1} - user_id: '{adoption['user_id']}', transaction_id: '{adoption['transaction_id']}', pet_id: '{pet.get('petid', '')}'",  # noqa: E501
                                )

                # Record metrics
                duration = time.time() - start_time
                span.set_attribute("adoption.result_count", len(enriched_adoptions))
                span.set_attribute("adoption.duration_ms", duration * 1000)
                REQUEST_COUNT.labels(endpoint="adoptionlist", error="false").inc()
                REQUEST_LATENCY.labels(endpoint="adoptionlist", error="false").observe(
                    duration,
                )

                logger.info(
                    f"List adoptions completed successfully - returned {len(enriched_adoptions)} enriched adoptions in {duration:.2f}s",  # noqa: E501
                )

                # Log summary of all enriched adoptions
                for idx, adoption in enumerate(enriched_adoptions):
                    logger.info(
                        f"Final adoption {idx+1}: user_id='{adoption.user_id}', user_name='{adoption.user_name}', user_email='{adoption.user_email}', transaction_id='{adoption.transactionid}', pet_id='{adoption.petid}', pettype='{adoption.pettype}', petcolor='{adoption.petcolor}', price='{adoption.price}'",  # noqa: E501
                    )

                return enriched_adoptions

            except Exception as e:
                # Record error in trace
                span.record_exception(e)
                span.set_attribute("error", True)
                span.set_attribute("error.message", str(e))

                # Record error metrics
                duration = time.time() - start_time
                REQUEST_COUNT.labels(endpoint="adoptionlist", error="true").inc()
                REQUEST_LATENCY.labels(endpoint="adoptionlist", error="true").observe(
                    duration,
                )
                logger.error(
                    f"Error in list_adoptions after {duration:.2f}s - exception_type: {type(e).__name__}, error_message: {str(e)}",  # noqa: E501
                )
                logger.debug(f"List adoptions error details - exception: {e}")
                raise


# Initialize service
service = PetAdoptionsService()


@app.get("/health/status", response_model=HealthResponse, tags=["health"])
async def health_check():
    """Health check endpoint"""
    with tracer.start_as_current_span("health_check_endpoint") as span:
        start_time = time.time()

        try:
            span.set_attribute("endpoint.name", "health_check")
            span.set_attribute("endpoint.method", "GET")
            span.set_attribute("endpoint.path", "/health/status")

            result = service.health_check()
            duration = time.time() - start_time

            span.set_attribute("endpoint.duration_ms", duration * 1000)
            span.set_attribute("endpoint.success", True)
            span.set_attribute("endpoint.response", result)

            REQUEST_COUNT.labels(endpoint="health_check", error="false").inc()
            REQUEST_LATENCY.labels(endpoint="health_check", error="false").observe(
                duration,
            )

            return HealthResponse(status=result)
        except Exception as e:
            span.record_exception(e)
            span.set_attribute("endpoint.success", False)
            span.set_attribute("endpoint.error", str(e))

            duration = time.time() - start_time
            span.set_attribute("endpoint.duration_ms", duration * 1000)

            REQUEST_COUNT.labels(endpoint="health_check", error="true").inc()
            REQUEST_LATENCY.labels(endpoint="health_check", error="true").observe(
                duration,
            )
            raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/adoptionlist/", response_model=List[Adoption], tags=["adoptions"])
async def list_adoptions():
    """List adoptions endpoint"""
    logger.info("List adoptions API endpoint accessed")

    with tracer.start_as_current_span("list_adoptions_endpoint") as span:
        try:
            span.set_attribute("endpoint.name", "list_adoptions")
            span.set_attribute("endpoint.method", "GET")
            span.set_attribute("endpoint.path", "/api/adoptionlist/")

            logger.info("Calling service.list_adoptions()")
            adoptions = service.list_adoptions()

            span.set_attribute("endpoint.success", True)
            span.set_attribute("endpoint.adoptions_returned", len(adoptions))

            logger.info(
                f"List adoptions endpoint completed successfully - returning {len(adoptions)} adoptions",  # noqa: E501
            )
            return adoptions
        except Exception as e:
            span.record_exception(e)
            span.set_attribute("endpoint.success", False)
            span.set_attribute("endpoint.error", str(e))
            logger.error(
                f"List adoptions endpoint failed - exception_type: {type(e).__name__}, error_message: {str(e)}",  # noqa: E501
            )
            raise HTTPException(status_code=500, detail=str(e))


@app.get("/metrics", tags=["monitoring"])
async def metrics():
    """Prometheus metrics endpoint"""
    with tracer.start_as_current_span("metrics_endpoint") as span:
        try:
            span.set_attribute("endpoint.name", "metrics")
            span.set_attribute("endpoint.method", "GET")
            span.set_attribute("endpoint.path", "/metrics")

            metrics_data = generate_latest()

            span.set_attribute("endpoint.success", True)
            span.set_attribute("endpoint.metrics_size", len(metrics_data))
            span.set_attribute("endpoint.content_type", CONTENT_TYPE_LATEST)

            return metrics_data, 200, {"Content-Type": CONTENT_TYPE_LATEST}
        except Exception as e:
            span.record_exception(e)
            span.set_attribute("endpoint.success", False)
            span.set_attribute("endpoint.error", str(e))
            raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 80))
    # Use localhost for production security, 0.0.0.0 only for containerized environments
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
