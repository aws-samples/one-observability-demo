#!/usr/bin/env python3
"""
CDK Stack Exports Management Tool

This script extracts CloudFormation stack exports from CDK deployments,
generates a searchable HTML dashboard, and uploads it to S3 for easy access.

Features:
- Multi-region export aggregation (primary region + us-east-1 for WAF)
- Professional HTML template with AWS branding
- Real-time search across export names, descriptions, and stack names
- S3 upload with CloudFront cache optimization
- Workshop disclaimer and security notices
"""

import argparse
import boto3
import json
import os
import sys
import logging
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional
from botocore.exceptions import ClientError, NoCredentialsError, BotoCoreError
from jinja2 import Environment, FileSystemLoader, select_autoescape


# Enhanced logging configuration
class ColoredFormatter(logging.Formatter):
    """Custom formatter to add colors to log levels"""

    COLORS = {
        "DEBUG": "\033[36m",  # Cyan
        "INFO": "\033[32m",  # Green
        "WARNING": "\033[33m",  # Yellow
        "ERROR": "\033[31m",  # Red
        "CRITICAL": "\033[35m",  # Magenta
    }
    RESET = "\033[0m"

    def format(self, record):
        if hasattr(record, "levelname"):
            color = self.COLORS.get(record.levelname, self.RESET)
            record.levelname = f"{color}{record.levelname}{self.RESET}"
        return super().format(record)


# Configure enhanced logging
def setup_logging(log_level: str = "INFO", enable_colors: bool = True):
    """Setup enhanced logging with colors and detailed formatting"""

    # Convert string level to logging constant
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)

    # Create formatter
    formatter: logging.Formatter
    if enable_colors and hasattr(sys.stderr, "isatty") and sys.stderr.isatty():
        formatter = ColoredFormatter(
            "%(asctime)s - %(levelname)s - "
            "[%(name)s:%(funcName)s:%(lineno)d] - %(message)s",
        )
    else:
        formatter = logging.Formatter(
            "%(asctime)s - %(levelname)s - "
            "[%(name)s:%(funcName)s:%(lineno)d] - %(message)s",
        )

    # Setup root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)

    # Clear existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Add console handler
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # Reduce boto3/botocore noise unless in debug mode
    if numeric_level > logging.DEBUG:
        logging.getLogger("boto3").setLevel(logging.WARNING)
        logging.getLogger("botocore").setLevel(logging.WARNING)
        logging.getLogger("urllib3").setLevel(logging.WARNING)


# Initialize logging
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
setup_logging(LOG_LEVEL)
logger = logging.getLogger(__name__)

# Load environment variables from .env file (like the CDK code does)
try:
    from dotenv import load_dotenv

    # Look for .env file in the CDK directory structure
    # First try: current directory (when running from src/cdk)
    dotenv_path = os.path.join(os.getcwd(), ".env")
    if os.path.exists(dotenv_path):
        load_dotenv(dotenv_path)
        logger.info("Loaded environment variables from %s", dotenv_path)
    else:
        # Second try: relative to this script's location (src/cdk/scripts -> src/cdk)
        script_dir = os.path.dirname(os.path.abspath(__file__))
        dotenv_path = os.path.join(script_dir, "..", ".env")
        if os.path.exists(dotenv_path):
            load_dotenv(dotenv_path)
            logger.info("Loaded environment variables from %s", dotenv_path)
        else:
            logger.info("No .env file found, using system environment variables only")

except ImportError:
    logger.warning(
        "python-dotenv not available, using system environment variables only",
    )


