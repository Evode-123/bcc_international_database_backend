/**
 * Safely parses a route param (which Express types as string | string[])
 * into a number. Throws a descriptive error if it's missing, an array,
 * or not a valid integer -- callers can let this bubble to the error
 * middleware, which returns a 500, or catch it for a 400 if preferred.
 */
export function parseIdParam(value: string | string[] | undefined, paramName = 'id'): number {
  if (typeof value !== 'string') {
    throw new Error(`Expected a single value for route param "${paramName}"`);
  }
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Route param "${paramName}" must be a valid number`);
  }
  return parsed;
}
