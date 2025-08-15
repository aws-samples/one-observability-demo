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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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


class HealthResponse(BaseModel):
    status: str


# Create FastAPI app
app = FastAPI(
    title="Pet List Adoptions Service",
    description="Service for listing pet adoptions with enrichment from pet search",
    version="1.0.0",
)


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
        self.pet_search_url = os.getenv("APP_PET_SEARCH_URL")
        self.rds_secret_arn = os.getenv("APP_RDS_SECRET_ARN")

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

        except Exception as e:
            logger.error(f"Failed to fetch from Parameter Store: {e}")

    def _get_database_connection_string(self) -> str:
        """Get database connection string from AWS Secrets Manager"""
        try:
            # Check if this is a local test setup
            if self.rds_secret_arn == "local-secret":  # pragma: allowlist secret
                # Read from local file for testing
                with open("/app/local-secret.json") as f:  # pragma: allowlist secret
                    secret_data = json.loads(f.read())
            else:
                # Use AWS Secrets Manager
                secrets = boto3.client("secretsmanager")
                response = secrets.get_secret_value(SecretId=self.rds_secret_arn)
                secret_data = json.loads(response["SecretString"])

            # Build connection string for psycopg2
            connection_string = (
                f"postgresql://{secret_data['username']}:"
                f"{secret_data['password']}@{secret_data['host']}:"
                f"{secret_data.get('port', 5432)}/{secret_data['dbname']}"
            )

            logger.info(f"Generated connection string for host: {secret_data['host']}")
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

    def _get_latest_adoptions(self) -> List[Dict[str, Any]]:
        """Get latest adoptions from database"""
        with self._get_database_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT pet_id, transaction_id, adoption_date FROM "
                    "transactions ORDER BY id DESC LIMIT 25",
                )
                rows = cursor.fetchall()

                return [
                    {
                        "pet_id": pet_id,
                        "transaction_id": transaction_id,
                        "adoption_date": (
                            adoption_date.isoformat() if adoption_date else None
                        ),
                    }
                    for pet_id, transaction_id, adoption_date in rows
                ]

    def _search_pet_info(self, pet_id: str) -> List[Dict[str, Any]]:
        """Search for pet information by pet_id"""
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

    def list_adoptions(self) -> List[Adoption]:
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


@app.get("/api/adoptionlist/", response_model=List[Adoption], tags=["adoptions"])
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
