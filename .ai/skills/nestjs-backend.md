# NestJS Backend Skills
- Every new resource must be generated as a complete module (`Controller`, `Service`, `Module`).
- Strict typings required: Every endpoint must use DTOs with `@ApiProperty()` and `class-validator` decorators (e.g., `@IsString()`, `@IsOptional()`).
- Database interactions must be isolated inside repository layers or Prisma services. Never write raw SQL inside a controller.
- Use Global Exception Filters for error handling to ensure consistent `{ statusCode, message }` JSON responses.
