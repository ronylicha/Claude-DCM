/**
 * Simple in-memory rate limiting middleware
 * For production, consider using Redis-backed rate limiting
 */
import type { Context, Next } from "hono";

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyGenerator?: (c: Context) => string;  // Custom key generator
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store (consider Redis for production/multi-instance deployments)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

/**
 * Create a rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const { windowMs, maxRequests, keyGenerator } = config;

  return async (c: Context, next: Next) => {
    // Generate key (default: IP address)
    const key = keyGenerator ? keyGenerator(c) : c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const now = Date.now();

    // Get or create entry
    let entry = rateLimitStore.get(key);
    
    if (!entry || entry.resetTime < now) {
      // Create new entry or reset expired one
      entry = {
        count: 0,
        resetTime: now + windowMs,
      };
      rateLimitStore.set(key, entry);
    }

    // Increment counter
    entry.count++;

    // Set rate limit headers
    c.header("X-RateLimit-Limit", maxRequests.toString());
    c.header("X-RateLimit-Remaining", Math.max(0, maxRequests - entry.count).toString());
    c.header("X-RateLimit-Reset", Math.floor(entry.resetTime / 1000).toString());

    // Check if limit exceeded
    if (entry.count > maxRequests) {
      c.header("Retry-After", Math.ceil((entry.resetTime - now) / 1000).toString());
      return c.json(
        {
          error: "Too many requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter: Math.ceil((entry.resetTime - now) / 1000),
        },
        429
      );
    }

    await next();
  };
}

/**
 * Preset configurations for common use cases
 */
export const rateLimitPresets = {
  // Strict limit for authentication endpoints
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,           // 10 requests per 15 minutes
  },
  // Standard limit for write operations
  write: {
    windowMs: 60 * 1000,       // 1 minute
    maxRequests: 60,           // 60 requests per minute
  },
  // Generous limit for read operations
  read: {
    windowMs: 60 * 1000,       // 1 minute
    maxRequests: 300,          // 300 requests per minute
  },
};
