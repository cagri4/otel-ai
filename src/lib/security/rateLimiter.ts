/**
 * Upstash Redis-based rate limiters for guest-facing API routes.
 *
 * Two rate limiters:
 * - ipRateLimiter: 30 requests/min sliding window per IP (widget + WhatsApp routes)
 * - hotelRateLimiter: 100 requests/min fixed window per hotel ID (per-hotel load control)
 *
 * Graceful degradation:
 * - If UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN are missing, Redis is null.
 * - Both limiters return null when Redis is unavailable.
 * - checkIpRateLimit and checkHotelRateLimit return { success: true } when limiter is null.
 * - This means rate limiting is DISABLED (not blocking) when Redis is down — correct behavior
 *   since blocking all traffic when rate limit storage is unavailable would be worse than
 *   allowing traffic through.
 *
 * Phase 4 plan requirement: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be
 * set in production for rate limiting to be active.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Lazily initialized Redis client — null if env vars are missing.
let _redis: Redis | null | undefined = undefined; // undefined = not yet initialized

function getRedis(): Redis | null {
  if (_redis !== undefined) {
    return _redis;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    _redis = null;
    return null;
  }

  _redis = new Redis({ url, token });
  return _redis;
}

// ============================================================================
// IP Rate Limiter
// Sliding window: 30 requests per 60 seconds per IP address.
// Used in middleware to protect all /api/widget/* and /api/whatsapp/* routes.
// ============================================================================

let _ipRateLimiter: Ratelimit | null | undefined = undefined;

function getIpRateLimiter(): Ratelimit | null {
  if (_ipRateLimiter !== undefined) {
    return _ipRateLimiter;
  }

  const redis = getRedis();
  if (!redis) {
    _ipRateLimiter = null;
    return null;
  }

  _ipRateLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '60 s'),
    prefix: 'rl:ip',
  });
  return _ipRateLimiter;
}

// Export for use in middleware (rate limiter instance)
export const ipRateLimiter = {
  get instance() {
    return getIpRateLimiter();
  },
};

// ============================================================================
// Hotel Rate Limiter
// Fixed window: 100 requests per 60 seconds per hotel ID.
// Used in individual route handlers for per-hotel load control.
// ============================================================================

let _hotelRateLimiter: Ratelimit | null | undefined = undefined;

function getHotelRateLimiter(): Ratelimit | null {
  if (_hotelRateLimiter !== undefined) {
    return _hotelRateLimiter;
  }

  const redis = getRedis();
  if (!redis) {
    _hotelRateLimiter = null;
    return null;
  }

  _hotelRateLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(100, '60 s'),
    prefix: 'rl:hotel',
  });
  return _hotelRateLimiter;
}

// Export for use in route handlers (rate limiter instance)
export const hotelRateLimiter = {
  get instance() {
    return getHotelRateLimiter();
  },
};

// ============================================================================
// Helper functions — used by middleware and route handlers
// ============================================================================

/**
 * Check IP-based rate limit for a guest request.
 *
 * @param ip - Client IP address
 * @returns { success: true } if request is allowed, { success: false } if rate limit exceeded.
 *          Returns { success: true } if Redis is unavailable (graceful degradation).
 */
export async function checkIpRateLimit(
  ip: string
): Promise<{ success: boolean }> {
  const limiter = getIpRateLimiter();
  if (!limiter) {
    return { success: true };
  }

  const result = await limiter.limit(ip);
  return { success: result.success };
}

/**
 * Check hotel-based rate limit for a hotel's API usage.
 *
 * @param hotelId - Hotel UUID
 * @returns { success: true } if request is allowed, { success: false } if rate limit exceeded.
 *          Returns { success: true } if Redis is unavailable (graceful degradation).
 */
export async function checkHotelRateLimit(
  hotelId: string
): Promise<{ success: boolean }> {
  const limiter = getHotelRateLimiter();
  if (!limiter) {
    return { success: true };
  }

  const result = await limiter.limit(hotelId);
  return { success: result.success };
}
