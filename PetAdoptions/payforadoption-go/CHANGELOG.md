# Changelog - Pay for Adoption Go Service

## [Enhancement] User ID Support

### Overview
Added comprehensive user tracking support to the payforadoption-go microservice to enable user-specific adoption analytics and improved observability.

### Changes Made

#### 1. Data Model Updates
- **service.go**: Added `UserID` field to the `Adoption` struct
- **service.go**: Updated `Service` interface to include `userID` parameter in `CompleteAdoption` method
- **service.go**: Modified `CompleteAdoption` implementation to handle and store user ID

#### 2. API Layer Updates
- **transport.go**: Updated `completeAdoptionRequest` struct to include `UserID` field
- **transport.go**: Modified `decodeCompleteAdoptionRequest` to extract `userId` from query parameters
- **transport.go**: Added validation to ensure `userId` parameter is provided (returns 400 if missing)
- **endpoint.go**: Updated `makeCompleteAdoptionEndpoint` to pass user ID to service layer

#### 3. Database Schema Updates
- **repository.go**: Updated `CreateTransaction` SQL to include `user_id` column
- **repository.go**: Modified `CreateSQLTables` to add `user_id` column to both `transactions` and `transactions_history` tables
- **repository.go**: Updated external API call to include user ID in request body

#### 4. Observability Enhancements
- **middlewares.go**: Updated `CompleteAdoption` middleware to include user ID in:
  - OpenTelemetry span attributes
  - Structured logging output
  - Metrics and tracing context

#### 5. Testing and Documentation
- **service_test.go**: Added comprehensive test for user ID functionality
- **README.md**: Created documentation explaining API changes and new requirements
- **example_request.sh**: Added example script demonstrating API usage with user ID
- **CHANGELOG.md**: This file documenting all changes

### API Changes

#### Before
```
POST /api/home/completeadoption?petId=pet123&petType=dog
```

#### After
```
POST /api/home/completeadoption?petId=pet123&petType=dog&userId=user456
```

### Database Schema Changes

#### New Column Added
Both `transactions` and `transactions_history` tables now include:
- `user_id VARCHAR` - Stores the ID of the user who adopted the pet

### Backward Compatibility
- **Breaking Change**: The API now requires the `userId` parameter
- Existing clients must be updated to include the `userId` parameter
- Database migration is automatic via `CREATE TABLE IF NOT EXISTS` with the new schema

### Benefits
1. **User Analytics**: Enable tracking of adoption patterns per user
2. **Enhanced Observability**: User ID included in all traces, logs, and metrics
3. **Better Debugging**: Easier to trace issues to specific users
4. **Future Features**: Foundation for user-specific features like adoption history

### Testing
- All changes tested with unit tests
- Build verification completed successfully
- Example request script provided for manual testing

### Deployment Notes
- No manual database migration required
- Service will automatically update table schema on startup
- Ensure all client applications are updated to include `userId` parameter before deployment