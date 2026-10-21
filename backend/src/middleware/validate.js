/**
 * @module middleware/validate
 * @description Joi validation middleware factory.
 * Creates middleware that validates request data (body, query, or params)
 * against a Joi schema. Strips unknown fields and reports all errors at once.
 *
 * @example
 * const Joi = require('joi');
 * const validate = require('../middleware/validate');
 *
 * const createUserSchema = Joi.object({
 *   email: Joi.string().email().required(),
 *   fullName: Joi.string().min(2).max(255).required(),
 * });
 *
 * router.post('/users', authenticate, validate(createUserSchema), handler);
 * router.get('/users', authenticate, validate(querySchema, 'query'), handler);
 */

const ApiError = require('../utils/ApiError');

/**
 * Creates a validation middleware for the given Joi schema.
 *
 * @param {import('joi').ObjectSchema} schema - A Joi validation schema.
 * @param {'body'|'query'|'params'} [source='body'] - The request property to validate.
 * @returns {import('express').RequestHandler} Express middleware function.
 */
function validate(schema, source = 'body') {
  /**
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const message = error.details.map((d) => d.message).join(', ');
      return next(ApiError.badRequest(message));
    }

    // Replace the request source with the sanitized/validated value
    req[source] = value;
    next();
  };
}

module.exports = validate;
