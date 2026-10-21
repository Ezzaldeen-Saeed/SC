/**
 * @fileoverview Admin module validation schemas.
 * Defines Joi schemas for admin user management operations.
 * @module modules/admin/admin.validation
 */

const Joi = require('joi');
const { ROLES } = require('../../utils/constants');

/**
 * All valid role values derived from the ROLES constant.
 * @type {string[]}
 */
const ALL_ROLES = Object.values(ROLES);

/**
 * Schema for creating a new user.
 * @type {Joi.ObjectSchema}
 */
const createUserSchema = Joi.object({
  full_name: Joi.string().required(),
  username: Joi.string().required(),
  // lowercase: users.email is the lookup key for password reset, and Supabase Auth
  // stores its copy lowercased — the two must not drift apart.
  email: Joi.string().email().lowercase().required(),
  role: Joi.string().valid(...ALL_ROLES).required(),
  phone: Joi.string().optional().allow(''),
  is_active: Joi.boolean().default(true),
  password: Joi.string().min(6).required(),
  // الأب في الهرمية: agent→supervisor, supervisor→manager, manager→admin
  parent_id: Joi.string().uuid().allow(null, '').optional(),
});

/**
 * Schema for assigning/changing a user's parent in the hierarchy.
 * @type {Joi.ObjectSchema}
 */
const assignManagerSchema = Joi.object({
  parent_id: Joi.string().uuid().allow(null, '').required(),
});

/**
 * Schema for updating a user's role.
 * @type {Joi.ObjectSchema}
 */
const updateRoleSchema = Joi.object({
  role: Joi.string().valid(...ALL_ROLES).required(),
});

/**
 * Schema for updating a user's active status.
 * @type {Joi.ObjectSchema}
 */
const updateStatusSchema = Joi.object({
  is_active: Joi.boolean().required(),
});

/**
 * Schema for validating UUID route parameters.
 * @type {Joi.ObjectSchema}
 */
const paramsIdSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  createUserSchema,
  updateRoleSchema,
  updateStatusSchema,
  assignManagerSchema,
  paramsIdSchema,
};
