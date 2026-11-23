import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { AppException } from './errors/app-exception';

/**
 * Flattens class-validator errors into `{ "a.b.0.c": "reason" }` (contract §0:
 * VALIDATION_FAILED uses details.fields: { [path]: reason }). One reason per path.
 */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const reasons = error.constraints ? Object.values(error.constraints) : [];
    if (reasons.length > 0) fields[path] = reasons[0]!;
    if (error.children && error.children.length > 0) {
      Object.assign(fields, flattenValidationErrors(error.children, path));
    }
  }
  return fields;
}

/** Global pipe: strict DTOs (unknown fields rejected), primitives transformed from strings. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: true,
    exceptionFactory: (errors) =>
      new AppException('VALIDATION_FAILED', { fields: flattenValidationErrors(errors) }),
  });
}
