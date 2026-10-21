/**
 * @fileoverview Manager module validation schemas.
 * Defines Joi schemas for manager-level supervisor management operations.
 * @module modules/manager/manager.validation
 */

const Joi = require('joi');

/**
 * Schema for creating a new supervisor under a manager.
 * @type {Joi.ObjectSchema}
 */
const createSupervisorSchema = Joi.object({
  full_name: Joi.string().required(),
  username: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().optional().allow(''),
  is_active: Joi.boolean().default(true),
  password: Joi.string().min(6).required(),
});

/**
 * Schema for updating a supervisor's active status.
 * @type {Joi.ObjectSchema}
 */
const updateStatusSchema = Joi.object({
  is_active: Joi.boolean().required(),
});

module.exports = {
  createSupervisorSchema,
  updateStatusSchema,
};
