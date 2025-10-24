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
from datetime import datetime, timezone
from typing import Dict, List, Optional
from botocore.exceptions import ClientError, NoCredentialsError
from jinja2 import Environment, FileSystemLoader, select_autoescape

# Configure logging first
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
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

    def get_target_regions(self) -> List[str]:
        """Determine which regions to scan for exports based on WAF configuration."""
        regions = [self.primary_region]

        # Check if WAF is enabled by looking for the environment variable
        # or by checking for WAF-related exports in the current region
        waf_enabled = os.environ.get("CUSTOM_ENABLE_WAF", "").lower() == "true"

        if not waf_enabled:
            # Check for WAF exports in the current region
            try:
                cf_client = boto3.client(
                    "cloudformation",
                    region_name=self.primary_region,
                )
                exports = cf_client.list_exports().get("Exports", [])
                waf_enabled = any("WAF" in export.get("Name", "") for export in exports)
            except Exception as e:
                logger.warning(f"Could not check for WAF exports: {e}")

        if waf_enabled and "us-east-1" not in regions:
            regions.append("us-east-1")
            logger.info("WAF detected, including us-east-1 in export scan")

        logger.info(f"Scanning regions: {regions}")
        return regions

    def extract_exports(
        self,
        filter_prefix: Optional[str] = None,
        exclude_internal: bool = True,
    ) -> List[Dict]:
        """
        Extract CloudFormation exports from all target regions.

        Args:
            filter_prefix: Only include exports with names starting with this prefix
            exclude_internal: Exclude AWS internal exports (AWS::, CDK::, etc.)

        Returns:
            List of export dictionaries with metadata
        """
        all_exports = []
        regions = self.get_target_regions()

        for region in regions:
            logger.info(f"Extracting exports from region: {region}")

            try:
                cf_client = boto3.client("cloudformation", region_name=region)

                # Get account ID from STS if not already retrieved
                if not self.account_id:
                    sts_client = boto3.client("sts", region_name=region)
                    self.account_id = sts_client.get_caller_identity()["Account"]

                # Paginate through exports
                paginator = cf_client.get_paginator("list_exports")

                for page in paginator.paginate():
                    for export in page.get("Exports", []):
                        export_name = export.get("Name", "")
                        export_value = export.get("Value", "")
                        exporting_stack_id = export.get("ExportingStackId", "")

                        # Extract stack name from stack ID
                        stack_name = self._extract_stack_name(exporting_stack_id)

                        # Apply filters
                        if filter_prefix and not export_name.startswith(filter_prefix):
                            continue

                        if exclude_internal and self._is_internal_export(export_name):
                            continue

                        # Get additional stack metadata
                        stack_info = self._get_stack_info(cf_client, stack_name)

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

                        all_exports.append(export_data)

            except ClientError as e:
                logger.error("Error extracting exports from %s: %s", region, e)
                continue
            except Exception as e:
                logger.error("Unexpected error in %s: %s", region, e)
                continue

        # Sort exports by category, then by stack name, then by export name
        all_exports.sort(key=lambda x: (x["category"], x["stackName"], x["exportName"]))

        logger.info(
            "Extracted %d exports from %d regions",
            len(all_exports),
            len(regions),
        )
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

        # Prepare template context
        context = {
            "exports": self.exports_data,
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

            logger.info(f"Uploaded exports dashboard to S3: {s3_url}")  # noqa: E501
            if cloudfront_url:
                logger.info(f"CloudFront URL: {cloudfront_url}")  # noqa: E501
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
            logger.debug(f"Could not determine CloudFront URL: {e}")  # noqa: E501
            return None

    def _get_builtin_template(self) -> str:
        """Return built-in HTML template if external template is not available."""
        return """  # noqa: E501
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CDK Stack Exports Dashboard</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        .aws-orange { color: #FF9900; }
        .workshop-disclaimer { background: #fff3cd; border: 1px solid #ffeaa7; }
        .export-card { transition: all 0.2s ease; }
        .export-card:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
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

    except NoCredentialsError:
        logger.error("AWS credentials not found. Please configure your credentials.")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
