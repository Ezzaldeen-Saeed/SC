/**
 * @module repositories/users.repository
 * @description Data access layer for the users table.
 * All operations use supabaseAdmin (service role) for full access.
 */

const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Retrieve all users ordered by creation date (newest first).
 * @returns {Promise<Array<Object>>} Array of user objects
 * @throws {ApiError} On database error
 */
async function findAll() {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('UsersRepository.findAll failed', { error: error.message });
    throw ApiError.internal('Failed to fetch users');
  }

  return data;
}

/**
 * Find a single user by their user_id.
 * @param {string} userId - UUID of the user
 * @returns {Promise<Object>} The user object
 * @throws {ApiError} NotFound if user does not exist, or Internal on DB error
 */
async function findById(userId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw ApiError.notFound(`User not found: ${userId}`);
    }
    logger.error('UsersRepository.findById failed', { userId, error: error.message });
    throw ApiError.internal('Failed to fetch user');
  }

  return data;
}

/**
 * Find a user by email address.
 * @param {string} email - Email address to search
 * @returns {Promise<Object|null>} The user object or null if not found
 * @throws {ApiError} On database error
 */
async function findByEmail(email) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    logger.error('UsersRepository.findByEmail failed', { email, error: error.message });
    throw ApiError.internal('Failed to fetch user by email');
  }

  return data;
}

/**
 * Create a new user record.
 * @param {Object} userData - User data to insert
 * @param {string} userData.user_id - UUID (from Supabase Auth)
 * @param {string} userData.full_name - Full name
 * @param {string} userData.username - Username
 * @param {string} userData.email - Email address
 * @param {string} userData.role - Role (admin, manager, supervisor, agent)
 * @param {string} [userData.phone] - Phone number
 * @param {boolean} [userData.is_active] - Active status
 * @param {string} [userData.parent_id] - Parent UUID (hierarchy)
 * @returns {Promise<Object>} The created user object
 * @throws {ApiError} On database error
 */
async function create(userData) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .insert(userData)
    .select()
    .single();

  if (error) {
    logger.error('UsersRepository.create failed', { error: error.message });
    throw ApiError.internal('Failed to create user record');
  }

  return data;
}

/**
 * Update a user record by user_id.
 * @param {string} userId - UUID of the user to update
 * @param {Object} updateData - Fields to update
 * @returns {Promise<Object>} The updated user object
 * @throws {ApiError} On database error
 */
async function update(userId, updateData) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updateData)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    logger.error('UsersRepository.update failed', { userId, error: error.message });
    throw ApiError.internal('Failed to update user');
  }

  return data;
}

/**
 * Update a user's role.
 * @param {string} userId - UUID of the user
 * @param {string} role - New role value
 * @returns {Promise<Object>} The updated user object
 * @throws {ApiError} On database error
 */
async function updateRole(userId, role) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ role })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    logger.error('UsersRepository.updateRole failed', { userId, role, error: error.message });
    throw ApiError.internal('Failed to update user role');
  }

  return data;
}

/**
 * Update a user's active status.
 * @param {string} userId - UUID of the user
 * @param {boolean} isActive - New active status
 * @returns {Promise<Object>} The updated user object
 * @throws {ApiError} On database error
 */
async function updateStatus(userId, isActive) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ is_active: isActive })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    logger.error('UsersRepository.updateStatus failed', { userId, isActive, error: error.message });
    throw ApiError.internal('Failed to update user status');
  }

  return data;
}

/**
 * Delete a user record by user_id.
 * @param {string} userId - UUID of the user to delete
 * @returns {Promise<void>}
 * @throws {ApiError} On database error
 */
async function deleteById(userId) {
  const { error } = await supabaseAdmin
    .from('users')
    .delete()
    .eq('user_id', userId);

  if (error) {
    logger.error('UsersRepository.deleteById failed', { userId, error: error.message });
    throw ApiError.internal('Failed to delete user');
  }
}

/**
 * Find all users managed by a specific manager, optionally filtered by role.
 * @param {string} managerId - UUID of the manager
 * @param {string|null} [role=null] - Optional role filter
 * @returns {Promise<Array<Object>>} Array of user objects
 * @throws {ApiError} On database error
 */
async function findByManagerId(managerId, role = null) {
  let query = supabaseAdmin
    .from('users')
    .select('*')
    .eq('parent_id', managerId);

  if (role) {
    query = query.eq('role', role);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    logger.error('UsersRepository.findByManagerId failed', { managerId, role, error: error.message });
    throw ApiError.internal('Failed to fetch users by manager');
  }

  return data;
}

/**
 * Find all users having a given role.
 * @param {string} role - Role to filter by (e.g. 'agent', 'supervisor')
 * @returns {Promise<Array<Object>>} Array of user objects
 * @throws {ApiError} On database error
 */
async function findByRole(role) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('role', role)
    .order('full_name', { ascending: true });

  if (error) {
    logger.error('UsersRepository.findByRole failed', { role, error: error.message });
    throw ApiError.internal('Failed to fetch users by role');
  }

  return data;
}

/**
 * Find users whose parent (manager_id) is one of the given IDs, optionally by role.
 * Used to walk the hierarchy one level down for a set of parents
 * (e.g. all agents under a set of supervisors).
 * @param {Array<string>} parentIds - Array of parent user UUIDs (manager_id values)
 * @param {string|null} [role=null] - Optional role filter
 * @returns {Promise<Array<Object>>} Array of child user objects
 * @throws {ApiError} On database error
 */
async function findByManagerIds(parentIds, role = null) {
  if (!parentIds || parentIds.length === 0) return [];

  let query = supabaseAdmin
    .from('users')
    .select('*')
    .in('parent_id', parentIds);

  if (role) query = query.eq('role', role);

  query = query.order('full_name', { ascending: true });

  const { data, error } = await query;

  if (error) {
    logger.error('UsersRepository.findByManagerIds failed', { parentIds, role, error: error.message });
    throw ApiError.internal('Failed to fetch users by parents');
  }

  return data;
}

/**
 * Count all users in the users table.
 * Uses an efficient head-only query.
 * @returns {Promise<number>} Total user count
 * @throws {ApiError} On database error
 */
async function countAll() {
  const { count, error } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true });

  if (error) {
    logger.error('UsersRepository.countAll failed', { error: error.message });
    throw ApiError.internal('Failed to count users');
  }

  return count;
}

/**
 * Count users matching a filter object.
 * Each key-value pair in the filter is applied as an equality condition.
 * @param {Object} filter - Key-value pairs for filtering (e.g. { is_active: true })
 * @returns {Promise<number>} Filtered user count
 * @throws {ApiError} On database error
 */
async function countByFilter(filter) {
  let query = supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true });

  for (const [key, value] of Object.entries(filter)) {
    query = query.eq(key, value);
  }

  const { count, error } = await query;

  if (error) {
    logger.error('UsersRepository.countByFilter failed', { filter, error: error.message });
    throw ApiError.internal('Failed to count users by filter');
  }

  return count;
}

module.exports = {
  findAll,
  findById,
  findByEmail,
  create,
  update,
  updateRole,
  updateStatus,
  deleteById,
  findByManagerId,
  findByManagerIds,
  findByRole,
  countAll,
  countByFilter,
};