class CDKExportsManager:
    """Manages CDK stack exports extraction, HTML generation, and S3 upload."""

    def __init__(self):
        self.primary_region = os.environ.get("AWS_REGION", "us-east-1")
        self.account_id = None
        self.exports_data = []
        self.session = None

        # Validate AWS environment during initialization
        self._validate_aws_environment()

    def _validate_aws_environment(self) -> None:
        """Validate AWS credentials and basic connectivity."""
        try:
            logger.debug("Validating AWS environment...")

            # Create session to test credentials
            self.session = boto3.Session()

            # Test credentials by getting caller identity
            sts_client = self.session.client("sts", region_name=self.primary_region)
            identity = sts_client.get_caller_identity()

            self.account_id = identity["Account"]
            user_arn = identity.get("Arn", "unknown")

            logger.info("AWS authentication successful")
            logger.debug(f"Account ID: {self.account_id}")
            logger.debug(f"User/Role ARN: {user_arn}")
            logger.debug(f"Primary region: {self.primary_region}")

        except NoCredentialsError:
            logger.error("AWS credentials not found")
            logger.error("Please configure credentials using:")
            logger.error("  - AWS CLI: aws configure")
            logger.error(
                "  - Environment variables: "
                "AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY",
            )
            logger.error("  - IAM roles (for EC2/ECS/Lambda)")
            logger.error("  - AWS SSO: aws sso login")
            raise
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if error_code in ["UnauthorizedOperation", "AccessDenied"]:
                logger.error("Access denied with current AWS credentials")
                logger.error(
                    "Required permissions: sts:GetCallerIdentity, "
                    "cloudformation:ListExports",
                )
            else:
                logger.error(f"AWS API error during validation: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error validating AWS environment: {e}")
            raise

    def get_target_regions(self) -> List[str]:
        """Determine which regions to scan for exports based on WAF configuration."""
        logger.debug("Determining target regions for export scanning...")

        regions = [self.primary_region]

        # Check if WAF is enabled by looking for the environment variable
        waf_enabled = os.environ.get("CUSTOM_ENABLE_WAF", "").lower() == "true"
        logger.debug(f"WAF enabled from environment: {waf_enabled}")

        if not waf_enabled:
            # Check for WAF exports in the current region as fallback
            logger.debug("Checking for WAF-related exports in primary region...")
            try:
                cf_client = self.session.client(
                    "cloudformation",
                    region_name=self.primary_region,
                )

                # Quick check for WAF exports without full enumeration
                exports_found = 0
                paginator = cf_client.get_paginator("list_exports")

                for page in paginator.paginate():
                    for export in page.get("Exports", []):
                        exports_found += 1
                        export_name = export.get("Name", "")
                        if "WAF" in export_name.upper():
                            waf_enabled = True
                            logger.debug(f"Found WAF export: {export_name}")
                            break
                    if waf_enabled:
                        break

                logger.debug(
                    f"Checked {exports_found} exports in {self.primary_region}",
                )

            except Exception as e:
                logger.warning(
                    "Could not check for WAF exports in %s: %s",
                    self.primary_region,
                    e,
                )

        if waf_enabled and "us-east-1" not in regions:
            regions.append("us-east-1")
            logger.info("WAF detected, including us-east-1 in export scan")

        logger.info(f"Target regions for scanning: {regions}")
        return regions

    def extract_exports(
        self,
        filter_prefix: Optional[str] = None,
        exclude_internal: bool = True,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ) -> List[Dict]:
        """
        Extract CloudFormation exports from all target regions with
        comprehensive error handling.

        Args:
            filter_prefix: Only include exports with names starting with this prefix
            exclude_internal: Exclude AWS internal exports (AWS::, CDK::, etc.)
            max_retries: Maximum number of retries for failed API calls
            retry_delay: Delay between retries in seconds

        Returns:
            List of export dictionaries with metadata
        """
        logger.info("=" * 60)
        logger.info("STARTING EXPORT EXTRACTION")
        logger.info("=" * 60)

        if filter_prefix:
            logger.info(f"Filter prefix: '{filter_prefix}'")
        else:
            logger.info("No filter prefix - extracting all exports")

        logger.info(f"Exclude internal: {exclude_internal}")
        logger.info(f"Max retries: {max_retries}")

        all_exports: List[Dict] = []
        regions = self.get_target_regions()
        extraction_stats: Dict[str, int] = {
            "regions_scanned": 0,
            "regions_failed": 0,
            "total_raw_exports": 0,
            "filtered_exports": 0,
            "internal_excluded": 0,
        }
        errors_encountered: List[str] = []

        for region_idx, region in enumerate(regions, 1):
            logger.info(f"[{region_idx}/{len(regions)}] Processing region: {region}")
            extraction_stats["regions_scanned"] += 1

            region_exports = []
            region_errors = []

            for attempt in range(max_retries):
                try:
                    cf_client = self.session.client(
                        "cloudformation",
                        region_name=region,
                    )

                    logger.debug(
                        "Attempt %d/%d for region %s",
                        attempt + 1,
                        max_retries,
                        region,
                    )

                    # Use paginator to handle large result sets
                    paginator = cf_client.get_paginator("list_exports")
                    page_count = 0

                    logger.debug("Starting paginated export retrieval...")

                    for page in paginator.paginate():
                        page_count += 1
                        page_exports = page.get("Exports", [])

                        logger.debug(
                            "Processing page %d with %d exports",
                            page_count,
                            len(page_exports),
                        )
                        extraction_stats["total_raw_exports"] += len(page_exports)

                        for export_idx, export in enumerate(page_exports):
                            try:
                                export_name = export.get("Name", "")
                                export_value = export.get("Value", "")
                                exporting_stack_id = export.get("ExportingStackId", "")

                                if not export_name:
                                    logger.warning(
                                        "Export missing name in %s: %s",
                                        region,
                                        export,
                                    )
                                    continue

                                logger.debug(f"Processing export: {export_name}")

                                # Extract stack name from stack ID
                                stack_name = self._extract_stack_name(
                                    exporting_stack_id,
                                )

                                # Apply filters with detailed logging
                                if filter_prefix and not export_name.startswith(
                                    filter_prefix,
                                ):
                                    logger.debug(
                                        "Filtered out (prefix): %s",
                                        export_name,
                                    )
                                    extraction_stats["filtered_exports"] += 1
                                    continue

                                if exclude_internal and self._is_internal_export(
                                    export_name,
                                ):
                                    logger.debug(
                                        "Filtered out (internal): %s",
                                        export_name,
                                    )
                                    extraction_stats["internal_excluded"] += 1
                                    continue

                                # Get additional stack metadata with error handling
                                stack_info = self._get_stack_info_safe(
                                    cf_client,
                                    stack_name,
                                    region,
                                )

                                export_data = {
                                    "exportName": export_name,
                                    "exportValue": export_value,
                                    "stackName": stack_name,
                                    "stackId": exporting_stack_id,
                                    "region": region,
                                    "description": stack_info.get("description", ""),
                                    "stackStatus": stack_info.get("status", ""),
                                    "creationTime": stack_info.get("creation_time", ""),
                                    "tags": stack_info.get("tags", {}),
                                    "category": self._categorize_export(export_name),
                                    "isUrl": self._is_url_value(export_value),
                                    "consoleUrl": self._get_console_url(
                                        region,
                                        stack_name,
                                        export_name,
                                        export_value,
                                    ),
                                }

                                region_exports.append(export_data)
                                logger.debug(
                                    "Added export: %s -> %s",
                                    export_name,
                                    export_data["category"],
                                )

                            except Exception as export_error:
                                error_msg = (
                                    f"Error processing individual export in "
                                    f"{region}: {export_error}"
                                )
                                logger.error(error_msg)
                                region_errors.append(error_msg)
                                errors_encountered.append(error_msg)
                                continue

                    logger.info(
                        "Successfully extracted %d exports from %s (%d pages)",
                        len(region_exports),
                        region,
                        page_count,
                    )
                    all_exports.extend(region_exports)
                    break  # Success, no need to retry

                except ClientError as e:
                    error_code = e.response.get("Error", {}).get("Code", "Unknown")
                    error_msg = (
                        f"AWS API error in {region} (attempt {attempt + 1}): "
                        f"{error_code} - {str(e)}"
                    )

                    if error_code in ["UnauthorizedOperation", "AccessDenied"]:
                        logger.error(
                            "Access denied to CloudFormation exports in %s",
                            region,
                        )
                        logger.error(
                            "Required permissions: cloudformation:ListExports, "
                            "cloudformation:DescribeStacks",
                        )
                        break  # Don't retry auth errors
                    elif error_code == "Throttling":
                        logger.warning(
                            "API throttling in %s, attempt %d/%d",
                            region,
                            attempt + 1,
                            max_retries,
                        )
                        if attempt < max_retries - 1:
                            sleep_time = retry_delay * (
                                2**attempt
                            )  # Exponential backoff
                            logger.info(
                                "Waiting %.1f seconds before retry...",
                                sleep_time,
                            )
                            time.sleep(sleep_time)
                            continue
                    else:
                        logger.error(error_msg)

                    region_errors.append(error_msg)
                    errors_encountered.append(error_msg)

                    if attempt == max_retries - 1:
                        logger.error(
                            "Failed to extract exports from %s after %d attempts",
                            region,
                            max_retries,
                        )
                        extraction_stats["regions_failed"] += 1

                except BotoCoreError as e:
                    error_msg = (
                        f"Boto core error in {region} (attempt {attempt + 1}): "
                        f"{str(e)}"
                    )
                    logger.error(error_msg)
                    region_errors.append(error_msg)
                    errors_encountered.append(error_msg)

                    if attempt < max_retries - 1:
                        logger.info(f"Retrying in {retry_delay} seconds...")
                        time.sleep(retry_delay)
                        continue
                    else:
                        extraction_stats["regions_failed"] += 1

                except Exception as e:
                    error_msg = (
                        f"Unexpected error in {region} (attempt {attempt + 1}): "
                        f"{str(e)}"
                    )
                    logger.error(error_msg)
                    region_errors.append(error_msg)
                    errors_encountered.append(error_msg)

                    if attempt == max_retries - 1:
                        extraction_stats["regions_failed"] += 1

            # Log region summary
            if region_errors:
                logger.warning(
                    f"Region {region} completed with {len(region_errors)} errors",
                )
            else:
                logger.info(f"Region {region} completed successfully")

        # Sort exports by category, then by stack name, then by export name
        logger.debug("Sorting exports...")
        all_exports.sort(key=lambda x: (x["category"], x["stackName"], x["exportName"]))

        # Print comprehensive summary
        logger.info("=" * 60)
        logger.info("EXPORT EXTRACTION SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Regions scanned: {extraction_stats['regions_scanned']}")
        logger.info(f"Regions failed: {extraction_stats['regions_failed']}")
        logger.info(f"Total raw exports found: {extraction_stats['total_raw_exports']}")
        logger.info(
            "Exports filtered by prefix: %d",
            extraction_stats["filtered_exports"],
        )
        logger.info(
            "Internal exports excluded: %d",
            extraction_stats["internal_excluded"],
        )
        logger.info("Final exports included: %d", len(all_exports))

        if errors_encountered:
            logger.warning(
                "Total errors encountered: %d",
                len(errors_encountered),
            )
            if logger.getEffectiveLevel() <= logging.DEBUG:
                for error in errors_encountered:
                    logger.debug("  - %s", error)

        # Show breakdown by category
        if all_exports:
            category_counts: Dict[str, int] = {}
            for export in all_exports:
                category = export["category"]
                category_counts[category] = category_counts.get(category, 0) + 1

            logger.info("Exports by category:")
            for category, count in sorted(category_counts.items()):
                logger.info(f"  {category}: {count}")

        logger.info("=" * 60)

        self.exports_data = all_exports
        return all_exports

    def _extract_stack_name(self, stack_id: str) -> str:
        """Extract stack name from CloudFormation stack ID/ARN."""
        if not stack_id:
            return "Unknown"

        # Stack ID format: arn:aws:cloudformation:region:account:stack/stack-name/uuid
        if stack_id.startswith("arn:aws:cloudformation:"):
            parts = stack_id.split("/")
            if len(parts) >= 2:
                return parts[1]

        # For non-ARN formats, try to extract meaningful name
        return stack_id.split("/")[-1] if "/" in stack_id else stack_id

    def _is_internal_export(self, export_name: str) -> bool:
        """Check if an export is AWS/CDK internal."""
        internal_prefixes = ["AWS::", "CDK::", "cdk-", "CdkBootstrap", "StagingBucket"]
        return any(export_name.startswith(prefix) for prefix in internal_prefixes)

    def _categorize_export(self, export_name: str) -> str:
        """Categorize export based on prefix and naming patterns."""
        # First check for prefix-based categorization
        if ":" in export_name:
            prefix = export_name.split(":", 1)[0]
            if prefix == "public":
                # For public exports, use detailed categorization
                name_lower = export_name.lower()

                if any(
                    term in name_lower for term in ["vpc", "subnet", "cidr", "network"]
                ):
                    return "Networking"
                elif any(
                    term in name_lower
                    for term in ["database", "db", "rds", "aurora", "dynamo"]
                ):
                    return "Database"
                elif any(term in name_lower for term in ["bucket", "s3", "assets"]):
                    return "Storage"
                elif any(
                    term in name_lower for term in ["cluster", "ecs", "eks", "compute"]
                ):
                    return "Compute"
                elif any(
                    term in name_lower for term in ["api", "gateway", "endpoint", "url"]
                ):
                    return "API"
                elif any(
                    term in name_lower for term in ["security", "role", "policy", "waf"]
                ):
                    return "Security"
                elif any(
                    term in name_lower
                    for term in ["monitor", "log", "metric", "opensearch"]
                ):
                    return "Observability"
                else:
                    return "Other"
            elif prefix == "private":
                return "Private"
            else:
                # Unknown prefix, treat as other
                return "Other"
        else:
            # No prefix (no colon), categorize as internal-cdk
            return "internal-cdk"

    def _clean_export_name_for_display(self, export_name: str) -> str:
        """
        Clean export name for dashboard display by removing internal prefixes.

        The 'public:' and 'private:' prefixes are used internally for filtering
        but should not be shown to users in the dashboard.
        """
        # Remove common prefixes used for categorization
        prefixes_to_remove = ["public:", "private:"]

        for prefix in prefixes_to_remove:
            if export_name.startswith(prefix):
                return export_name[len(prefix) :]  # noqa: E203

        return export_name

    def _is_url_value(self, value: str) -> bool:
        """Check if export value appears to be a URL."""
        return value.startswith(("http://", "https://"))

    def _get_console_url(
        self,
        region: str,
        stack_name: str,
        export_name: str,
        export_value: str,
    ) -> str:
        """Generate AWS Console URL for the export's resource."""
        base_url = "https://console.aws.amazon.com/cloudformation/home"
        return f"{base_url}?region={region}#/stacks/stackinfo?stackId={stack_name}"

    def _get_stack_info_safe(self, cf_client, stack_name: str, region: str) -> Dict:
        """Get additional information about a CloudFormation stack with
        enhanced error handling.
        """
        try:
            logger.debug("Retrieving stack info for %s in %s", stack_name, region)

            response = cf_client.describe_stacks(StackName=stack_name)
            stack = response["Stacks"][0]

            # Convert datetime objects to strings
            creation_time = stack.get("CreationTime")
            if creation_time:
                creation_time = creation_time.isoformat()

            # Process tags
            tags = {}
            for tag in stack.get("Tags", []):
                tags[tag["Key"]] = tag["Value"]

            stack_info = {
                "description": stack.get("Description", ""),
                "status": stack.get("StackStatus", ""),
                "creation_time": creation_time,
                "tags": tags,
            }

            logger.debug(
                "Successfully retrieved stack info for %s: %s",
                stack_name,
                stack_info["status"],
            )
            return stack_info

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if error_code == "ValidationError":
                logger.debug("Stack %s not found or invalid in %s", stack_name, region)
            elif error_code in ["AccessDenied", "UnauthorizedOperation"]:
                logger.debug("Access denied to stack %s in %s", stack_name, region)
            else:
                logger.debug(
                    "API error getting stack info for %s in %s: %s",
                    stack_name,
                    region,
                    error_code,
                )
            return {}
        except Exception as e:
            logger.debug(
                "Unexpected error getting stack info for %s in %s: %s",
                stack_name,
                region,
                e,
            )
            return {}

    def _get_stack_info(self, cf_client, stack_name: str) -> Dict:
        """Get additional information about a CloudFormation stack."""
        try:
            response = cf_client.describe_stacks(StackName=stack_name)
            stack = response["Stacks"][0]

            # Convert datetime objects to strings
            creation_time = stack.get("CreationTime")
            if creation_time:
                creation_time = creation_time.isoformat()

            # Process tags
            tags = {}
            for tag in stack.get("Tags", []):
                tags[tag["Key"]] = tag["Value"]

            return {
                "description": stack.get("Description", ""),
                "status": stack.get("StackStatus", ""),
                "creation_time": creation_time,
                "tags": tags,
            }
        except Exception as e:
            logger.debug(f"Could not get stack info for {stack_name}: {e}")
            return {}

    def generate_html(self, template_path: Optional[str] = None) -> str:
        """
        Generate HTML dashboard from exports data.

        Args:
            template_path: Path to custom Jinja2 template file

        Returns:
            Generated HTML string
        """
        if not self.exports_data:
            raise ValueError("No exports data available. Run extract_exports() first.")

        # Set up Jinja2 environment
        template_dir = template_path or os.path.join(
            os.path.dirname(__file__),
            "templates",
        )
        env = Environment(
            loader=FileSystemLoader(template_dir),
            autoescape=select_autoescape(["html", "xml"]),
        )

        # Load template
        try:
            template = env.get_template("exports-dashboard.j2")
        except Exception as e:
            logger.error(f"Could not load template: {e}")
            # Fall back to built-in template
            template = env.from_string(self._get_builtin_template())

        # Prepare exports data with cleaned display names
        exports_for_display = []
        for export in self.exports_data:
            display_export = export.copy()
            display_export["displayName"] = self._clean_export_name_for_display(
                export["exportName"],
            )
            exports_for_display.append(display_export)

        # Prepare template context
        context = {
            "exports": exports_for_display,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_exports": len(self.exports_data),
            "regions": list({export["region"] for export in self.exports_data}),
            "categories": list({export["category"] for export in self.exports_data}),
            "stacks": list({export["stackName"] for export in self.exports_data}),
            "account_id": self.account_id or "Unknown",
        }

        # Generate HTML
        html_content = template.render(**context)
        logger.info("Generated HTML dashboard with %d exports", len(self.exports_data))

        return html_content

    def upload_to_s3(self, html_content: str, bucket_name: Optional[str] = None) -> str:
        """
        Upload HTML dashboard to S3.

        Args:
            html_content: Generated HTML content
            bucket_name: S3 bucket name (defaults to assets bucket from exports)

        Returns:
            S3 URL of uploaded file
        """
        if not bucket_name:
            # Try to get bucket name from exports or environment
            bucket_name = self._get_assets_bucket_name()

        if not bucket_name:
            raise ValueError(
                "No S3 bucket specified and could not determine assets bucket",
            )

        s3_client = boto3.client("s3")
        key = "workshop-exports/index.html"

        try:
            # Upload with proper content type and caching headers
            s3_client.put_object(
                Bucket=bucket_name,
                Key=key,
                Body=html_content.encode("utf-8"),
                ContentType="text/html; charset=utf-8",
                CacheControl="max-age=300, must-revalidate",  # 5-minute cache
                Metadata={
                    "generated-at": datetime.now(timezone.utc).isoformat(),
                    "total-exports": str(len(self.exports_data)),
                    "generator": "cdk-exports-manager",
                },
            )

            # Generate public URL
            s3_url = f"https://{bucket_name}.s3.amazonaws.com/{key}"

            # Try to get CloudFront URL if available
            cloudfront_url = self._get_cloudfront_url(bucket_name, key)

            logger.info("Uploaded exports dashboard to S3: %s", s3_url)
            if cloudfront_url:
                logger.info("CloudFront URL: %s", cloudfront_url)
                return cloudfront_url

            return s3_url

        except ClientError as e:
            logger.error(f"Failed to upload to S3: {e}")
            raise

    def _get_assets_bucket_name(self) -> Optional[str]:
        """Try to determine the assets bucket name from exports or environment."""
        # Check environment variable first
        bucket_name = os.environ.get("ASSETS_BUCKET_NAME")
        if bucket_name:
            return self._extract_bucket_name_from_arn(bucket_name)

        # Look for assets bucket in exports
        for export in self.exports_data:
            if (
                "AssetsBucket" in export["exportName"]
                or "assets" in export["exportName"].lower()
            ):
                return self._extract_bucket_name_from_arn(export["exportValue"])

        return None

    def _extract_bucket_name_from_arn(self, bucket_identifier: str) -> str:
        """Extract bucket name from S3 ARN or return as-is if already a bucket name."""
        if not bucket_identifier:
            return bucket_identifier

        # Check if it's an S3 ARN: arn:aws:s3:::bucket-name
        if bucket_identifier.startswith("arn:aws:s3:::"):
            # Extract bucket name after the last :::
            return bucket_identifier.split(":::")[-1]

        # If not an ARN, assume it's already a bucket name
        return bucket_identifier

    def _get_cloudfront_url(self, bucket_name: str, key: str) -> Optional[str]:
        """Try to get CloudFront distribution URL for the S3 bucket."""
        try:
            # Look specifically for WorkshopCloudFrontDomain export first
            for export in self.exports_data:
                if export["exportName"] == "WorkshopCloudFrontDomain":
                    base_url = export["exportValue"]
                    if base_url.startswith("https://"):
                        return f"{base_url.rstrip('/')}/{key}"
                    else:
                        # Add https if not present
                        return f"https://{base_url.rstrip('/')}/{key}"

            # Fallback: Look for other CloudFront-related exports
            for export in self.exports_data:
                if (
                    "cloudfront" in export["exportName"].lower()
                    or "distribution" in export["exportName"].lower()
                ):
                    base_url = export["exportValue"]
                    if base_url.startswith("https://"):
                        return f"{base_url.rstrip('/')}/{key}"
                    else:
                        return f"https://{base_url.rstrip('/')}/{key}"

            return None
        except Exception as e:
            logger.debug("Could not determine CloudFront URL: %s", e)
            return None

    def _get_builtin_template(self) -> str:
        """Return built-in HTML template if external template is not available."""
        return """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CDK Stack Exports Dashboard</title>
    <link
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"
        rel="stylesheet">
    <link
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css"
        rel="stylesheet">
    <style>
        .aws-orange { color: #FF9900; }
        .workshop-disclaimer { background: #fff3cd; border: 1px solid #ffeaa7; }
        .export-card { transition: all 0.2s ease; }
        .export-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }
        .category-badge { font-size: 0.75rem; }
        .search-highlight { background-color: yellow; font-weight: bold; }
        .logo { max-height: 40px; }
    </style>
</head>
<body>
    <!-- Built-in template content would go here -->
    <!-- This is a fallback - the actual template will be in a separate file -->
</body>
</html>
        """


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="CDK Stack Exports Management Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Extract all exports and generate dashboard
  python manage-exports.py generate-dashboard

  # Extract only Workshop-prefixed exports
  python manage-exports.py extract --filter-prefix Workshop

  # Generate HTML with custom template
  python manage-exports.py generate-html --template my-template.j2

  # Upload to specific S3 bucket
  python manage-exports.py upload-to-s3 --bucket my-bucket
        """,
    )

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Extract command
    extract_parser = subparsers.add_parser("extract", help="Extract exports to JSON")
    extract_parser.add_argument(
        "--output",
        "-o",
        default="exports.json",
        help="Output JSON file path",
    )
    extract_parser.add_argument(
        "--filter-prefix",
        help="Only include exports with this prefix",
    )
    extract_parser.add_argument(
        "--include-internal",
        action="store_true",
        help="Include AWS/CDK internal exports",
    )

    # Generate HTML command
    html_parser = subparsers.add_parser("generate-html", help="Generate HTML dashboard")
    html_parser.add_argument(
        "--input",
        "-i",
        default="exports.json",
        help="Input JSON file path",
    )
    html_parser.add_argument(
        "--output",
        "-o",
        default="exports-dashboard.html",
        help="Output HTML file path",
    )
    html_parser.add_argument("--template", help="Custom Jinja2 template path")

    # Upload command
    upload_parser = subparsers.add_parser("upload-to-s3", help="Upload HTML to S3")
    upload_parser.add_argument(
        "--input",
        "-i",
        default="exports-dashboard.html",
        help="Input HTML file path",
    )
    upload_parser.add_argument("--bucket", help="S3 bucket name")

    # Generate dashboard (all-in-one) command
    dashboard_parser = subparsers.add_parser(
        "generate-dashboard",
        help="Extract, generate, and upload dashboard",
    )
    dashboard_parser.add_argument(
        "--filter-prefix",
        default="Workshop",
        help="Export name prefix filter",
    )
    dashboard_parser.add_argument("--bucket", help="S3 bucket name")
    dashboard_parser.add_argument("--template", help="Custom template path")

    # Debug command for troubleshooting export discovery
    debug_parser = subparsers.add_parser(
        "debug-exports",
        help="Debug export discovery issues by comparing with AWS CLI output",
    )
    debug_parser.add_argument(
        "--region",
        help="Specific region to debug (defaults to primary region)",
    )
    debug_parser.add_argument(
        "--compare-cli",
        action="store_true",
        help="Compare results with AWS CLI list-exports command",
    )
    debug_parser.add_argument(
        "--show-all",
        action="store_true",
        help="Show all exports including internal ones",
    )

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    try:
        manager = CDKExportsManager()

        if args.command == "extract":
            exports = manager.extract_exports(
                filter_prefix=args.filter_prefix,
                exclude_internal=not args.include_internal,
            )

            with open(args.output, "w") as f:
                json.dump(exports, f, indent=2, default=str)

            logger.info(f"Exported {len(exports)} entries to {args.output}")

        elif args.command == "generate-html":
            # Load exports from JSON
            with open(args.input) as f:
                manager.exports_data = json.load(f)

            html_content = manager.generate_html(args.template)

            with open(args.output, "w", encoding="utf-8") as f:
                f.write(html_content)

            logger.info(f"Generated HTML dashboard: {args.output}")

        elif args.command == "upload-to-s3":
            with open(args.input, encoding="utf-8") as f:
                html_content = f.read()

            url = manager.upload_to_s3(html_content, args.bucket)
            logger.info(f"Dashboard available at: {url}")
            print(url)  # Output URL for use in scripts

        elif args.command == "generate-dashboard":
            # All-in-one: extract, generate, and upload
            logger.info("Starting complete dashboard generation...")

            exports = manager.extract_exports(
                filter_prefix=args.filter_prefix,
                exclude_internal=True,
            )

            if not exports:
                logger.warning("No exports found matching criteria")
                sys.exit(1)

            html_content = manager.generate_html(args.template)
            url = manager.upload_to_s3(html_content, args.bucket)

            logger.info("Dashboard generation complete!")
            logger.info("Found %d exports", len(exports))
            logger.info("Dashboard URL: %s", url)
            print(url)  # Output for pipeline use

        elif args.command == "debug-exports":
            # Debug export discovery issues
            debug_region = args.region or manager.primary_region
            logger.info("Debugging export discovery in region: %s", debug_region)

            # Extract exports with debug logging enabled
            original_log_level = logger.getEffectiveLevel()
            setup_logging("DEBUG")  # Force debug logging for this operation

            try:
                exports = manager.extract_exports(
                    filter_prefix=None,  # No filter for debugging
                    exclude_internal=not args.show_all,
                    max_retries=1,  # Faster for debugging
                )

                # Compare with AWS CLI if requested
                if args.compare_cli:
                    logger.info("Comparing with AWS CLI results...")
                    manager._compare_with_cli(debug_region)

            finally:
                # Restore original log level
                setup_logging(logging.getLevelName(original_log_level))

    except NoCredentialsError:
        logger.error("AWS credentials not found. Please configure your credentials.")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
