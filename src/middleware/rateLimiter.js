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

module.exports = { loginLimiter, passwordResetLimiter, registrationLimiter };
