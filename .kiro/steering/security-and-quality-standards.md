# Security and Code Quality Standards

## Overview
This project maintains strict security and code quality standards through automated scanning and validation. All code changes must pass security and quality checks before being committed.

## Security Scanning with ASH (Automated Security Helper)

### Core Principle
**Security findings must be addressed, not bypassed.** ASH scanning failures indicate real security issues that require investigation and remediation.

### When ASH Fails
1. **First Priority**: Review and fix the security findings
   - Check the ASH report at `.ash/ash_output/reports/ash.html`
   - Address each finding according to its severity level
   - Use proper suppression only for verified false positives

2. **Investigation Steps**:
   - Run `ash inspect findings` to explore findings interactively
   - Review scanner-specific reports in `.ash/ash_output/scanners/`
   - Consult security team if findings are unclear

3. **Proper Suppression**:
   - Use ASH suppression files for legitimate false positives
   - Document the reason for each suppression
   - Get security team approval for critical/high severity suppressions

### Bypass Guidelines
**The `CODE_DEFENDER_SKIP_LOCAL_HOOKS` environment variable should ONLY be used in these exceptional circumstances:**

1. **Emergency hotfixes** where security review will follow immediately
2. **Known false positives** that are already documented and approved
3. **Infrastructure issues** where ASH itself is malfunctioning

**Never bypass for:**
- Convenience or speed
- "Minor" security findings
- Deadline pressure
- Unfamiliarity with security tools

## Code Quality Standards

### Pre-commit Hooks
All pre-commit hooks serve important purposes:
- **ESLint**: Prevents JavaScript/TypeScript quality issues
- **Black/Flake8**: Ensures Python code consistency
- **CloudFormation Linter**: Validates infrastructure as code
- **Secrets Detection**: Prevents credential leaks

### File Management
- Remove empty or unnecessary files before committing
- Ensure all files serve a clear purpose
- Clean up generated or temporary files

## Kiro Assistant Guidelines

When helping with commits that fail security or quality checks:

1. **Always investigate the root cause first**
2. **Propose fixes for the actual issues**
3. **Only suggest bypassing as an absolute last resort**
4. **Require explicit justification for any bypass**
5. **Remind about follow-up security review when bypassing**

## Escalation Process

If security findings cannot be resolved:
1. Document the findings and attempted solutions
2. Consult with the security team
3. Consider if the change is truly necessary
4. Get explicit approval before bypassing

## Resources

- ASH Documentation: Internal security scanning guidelines
- Security Team Contact: [Security team contact info]
- Code Quality Guidelines: [Link to coding standards]