# Admin Endpoints Documentation

This document describes the admin endpoints added to the petfood microservice for database seeding and workshop reset functionality.

## Admin Endpoints

The admin endpoints provide utilities for managing the database state during workshops and demonstrations.

### Food Catalog Management

For food catalog management (create, update, delete), use the regular API endpoints:

- `GET /api/foods` - List all foods
- `POST /api/foods` - Create new food
- `GET /api/foods/{id}` - Get specific food
- `PUT /api/foods/{id}` - Update food
- `DELETE /api/foods/{id}` - Delete food

### Database Operations

#### Setup Tables
Creates the required DynamoDB tables for the application.

```
POST /api/admin/setup-tables
```

**Response:**
```json
{
  "message": "Successfully created 2 tables",
  "tables_created": ["foods", "carts"],
  "timestamp": "2024-01-01T12:00:00Z"
}
```

This endpoint is useful for:
- Initial workshop setup
- Creating tables in new environments
- Recovering from table deletion scenarios

#### Seed Database
Seeds the database with sample food data for all pet types (puppies, kittens, bunnies).

```
POST /api/admin/seed
```

**Response:**
```json
{
  "message": "Database seeded successfully with 9 foods",
  "foods_created": 9,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Sample Foods Created:**
- **Puppies**: Beef and Turkey Kibbles, Raw Chicken Bites, Puppy Training Treats
- **Kittens**: Salmon and Tuna Delight, Kitten Growth Formula, Catnip Kitten Treats  
- **Bunnies**: Carrot and Herb Crunchies, Timothy Hay Pellets, Fresh Veggie Mix

#### Cleanup Database
Removes all food products from the database (for workshop reset functionality).

```
POST /api/admin/cleanup
```

**Response:**
```json
{
  "message": "Database cleaned up successfully, deleted 15 foods",
  "foods_deleted": 15,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

## Observability

All operations are instrumented with OpenTelemetry tracing and structured logging for observability:

- **Tracing**: Each operation creates spans with relevant attributes
- **Logging**: Structured logs with operation details and outcomes
- **Metrics**: Operation counts and durations are recorded
- **Error Tracking**: Failed operations are logged with error details

## Error Handling

Admin endpoints return detailed error information for troubleshooting:

```json
{
  "error": "Failed to seed database",
  "details": ["Food creation failed: validation error"],
  "timestamp": "2024-01-01T12:00:00Z"
}
```

## Security Considerations

- Admin endpoints should be protected with appropriate authentication and authorization
- Input validation prevents malicious data injection
- Rate limiting should be applied to prevent abuse
- HTTPS should be enforced for all admin operations

## Workshop Usage

These endpoints are designed to support the Pet Adoptions observability workshop:

1. **Infrastructure Setup**: Use `POST /api/admin/setup-tables` to create required DynamoDB tables
2. **Data Setup**: Use `POST /api/admin/seed` to populate the database with sample data
3. **Testing**: Use regular API endpoints (`/api/foods`) to demonstrate observability features
4. **Reset**: Use `POST /api/admin/cleanup` to reset the database between workshop sessions
5. **Monitoring**: Observe OpenTelemetry traces, logs, and metrics during operations

## Future Enhancements

- Authentication and authorization integration
- Role-based access control for admin operations
- Bulk operations for efficient data management
- Import/export functionality for food catalogs
- Advanced observability dashboards and alerting