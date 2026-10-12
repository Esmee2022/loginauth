// Sliding-window in-memory rate limiter with exponential backoff / lockout
const attempts = new Map();

const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function cleanOldEntries() {
  const now = Date.now();
  for (const [key, record] of attempts.entries()) {
    if (now - record.lastAttempt > LOCKOUT_WINDOW_MS && record.count < MAX_ATTEMPTS) {
      attempts.delete(key);
    } else if (record.lockedUntil && now > record.lockedUntil) {
      attempts.delete(key);
    }
  }
}

// Clean up every 5 minutes
setInterval(cleanOldEntries, 5 * 60 * 1000).unref();

function rateLimitAuth(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const key = `auth:${ip}`;
  const now = Date.now();

  const record = attempts.get(key) || { count: 0, lastAttempt: now, lockedUntil: null };

  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return res.status(429).json({
      error: 'TOO_MANY_ATTEMPTS',
      message: `Too many failed attempts. Access temporarily locked. Retry in ${remainingSeconds} seconds.`,
      retryAfter: remainingSeconds
    });
  }

  // Attach tracker helper to response
  res.locals.recordFailedAttempt = () => {
    record.count += 1;
    record.lastAttempt = Date.now();
    if (record.count >= MAX_ATTEMPTS) {
      record.lockedUntil = Date.now() + LOCKOUT_WINDOW_MS;
    }
    attempts.set(key, record);
  };

  res.locals.clearAttempts = () => {
    attempts.delete(key);
  };

  next();
}

module.exports = {
  rateLimitAuth
};
