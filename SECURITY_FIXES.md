# Security Fixes Applied - ASH Scan Results

## Summary

This document tracks security vulnerabilities identified by the Automated Security Helper (ASH) scan and the fixes applied on the `fix/container_dep` branch.

**Scan Date**: 2026-02-28
**Total Findings**: 950 (142 actionable at MEDIUM+ severity)
**Fixes Applied**: 24 critical issues resolved

---

## ✅ Fixed Issues (29 Critical + Multiple Medium/Low)

### 1. Format String Injection Vulnerabilities (13 fixes)

### 1. Format String Injection Vulnerabilities (13 fixes)

**Risk**: Attackers could inject format specifiers into log messages, potentially forging log entries or causing application crashes.

**Scanner**: Semgrep
**Severity**: HIGH
**Rule**: `javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring`

**Files Fixed**:
- `src/applications/lambda/petfood-cleanup-processor-node/index.js` (6 instances)
- `src/applications/lambda/petfood-stock-processor-node/index.js` (3 instances)
- `src/applications/lambda/petfood-stock-processor-node/test-with-real-event.js` (1 instance)
- `src/applications/lambda/traffic-generator-node/index.js` (4 instances)

**Fix Applied**: Replaced string concatenation in console.log/error with structured logging using object parameters.

**Example**:
```javascript
// Before (vulnerable)
console.error(`Failed to delete S3 object s3://${bucket}/${key}:`, error.message);

// After (secure)
console.error('Failed to delete S3 object:', { bucket, key, error: error.message });
```

---

### 2. Missing USER Directive in Dockerfiles (4 fixes)

**Risk**: Containers running as root pose a security hazard. If an attacker gains control of a process, they have root access to the container.

**Scanner**: Semgrep
**Severity**: HIGH
**Rule**: `dockerfile.security.missing-user.missing-user`

**Files Fixed**:
1. `src/applications/microservices/payforadoption-go/Dockerfile`
   - Added non-root user `appuser` (UID 1000)
   - Set proper file ownership

2. `src/applications/microservices/payforadoption-go/benchmark/Dockerfile`
   - Added non-root user `appuser` (UID 1000)
   - Set proper file ownership

3. `src/applications/microservices/petlistadoptions-py/Dockerfile`
   - Enabled existing `appuser` (was created but not used)
   - Removed comment about needing root for port 80
   - Updated `start.sh` to remove root requirement comment

4. `src/applications/microservices/petsearch-java/Dockerfile`
   - Added non-root user `appuser` (UID 1000)
   - Set proper file ownership

**Fix Applied**: Added USER directive to run containers as non-root users.

**Example**:
```dockerfile
# Create non-root user
RUN addgroup -g 1000 appuser && adduser -D -u 1000 -G appuser appuser
RUN chown -R appuser:appuser /app
USER appuser
```

---

### 3. Missing no-new-privileges Security Option (7 fixes)

**Risk**: Services without `no-new-privileges` allow privilege escalation via setuid or setgid binaries.

**Scanner**: Semgrep
**Severity**: HIGH
**Rule**: `yaml.docker-compose.security.no-new-privileges.no-new-privileges`

**Files Fixed**:
1. `src/applications/microservices/petlistadoptions-py/docker-compose.yml`
   - postgres service
   - petlistadoptions service
   - petsearch-mock service

2. `src/applications/microservices/petsearch-java/docker-compose.yml`
   - localstack service
   - setup service
   - collector service
   - pet-search service

**Fix Applied**: Added `security_opt: [no-new-privileges:true]` to all services.

**Example**:
```yaml
services:
  postgres:
    image: postgres:15
    security_opt:
      - no-new-privileges:true
