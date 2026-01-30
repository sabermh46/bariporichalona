// src/middlewares/validation.js
const { body, param, query, validationResult } = require('express-validator');

const validate = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(validation => validation.run(req)));

        const errors = validationResult(req);
        if (errors.isEmpty()) {
            return next();
        }

        res.status(400).json({
            success: false,
            error: 'Validation failed',
            errors: errors.array()
        });
    };
};

// Custom validators
const isArray = (value) => {
    return Array.isArray(value);
};

const isDate = (value) => {
    if (!value) return true;
    return !isNaN(Date.parse(value));
};

module.exports = {
    validate,
    body,
    param,
    query,
    isArray,
    isDate
};