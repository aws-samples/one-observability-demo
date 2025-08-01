<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# Changelog

All notable changes to the CodeBuild CDK Deployment Templates will be documented in this file.

## [1.0.1] - 2025-01-01

### Fixed
- **Pipeline Name Extraction**: Fixed pipeline name extraction in `codebuild-deployment-template-simplified.yaml` to use correct ARN field delimiter (`:` field 6 instead of `/` field 2)
  - Changed from: `PIPELINE_NAME=$(echo $PIPELINE_ARN | cut -d'/' -f2)`
  - Changed to: `PIPELINE_NAME=$(echo $PIPELINE_ARN | cut -d':' -f6)`
  - This ensures proper pipeline monitoring and status tracking

### Technical Details
- Pipeline ARNs follow the format: `arn:aws:codepipeline:region:account:pipeline/pipeline-name`
- The pipeline name is the 6th field when splitting by `:` delimiter
- This fix prevents pipeline monitoring failures due to incorrect name extraction

## [1.0.0] - 2024-12-01

### Added
- Initial release of CodeBuild CDK Deployment Templates
- Simplified template with direct pipeline status polling
- Intelligent retry handling with configurable limits
- Extended timeout support for complex deployments
- Robust error handling and resource cleanup
- Enhanced monitoring with detailed logging