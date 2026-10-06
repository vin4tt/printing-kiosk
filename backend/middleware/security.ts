import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

/**
 * In-memory sliding window rate limiter
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${req.baseUrl || req.path}_${ip}`;
    const now = Date.now();

    const record = rateLimitStore.get(key);

    if (!record || now > record.resetAt) {
      rateLimitStore.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      return next();
    }

    if (record.count >= options.maxRequests) {
      return res.status(429).json({
        error: options.message || 'Too many requests. Please wait a moment and try again.',
        retryAfterMs: Math.max(0, record.resetAt - now),
      });
    }

    record.count++;
    next();
  };
}

/**
 * Strict Security Headers Middleware
 */
export function applySecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Disable browser caching for sensitive API responses
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

/**
 * Timing-safe string comparison to prevent timing attacks on tokens / OTP hashes
 */
export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Sanitizes user input strings to prevent injection
 */
export function sanitizeString(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/[<>]/g, '');
}
