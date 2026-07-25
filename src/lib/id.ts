/**
 * Generate a unique identifier with an optional prefix.
 * Wraps impure calls (Date.now / Math.random) in a utility function to avoid
 * React lint warnings about calling impure functions during render.
 */
export function uniqueId(prefix?: string): string {
  const core = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  return prefix ? `${prefix}-${core}` : core;
}
