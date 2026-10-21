/**
 * @module utils/ApiResponse
 * @description Standardized API response helper.
 * Provides consistent JSON response formatting for success and error cases.
 * Not all endpoints are required to use this — some may use direct res.json()
 * for backward compatibility.
 *
 * @example
 * // Success response
 * ApiResponse.success(res, { user }, 'User retrieved');
 *
 * // Created response
 * ApiResponse.created(res, { id: 1 }, 'User created');
 *
 * // Error response
 * ApiResponse.error(res, 'Validation failed', 422, [{ field: 'email', message: 'Invalid' }]);
 */

class ApiResponse {
  /**
   * Sends a successful JSON response.
   *
   * @param {import('express').Response} res - Express response object
   * @param {*} [data=null] - Response payload
   * @param {string} [message='Success'] - Human-readable success message
   * @param {number} [statusCode=200] - HTTP status code
   * @returns {import('express').Response}
   */
  static success(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  /**
   * Sends a 201 Created JSON response.
   *
   * @param {import('express').Response} res - Express response object
   * @param {*} [data=null] - Response payload (typically the created resource)
   * @param {string} [message='Created successfully'] - Human-readable success message
   * @returns {import('express').Response}
   */
  static created(res, data = null, message = 'Created successfully') {
    return ApiResponse.success(res, data, message, 201);
  }

  /**
   * Sends an error JSON response.
   *
   * @param {import('express').Response} res - Express response object
   * @param {string} [message='Error'] - Human-readable error message
   * @param {number} [statusCode=500] - HTTP status code
   * @param {Array|Object|null} [errors=null] - Detailed error information (e.g., validation errors)
   * @returns {import('express').Response}
   */
  static error(res, message = 'Error', statusCode = 500, errors = null) {
    const response = {
      success: false,
      message,
    };

    if (errors !== null) {
      response.errors = errors;
    }

    return res.status(statusCode).json(response);
  }
}

module.exports = ApiResponse;
