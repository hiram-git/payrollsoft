/**
 * Password utilities using Bun's built-in bcrypt implementation.
 * Bun.password uses bcrypt (cost factor 10) by default — fast and secure.
 */

/**
 * Hash a plain-text password.
 * Always await — hashing is CPU-intensive and runs off the main thread.
 */
export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain)
}

/**
 * Verify a plain-text password against a stored hash.
 * Returns true if they match, false otherwise.
 * Constant-time comparison prevents timing attacks.
 */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash)
}
