# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import json
import logging
import os
import time
from contextlib import contextmanager
from typing import Any

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

# OpenTelemetry auto-instrumentation will be handled via PYTHONPATH
# No manual instrumentation needed when using ADOT Python init container

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# OpenTelemetry auto-instrumentation will be initialized automatically via PYTHONPATH
# when using ADOT Python init container in ECS task definition

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
    transactionid: str | None = None
    adoptiondate: str | None = None
    availability: str | None = None
    cuteness_rate: str | None = None
    petcolor: str | None = None
    petid: str | None = None
    pettype: str | None = None
    peturl: str | None = None
    price: str | None = None
    # User information from database join
    user_id: str | None = None
    user_name: str | None = None
    user_email: str | None = None
    name_length: int | None = None
    email_lower: str | None = None


class HealthResponse(BaseModel):
    status: str


# Create FastAPI app
app = FastAPI(
    title="Pet List Adoptions Service",
    description="Service for listing pet adoptions with enrichment from pet search",
    version="1.0.0",
)

# Auto-instrumentation is handled by ADOT Python via PYTHONPATH
# No manual instrumentation calls needed


class DatabaseConfig:
    """Database configuration from AWS Secrets Manager"""

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
        self.refresh_interval = int(os.getenv("CONFIG_REFRESH_INTERVAL", "300"))
        self.pet_search_url = os.getenv("APP_PET_SEARCH_URL")
        self.rds_secret_arn = os.getenv("APP_RDS_SECRET_ARN")
        self._params_last_fetch = 0
        self._secret_last_fetch = 0
        self._cached_secret_data = None

        # If not set via env vars, try to get from Parameter Store
        if not self.pet_search_url or not self.rds_secret_arn:
            self._fetch_from_parameter_store()

    def _fetch_from_parameter_store(self):
        """Fetch configuration from AWS Parameter Store"""
        try:
            ssm = boto3.client("ssm")
            response = ssm.get_parameters(
                Names=["/petstore/rdssecretarn", "/petstore/searchapiurl"],
            )

            for param in response["Parameters"]:
                if param["Name"] == "/petstore/rdssecretarn":
                    self.rds_secret_arn = param["Value"]
                elif param["Name"] == "/petstore/searchapiurl":
                    self.pet_search_url = param["Value"]

            self._params_last_fetch = time.time()
            logger.info("Parameter Store values refreshed")

        except Exception as e:
            logger.error(f"Failed to fetch from Parameter Store: {e}")

    def _refresh_parameters_if_needed(self):
        """Refresh parameters if threshold exceeded"""
        if (
            self.refresh_interval != -1
            and time.time() - self._params_last_fetch > self.refresh_interval
        ):
            self._fetch_from_parameter_store()

    def _fetch_secret(self):
        """Fetch secret from AWS Secrets Manager"""
        if self.rds_secret_arn == "local-secret":  # pragma: allowlist secret
            with open("/app/local-secret.json") as f:  # pragma: allowlist secret
                self._cached_secret_data = json.loads(f.read())
        else:
            secrets = boto3.client("secretsmanager")
            response = secrets.get_secret_value(SecretId=self.rds_secret_arn)
            self._cached_secret_data = json.loads(response["SecretString"])

        self._secret_last_fetch = time.time()
        logger.info("Database secret refreshed")

    def _refresh_secret_if_needed(self):
        """Refresh secret if threshold exceeded"""
        if not self._cached_secret_data:
            self._fetch_secret()
        elif (
            self.refresh_interval != -1
            and time.time() - self._secret_last_fetch > self.refresh_interval
        ):
            self._fetch_secret()

    def _get_database_connection_string(self) -> str:
        """Get database connection string from AWS Secrets Manager"""
        try:
            self._refresh_secret_if_needed()

            connection_string = (
                f"postgresql://{self._cached_secret_data['username']}:"
                f"{self._cached_secret_data['password']}@"
                f"{self._cached_secret_data['host']}:"
                f"{self._cached_secret_data.get('port', 5432)}/"
                f"{self._cached_secret_data['dbname']}"
            )

            logger.info(
                f"Generated connection string for host: "
                f"{self._cached_secret_data['host']}",
            )
            return connection_string

        except Exception as e:
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

    def _get_latest_adoptions(self) -> list[dict[str, Any]]:
        """
        Get latest adoptions from database with user information -
        intentionally slow for observability workshop
        """
        with self._get_database_connection() as conn:
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

                logger.info("Executing adoption list query with user join")
                start_time = time.time()
                cursor.execute(slow_query)
                rows = cursor.fetchall()
                query_duration = time.time() - start_time

                logger.info(
                    f"Adoption list query completed in {query_duration:.2f}s, "
                    f"returned {len(rows)} rows",
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

    def _search_pet_info(self, pet_id: str) -> list[dict[str, Any]]:
        """Search for pet information by pet_id"""
        self._refresh_parameters_if_needed()
        url = f"{self.pet_search_url}petid={pet_id}"

        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Failed to search pet {pet_id}: {e}")
            return []

    def health_check(self) -> str:
        """Health check endpoint"""
        return "alive"

    def list_adoptions(self) -> list[Adoption]:
        """List adoptions with pet information"""
        start_time = time.time()

        try:
            # Get adoptions from database
            adoptions = self._get_latest_adoptions()

            # Enrich with pet information
            enriched_adoptions = []
            for adoption in adoptions:
                pet_info = self._search_pet_info(adoption["pet_id"])

                for pet in pet_info:
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

            # Record metrics
            duration = time.time() - start_time
            REQUEST_COUNT.labels(endpoint="adoptionlist", error="false").inc()
            REQUEST_LATENCY.labels(endpoint="adoptionlist", error="false").observe(
                duration,
            )

            return enriched_adoptions

        except Exception as e:
            # Record error metrics
            duration = time.time() - start_time
            REQUEST_COUNT.labels(endpoint="adoptionlist", error="true").inc()
            REQUEST_LATENCY.labels(endpoint="adoptionlist", error="true").observe(
                duration,
            )
            logger.error(f"Error in list_adoptions: {e}")
            raise


# Initialize service
service = PetAdoptionsService()


@app.get("/health/status", response_model=HealthResponse, tags=["health"])
async def health_check():
    """Health check endpoint"""
    start_time = time.time()

    try:
        result = service.health_check()
        duration = time.time() - start_time

        REQUEST_COUNT.labels(endpoint="health_check", error="false").inc()
        REQUEST_LATENCY.labels(endpoint="health_check", error="false").observe(duration)

        return HealthResponse(status=result)
    except Exception as e:
        duration = time.time() - start_time
        REQUEST_COUNT.labels(endpoint="health_check", error="true").inc()
        REQUEST_LATENCY.labels(endpoint="health_check", error="true").observe(duration)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/adoptionlist/", response_model=list[Adoption], tags=["adoptions"])
async def list_adoptions():
    """List adoptions endpoint"""
    try:
        adoptions = service.list_adoptions()
        return adoptions
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/metrics", tags=["monitoring"])
async def metrics():
    """Prometheus metrics endpoint"""
    return generate_latest(), 200, {"Content-Type": CONTENT_TYPE_LATEST}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 80))
    # Use localhost for production security, 0.0.0.0 only for containerized environments
    host = os.environ.get("HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port)