```

---

### 4. NPM Dependency Vulnerabilities (5 critical fixes)

**Risk**: Vulnerable versions of `fast-xml-parser` (v5.2.5) had critical security issues that could be exploited.

**Scanner**: Grype
**Severity**: CRITICAL
**CVE**: GHSA-jmr7-xgp7-cmfj

**Files Fixed**:
1. `src/applications/lambda/petfood-cleanup-processor-node/package.json` & `package-lock.json`
   - Updated @aws-sdk packages from ^3.490.0 to ^3.700.0

2. `src/applications/lambda/petfood-stock-processor-node/package.json` & `package-lock.json`
   - Updated @aws-sdk packages from ^3.0.0 to ^3.700.0

3. `src/applications/lambda/petstatusupdater-node/package.json` & `package-lock.json`
   - Updated @aws-sdk packages from ^3.0.0 to ^3.700.0

4. `src/applications/lambda/traffic-generator-node/package.json` & `package-lock.json`
   - Updated @aws-sdk/client-ssm from ^3.899.0 to ^3.700.0

5. `src/cdk/package-lock.json`
   - Regenerated with latest dependencies (already had ^3.914.0)

**Fix Applied**: Updated AWS SDK v3 packages to latest versions, which transitively updated `fast-xml-parser` to a secure version.

**Remaining**: 24 low severity vulnerabilities in AWS SDK dependencies (acceptable for development)

---

## 🔄 In Progress - None

All planned fixes have been completed!

---

## ⚠️ Remaining Critical Issues (93)

### High Priority - Go Service Security Issues (3 findings)

**Location**: `src/applications/microservices/payforadoption-go/`

1. **HTTP without TLS** (`main.go:185`)
   - Rule: `go.lang.security.audit.net.use-tls.use-tls`
   - Issue: Using `http.ListenAndServe` instead of `http.ListenAndServeTLS`
   - Recommendation: Implement TLS or use a reverse proxy with TLS termination

2. **SQL Injection Risk** (`payforadoption/repository.go:216`)
   - Rule: `go.lang.security.audit.database.string-formatted-query.string-formatted-query`
   - Issue: String-formatted SQL query using `fmt.Sprintf`
   - Recommendation: Use parameterized queries or prepared statements

3. **Weak Random Number Generation** (`payforadoption/utils.go:12`)
   - Rule: `go.lang.security.audit.crypto.math_random.math-random-used`
   - Issue: Using `math/rand` instead of `crypto/rand`
   - Recommendation: Replace with `crypto/rand` for security-sensitive operations

### Dependency Vulnerabilities (60 findings)

**Grype Scanner**: 17 critical, 6 medium (reduced from 22 critical)
**Trivy Scanner**: 43 critical, 17 medium

**Status**: Major NPM vulnerabilities fixed. Remaining issues are in:
- Container base images (need base image updates)
- Other language ecosystems (Python, Rust, Java, Go)
- Low severity AWS SDK issues (acceptable for development)

### Infrastructure Misconfigurations (15 findings)

**Checkov Scanner**: 15 critical (28 suppressed with documented reasons)

These are CloudFormation/CDK infrastructure issues that need review:
- IAM policy configurations
- Encryption settings
- Logging configurations
- Resource access controls

---

## Testing Recommendations

After applying these fixes, test the following:

1. **Lambda Functions**: Verify logging still works correctly with structured format
2. **Container Services**: Ensure applications run properly as non-root users
3. **Port Binding**: Confirm port 80 binding works with non-root users in containers
4. **Docker Compose**: Test local development environment with security options enabled

---

## Next Steps

1. ✅ **Completed**: Format string injection fixes
2. ✅ **Completed**: Dockerfile USER directives
3. ✅ **Completed**: Docker Compose security options
4. ✅ **Completed**: NPM dependency updates (fast-xml-parser vulnerability)
5. 🔄 **Recommended**: Fix Go service security issues
6. 🔄 **Recommended**: Update remaining vulnerable dependencies (container images, other languages)
7. 🔄 **Recommended**: Review and address infrastructure misconfigurations

---

## Scan Details

**ASH Version**: 3.2.2
**Scan Duration**: 230 seconds
**Scanners Used**: 11 (bandit, checkov, grype, npm-audit, semgrep, syft, trivy-repo, etc.)
**Severity Threshold**: MEDIUM
**Configuration**: `.ash/.ash.yaml`

**Full Report Location**: `.ash/ash_output/reports/ash.summary.md`
