# Development Workflow Standards

## Commit Process

### Before Every Commit
1. **Run local tests** to ensure functionality
2. **Review security scan results** if ASH is configured
3. **Clean up temporary files** and unused code
4. **Verify all files are intentional** additions

### Handling Pre-commit Hook Failures

#### Security Scan Failures (ASH)
- **Priority**: Fix the underlying security issues
- **Process**:
  1. Review findings in `.ash/ash_output/reports/ash.html`
  2. Address each finding appropriately
  3. Re-run the commit after fixes
- **Bypass**: Only with explicit security team approval

#### Code Quality Failures
- **ESLint errors**: Fix JavaScript/TypeScript issues
- **Empty files**: Remove or add meaningful content
- **Formatting issues**: Use project formatters (black, prettier, etc.)

### Emergency Procedures
For critical hotfixes only:
1. Document the emergency nature
2. Use bypass with full justification
3. Create immediate follow-up ticket for proper fix
4. Notify relevant teams

## Branch Management

### Feature Branches
- Use descriptive names: `feature/add-monitoring`, `fix/security-vulnerability`
- Keep branches focused on single features/fixes
- Clean up branches after merging

### Cleanup Branches
- Use `cleanup/` prefix for maintenance work
- Example: `cleanup/remove-old-templates`

## File Management Standards

### Before Committing
- Remove empty files that serve no purpose
- Clean up generated files not meant for version control
- Ensure all added files are intentional

### Template and Configuration Files
- Keep only the current, working versions
- Move outdated files to archive or remove entirely
- Document any breaking changes in commit messages

## Kiro Assistant Behavior

When assisting with development tasks:

1. **Always prioritize security and quality**
2. **Investigate failures before suggesting workarounds**
3. **Provide educational context about why standards exist**
4. **Suggest proper solutions over quick fixes**
5. **Document any exceptional circumstances clearly**