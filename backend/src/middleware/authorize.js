/**
 * @module middleware/authorize
 * @description Role-Based Access Control (RBAC) middleware factory.
 * Creates middleware that restricts route access to users with specific roles.
 * Must be used AFTER the authenticate middleware has set req.user.
 *
 * @example
 * // Allow only admins
 * router.get('/admin', authenticate, authorize('admin'), handler);
 *
 * // Allow managers and admins
 * router.get('/reports', authenticate, authorize('admin', 'manager'), handler);
 */

const ApiError = require('../utils/ApiError');

/**
 * Creates an authorization middleware that restricts access to specific roles.
 *
 * @param {...string} allowedRoles - One or more role strings that are permitted access.
 * @returns {import('express').RequestHandler} Express middleware function.
 */
function authorize(...allowedRoles) {
  /**
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return (req, res, next) => {
    // Guard: authenticate middleware must have run first
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    // Check if the user's role is among the allowed roles
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `Role '${req.user.role}' is not authorized for this resource`
        )
      );
    }

    next();
  };
}

module.exports = authorize;
