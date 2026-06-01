const rateLimit = require('express-rate-limit');

// Strict limiter for login — 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many login attempts. Please try again in 15 minutes.' },
});

// Gentle limiter for password reset — 5 requests per hour per IP
const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many password reset requests. Please try again in an hour.' },
});

// Limiter for registration — 5 accounts per hour per IP
const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many registration attempts. Please try again later.' },
});

// Limiter for token refresh — 30 refreshes per 15 minutes per IP
const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many token refresh requests. Please try again later.' },
});

// Limiter for registration token validation — prevents brute-force enumeration
const validateTokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many validation attempts. Please try again later.' },
});

// Limiter for account link check — prevents account enumeration
const checkLinkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please try again later.' },
});

module.exports = { loginLimiter, passwordResetLimiter, registrationLimiter, refreshLimiter, validateTokenLimiter, checkLinkLimiter };
